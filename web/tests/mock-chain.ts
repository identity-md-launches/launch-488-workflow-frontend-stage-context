import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbi, parseEther, toHex, type Abi, type Address, type Hex } from 'viem';

// All deployment addresses and network routes come from the exported runtime configuration.
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../dist/imd-deployment.json', import.meta.url)), 'utf8'));
const contract = (name: string) => manifest.contracts.find((entry: {name: string}) => entry.name === name);
const loadAbi = (name: string): Abi => JSON.parse(readFileSync(fileURLToPath(new URL(`../../dist/${contract(name).abiPath}`, import.meta.url)), 'utf8'));
const tokenAbi = loadAbi('LaunchToken');
const escrowAbi = loadAbi('MilestoneEscrow');
export const tokenAddress = contract('LaunchToken').address.toLowerCase() as Address;
export const escrowAddress = contract('MilestoneEscrow').address.toLowerCase() as Address;
export const network = manifest.network;
export const roles = {
  funder: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  arbiter: '0x3333333333333333333333333333333333333333',
  outsider: '0x4444444444444444444444444444444444444444',
} as const;
const permitAbi = parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const swapAbi = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
type Milestone = { amount: bigint; deadline: bigint; status: number };
type Escrow = { funder: Address; recipient: Address; arbiter: Address; totalAmount: bigint; remainingAmount: bigint; cancelled: boolean; milestones: Milestone[] };
type Request = { id: number; method: string; params?: unknown[] };
type Transaction = { to: Address; from?: Address; data: Hex; value?: Hex };
export type MockOptions = { account?: Address; wallet?: boolean; rejectConnect?: boolean; wrongChain?: boolean; unknownChain?: boolean; rejectTransactions?: boolean; rpcFailure?: boolean; noCode?: boolean; simulationFailure?: boolean; quoteFailure?: boolean; transactionDelayMs?: number };

