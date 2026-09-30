import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeFunctionResult, toHex, type Abi, type Address, type Hash, type Hex } from 'viem';
import { errorMessage, readSnapshot, sendContract, type WalletProvider } from '../src/chain';
import { contract, type Deployment, type LoadedDeployment } from '../src/config';

const handoff = JSON.parse(readFileSync(new URL('../config/deployment-input.json', import.meta.url), 'utf8'));
const networkInput = JSON.parse(readFileSync(new URL('../config/network-input.json', import.meta.url), 'utf8'));
const manifest: Deployment = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  assets: [],
  ...networkInput,
  contracts: handoff.contracts.map((entry: { name: string }) => ({ ...entry, abiPath: `abi/${entry.name}.json` })),
};
// Empty public transports force all requests through this test's in-memory provider.
// No test connects to a live endpoint or asks a real wallet to sign.
const config: LoadedDeployment = {
  ...manifest,
  network: { ...manifest.network!, rpcUrls: [] },
  abis: Object.fromEntries(manifest.contracts.map(entry => [
    entry.name,
    JSON.parse(readFileSync(new URL(`../../docs/abi/${entry.name}.json`, import.meta.url), 'utf8')) as Abi,
  ])),
};
const token = contract(config, 'LaunchToken');
const escrow = contract(config, 'MilestoneEscrow');
const account = '0x1111111111111111111111111111111111111111' as Address;
const alternate = '0x2222222222222222222222222222222222222222' as Address;
const originalHash = `0x${'1'.repeat(64)}` as Hash;
const replacementHash = `0x${'2'.repeat(64)}` as Hash;
const blockHash = `0x${'3'.repeat(64)}` as Hash;

type Replacement = 'cancelled' | 'replaced' | 'repriced';
type Options = {
  missingCode?: boolean;
  wrongToken?: boolean;
  wrongChain?: boolean;
  changeAccountAfterSimulation?: boolean;
  rejectSignature?: boolean;
  replacement?: Replacement;
};
type Call = { to: Address; data: Hex };