export async function installMockChain(page: Page, options: MockOptions = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const account = options.account ?? roles.funder;
  const escrows: Escrow[] = [
    { ...roles, totalAmount: parseEther('90'), remainingAmount: parseEther('90'), cancelled: false, milestones: [
      { amount: parseEther('20'), deadline: now + 86_400n, status: 0 },
      { amount: parseEther('30'), deadline: now - 86_400n, status: 1 },
      { amount: parseEther('40'), deadline: now - 86_400n, status: 0 },
    ] },
    { ...roles, totalAmount: parseEther('15'), remainingAmount: parseEther('15'), cancelled: true, milestones: [
      { amount: parseEther('15'), deadline: now - 86_400n, status: 1 },
    ] },
  ];
  const allowances = new Map<string, bigint>();
  let permitAmount = 0n;
  const sent: { tx: Transaction; name: string; args: readonly unknown[] }[] = [];
  const calls: { to: string; name: string; args: readonly unknown[] }[] = [];
  const failures: string[] = [];
  const hash = (index: number) => `0x${index.toString(16).padStart(64, '0')}` as Hex;
  const blockHash = hash(9876);
  const block = () => ({ number: '0xb43a80', hash: blockHash, parentHash: hash(9875), timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))), gasLimit: '0x1c9c380', gasUsed: '0x5208', baseFeePerGas: '0x3b9aca00', difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', logsBloom: `0x${'0'.repeat(512)}`, miner: roles.funder, mixHash: hash(0), nonce: '0x0000000000000000', receiptsRoot: hash(0), sha3Uncles: hash(0), size: '0x100', stateRoot: hash(0), transactionsRoot: hash(0), transactions: [], uncles: [], withdrawals: [] });

  function contractCall(tx: Transaction, mutate = false): Hex {
    const to = tx.to.toLowerCase();
    if (options.simulationFailure && to === network.uniswapV4.universalRouter.toLowerCase() && !mutate) throw new Error('execution reverted: mocked router simulation failure');
    if (to === network.uniswapV4.quoter.toLowerCase()) {
      if (options.quoteFailure) throw new Error('execution reverted: mocked insufficient liquidity');
      calls.push({ to, name: 'quoteExactInputSingle', args: [] });
      return encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [parseEther('12.5'), 150000n]);
    }
    const abi = to === tokenAddress ? tokenAbi : to === escrowAddress ? escrowAbi : to === network.uniswapV4.permit2.toLowerCase() ? permitAbi : to === network.uniswapV4.universalRouter.toLowerCase() ? swapAbi : undefined;
    if (!abi) throw new Error(`Unmocked contract ${to}`);
    const decoded = decodeFunctionData({ abi, data: tx.data });
    const name = decoded.functionName;
    const args = (decoded.args ?? []) as readonly any[];
    if (mutate) sent.push({ tx, name, args }); else calls.push({ to, name, args });
    const result = (value?: unknown) => encodeFunctionResult({ abi, functionName: name, result: value } as any);
    if (to === tokenAddress) {
      if (name === 'name') return result('Milestone');
      if (name === 'symbol') return result('MILE');
      if (name === 'decimals') return result(18);
      if (name === 'totalSupply') return result(parseEther('1000000000'));
      if (name === 'balanceOf') return result(args[0].toLowerCase() === escrowAddress ? escrows.reduce((sum, escrow) => sum + escrow.remainingAmount, 0n) : parseEther('10000'));
      if (name === 'allowance') return result(allowances.get(args[1].toLowerCase()) ?? 0n);
      if (name === 'approve') { if (mutate) allowances.set(args[0].toLowerCase(), args[1]); return result(true); }
    }
    if (to === network.uniswapV4.permit2.toLowerCase()) {
      if (name === 'allowance') return result([permitAmount, Number(now + 3600n), 0]);
      if (name === 'approve') { if (mutate) permitAmount = args[2]; return '0x'; }
    }
    if (to === network.uniswapV4.universalRouter.toLowerCase()) return '0x';
    if (to === escrowAddress) {
      if (name === 'token') return result(tokenAddress);
      if (name === 'MAX_MILESTONES') return result(5n);
      if (name === 'escrowCount') return result(BigInt(escrows.length));
      if (name === 'totalLocked') return result(escrows.reduce((sum, escrow) => sum + escrow.remainingAmount, 0n));
      if (name === 'getEscrow') return result(escrows[Number(args[0]) - 1]);
      if (name === 'getMilestone') return result(escrows[Number(args[0]) - 1].milestones[Number(args[1])]);
      if (name === 'openEscrow') {
        if (mutate) { const amounts = args[2] as bigint[]; const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0n); escrows.push({ funder: tx.from ?? account, recipient: args[0], arbiter: args[1], totalAmount, remainingAmount: totalAmount, cancelled: false, milestones: amounts.map((amount, i) => ({ amount, deadline: args[3][i], status: 0 })) }); }
        return result(BigInt(escrows.length + (mutate ? 0 : 1)));
      }
      if (mutate) {
        const escrow = escrows[Number(args[0]) - 1];
        const milestone = escrow.milestones[Number(args[1])];
        if (name === 'approveMilestone') milestone.status = 1;
        if (name === 'claimMilestone' || name === 'reclaimMilestone') { milestone.status = name === 'claimMilestone' ? 2 : 3; escrow.remainingAmount -= milestone.amount; }
        if (name === 'cancelEscrow') { escrow.cancelled = true; for (const item of escrow.milestones) if (item.status === 0) { item.status = 3; escrow.remainingAmount -= item.amount; } }
      }
      return '0x';
    }
    throw new Error(`Unmocked ${name}`);
  }

  function respond(request: Request) {
    const params = request.params ?? [];
    try {
      if (options.rpcFailure) throw new Error('Mocked RPC unavailable');
      let result: unknown;
      switch (request.method) {
        case 'eth_chainId': result = toHex(manifest.chainId); break;
        case 'eth_getCode': result = options.noCode ? '0x' : '0x60006000'; break;
        case 'eth_getBalance': result = toHex(parseEther('100')); break;
        case 'eth_blockNumber': result = block().number; break;
        case 'eth_getBlockByNumber': case 'eth_getBlockByHash': result = block(); break;
        case 'eth_getTransactionCount': result = '0x0'; break;
        case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
        case 'eth_estimateGas': result = '0x493e0'; break;
        case 'eth_call': result = contractCall(params[0] as Transaction); break;
        case 'eth_sendTransaction': contractCall(params[0] as Transaction, true); result = hash(sent.length); break;
        case 'eth_getTransactionReceipt': {
          const item = sent[Number(BigInt(params[0] as string)) - 1];
          result = item ? { transactionHash: params[0], transactionIndex: '0x0', blockHash, blockNumber: block().number, from: item.tx.from ?? account, to: item.tx.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' } : null; break;
        }
        default: throw new Error(`Unmocked RPC method ${request.method}`);
      }
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      const message = (error as Error).message;
      failures.push(message);
      if (message.startsWith('execution reverted:')) {
        const reason = message.slice('execution reverted:'.length).trim();
        return { jsonrpc: '2.0', id: request.id, error: { code: 3, message, data: `0x08c379a0${encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)}` } };
      }
      return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message } };
    }
  }
  for (const url of network.rpcUrls) await page.route(url, async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(request) ? request.map(respond) : respond(request)) });
  });
  if (options.wallet !== false) await page.addInitScript(({ account, options, rpcUrl, chainId }) => {
    const listeners = new Map<string, ((value: unknown) => void)[]>();
    let chain = options.wrongChain ? '0x1' : chainId;
    let known = !options.unknownChain;
    let connected = false;
    let selectedAccount = account;
    const walletCalls: { method: string; params?: unknown }[] = [];
    const ethereum = {
      isMetaMask: true,
      on(event: string, handler: (value: unknown) => void) { listeners.set(event, [...(listeners.get(event) ?? []), handler]); },
      removeListener(event: string, handler: (value: unknown) => void) { listeners.set(event, (listeners.get(event) ?? []).filter(value => value !== handler)); },
      async request(request: { method: string; params?: any[] }) {
        walletCalls.push(request);
        if (request.method === 'eth_requestAccounts') { if (options.rejectConnect) throw Object.assign(new Error('User rejected the request'), { code: 4001 }); connected = true; return [selectedAccount]; }
        if (request.method === 'eth_accounts') return connected ? [selectedAccount] : [];
        if (request.method === 'eth_chainId') return chain;
        if (request.method === 'wallet_switchEthereumChain') { if (!known) throw Object.assign(new Error('Unknown chain'), { code: 4902 }); chain = request.params?.[0].chainId; for (const listener of listeners.get('chainChanged') ?? []) listener(chain); return null; }
        if (request.method === 'wallet_addEthereumChain') { known = true; return null; }
        if (request.method === 'eth_sendTransaction' && options.rejectTransactions) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
        if (request.method === 'eth_sendTransaction' && options.transactionDelayMs) await new Promise(resolve => setTimeout(resolve, options.transactionDelayMs));
        if (request.method === 'wallet_getCapabilities') return {};
        const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, jsonrpc: '2.0', id: Date.now() }) }).then(response => response.json());
        if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
        return response.result;
      },
    };
    Object.assign(window, { ethereum, walletCalls, walletTestChangeAccount: (value: typeof account) => { selectedAccount = value; for (const listener of listeners.get('accountsChanged') ?? []) listener([value]); } });
  }, { account, options, rpcUrl: network.rpcUrls[0], chainId: toHex(manifest.chainId) });
  return { sent, calls, failures, escrows, allowances };
}