function mockProvider(options: Options = {}) {
  const methods: string[] = [];
  const snapshotBlocks: unknown[] = [];
  let signatureRequests = 0;
  let changedAccount = false;
  let originalInput: Hex = '0x';
  const transaction = (replaced = false) => ({
    from: account,
    to: replaced && options.replacement === 'cancelled' ? account
      : replaced && options.replacement === 'replaced' ? alternate : token.address,
    input: replaced && options.replacement !== 'repriced' ? '0x' : originalInput,
    value: '0x0', nonce: '0x0', hash: replaced ? replacementHash : originalHash,
    gas: '0x10000', gasPrice: '0x1', type: '0x0',
    blockNumber: replaced ? '0x123' : null,
    blockHash: replaced ? blockHash : null,
    transactionIndex: replaced ? '0x0' : null,
  });
  const provider = {
    async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
      methods.push(method);
      if (method === 'eth_chainId') return toHex(options.wrongChain ? config.chainId + 1 : config.chainId);
      if (method === 'eth_accounts') return [changedAccount ? alternate : account];
      if (method === 'eth_getCode') return options.missingCode ? '0x' : '0x60006000';
      if (method === 'eth_getBalance') { snapshotBlocks.push(params[1]); return '0x2'; }
      if (method === 'eth_blockNumber') return '0x123';
      if (method === 'eth_getBlockByNumber') return {
        number: '0x123', hash: blockHash, timestamp: '0x1000',
        transactions: options.replacement ? [transaction(true)] : [],
      };
      if (method === 'eth_getTransactionByHash') return transaction();
      if (method === 'eth_getTransactionReceipt') return params[0] === originalHash ? null : {
        transactionHash: replacementHash, transactionIndex: '0x0', blockHash, blockNumber: '0x123',
        from: account, to: transaction(true).to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
        contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`,
        status: '0x1', effectiveGasPrice: '0x1', type: '0x0',
      };
      if (method === 'eth_sendTransaction') {
        signatureRequests++;
        if (options.rejectSignature) throw Object.assign(new Error('User rejected request'), { code: 4001 });
        if (!options.replacement) throw new Error('Unexpected signature request in read-only safety test');
        originalInput = (params[0] as Call).data;
        return originalHash;
      }
      if (method === 'eth_call') {
        const request = params[0] as Call;
        const abi = request.to.toLowerCase() === token.address.toLowerCase() ? token.abi : escrow.abi;
        const { functionName } = decodeFunctionData({ abi, data: request.data });
        const values: Record<string, unknown> = {
          name: 'Milestone', symbol: 'MILE', decimals: 18, totalSupply: 1_000_000_000n,
          balanceOf: 100n, allowance: 50n, escrowCount: 8n, totalLocked: 99n,
          token: options.wrongToken ? alternate : token.address,
        };
        let result = values[functionName];
        if (functionName === 'getEscrow') result = {
          funder: account, recipient: alternate, arbiter: account,
          totalAmount: 10n, remainingAmount: 10n, cancelled: false,
          milestones: [{ amount: 10n, deadline: 8192n, status: 0 }],
        };
        if (functionName === 'approve') {
          result = true;
          if (options.changeAccountAfterSimulation) changedAccount = true;
        }
        if (functionName !== 'token' && functionName !== 'approve') snapshotBlocks.push(params[1]);
        return encodeFunctionResult({ abi, functionName, result });
      }
      throw new Error(`Unexpected mock RPC method ${method}`);
    },
  } as WalletProvider;
  return { provider, methods, snapshotBlocks, signatureRequests: () => signatureRequests };
}

const approve = (provider: WalletProvider, onHash?: (hash: Hash) => void) =>
  sendContract(config, provider, account, token.address, token.abi, 'approve', [escrow.address, 1n], undefined, onHash);

test('live snapshots use one block and page six contiguous escrow IDs newest first', async () => {
  const mock = mockProvider();
  const snapshot = await readSnapshot(config, account, 0, mock.provider);
  expect(snapshot).toMatchObject({ verified: true, name: 'Milestone', balance: 100n, blockNumber: 291n });
  expect(snapshot.escrows.map(item => item.id)).toEqual([8n, 7n, 6n, 5n, 4n, 3n]);
  expect(mock.snapshotBlocks.length).toBeGreaterThan(0);
  expect(mock.snapshotBlocks.every(block => block === '0x123')).toBe(true);
  expect((await readSnapshot(config, account, 1, mock.provider)).escrows.map(item => item.id)).toEqual([2n, 1n]);
  expect(mock.signatureRequests()).toBe(0);
});

test('missing deployed bytecode prevents verified state and any signature', async () => {
  const mock = mockProvider({ missingCode: true });
  await expect(readSnapshot(config, account, 0, mock.provider)).rejects.toThrow('No deployed code');
  await expect(approve(mock.provider)).rejects.toThrow('No deployed code');
  expect(mock.signatureRequests()).toBe(0);
});

test('an escrow bound to a different immutable token blocks reads and signatures', async () => {
  const mock = mockProvider({ wrongToken: true });
  await expect(readSnapshot(config, account, 0, mock.provider)).rejects.toThrow('Escrow currency');
  await expect(approve(mock.provider)).rejects.toThrow('Escrow currency');
  expect(mock.signatureRequests()).toBe(0);
});

test('an account change during simulation is rejected before requesting a signature', async () => {
  const mock = mockProvider({ changeAccountAfterSimulation: true });
  await expect(approve(mock.provider)).rejects.toThrow('selected wallet account changed');
  expect(mock.signatureRequests()).toBe(0);
});

test('the wrong wallet chain prevents simulation and signature requests', async () => {
  const mock = mockProvider({ wrongChain: true });
  await expect(approve(mock.provider)).rejects.toThrow('Switch your wallet');
  expect(mock.methods).not.toContain('eth_call');
  expect(mock.signatureRequests()).toBe(0);
});

test('a transaction target outside the deployment configuration is refused before RPC', async () => {
  const mock = mockProvider();
  await expect(sendContract(config, mock.provider, account, alternate, token.abi, 'approve', [escrow.address, 1n])).rejects.toThrow('Transaction target');
  expect(mock.methods).toEqual([]);
});

test('wallet signature rejection reports a declined request without a transaction hash', async () => {
  const mock = mockProvider({ rejectSignature: true });
  const hashes: Hash[] = [];
  let failure: unknown;
  try { await approve(mock.provider, hash => hashes.push(hash)); } catch (error) { failure = error; }
  expect(failure).toBeTruthy();
  expect(errorMessage(failure)).toContain('Request declined in your wallet');
  expect(mock.signatureRequests()).toBe(1);
  expect(hashes).toEqual([]);
});

for (const replacement of ['cancelled', 'replaced', 'repriced'] as const) {
  test(`a ${replacement} receipt updates the explorer hash and ${replacement === 'repriced' ? 'confirms' : 'does not confirm'} the requested action`, async () => {
    const mock = mockProvider({ replacement });
    const hashes: Hash[] = [];
    const pending = approve(mock.provider, hash => hashes.push(hash));
    if (replacement === 'repriced') expect((await pending).status).toBe('success');
    else await expect(pending).rejects.toThrow(`${replacement} in your wallet`);
    expect(hashes).toEqual([originalHash, replacementHash]);
    expect(mock.signatureRequests()).toBe(1);
  });
}
