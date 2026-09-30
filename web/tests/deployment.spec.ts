import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodeAbiParameters, parseAbiParameters, zeroAddress, type Abi } from 'viem';
import { canonicalAbiHash, loadDeployment, type Deployment, type LoadedDeployment } from '../src/config';
import { encodeSwap, quoteParams } from '../src/uniswap';

const input = JSON.parse(readFileSync(new URL('../config/deployment-input.json', import.meta.url), 'utf8'));
const network = JSON.parse(readFileSync(new URL('../config/network-input.json', import.meta.url), 'utf8'));
const manifest: Deployment = {
  version: 1, launchId: input.launchId, chainId: input.chainId, sourceCommit: input.sourceCommit,
  attestationHash: input.attestationHash, assets: [], ...network,
  contracts: input.contracts.map((entry: { name: string }) => ({ ...entry, abiPath: `abi/${entry.name}.json` })),
};
const abis = Object.fromEntries(manifest.contracts.map(entry => [entry.name, JSON.parse(readFileSync(new URL(`../../docs/abi/${entry.name}.json`, import.meta.url), 'utf8')) as Abi]));
const config: LoadedDeployment = { ...manifest, abis };
const token = manifest.contracts.find(entry => entry.name === 'LaunchToken')!.address;

test('implementation ABI hashes match both attested contract hashes', () => {
  for (const entry of manifest.contracts) expect(canonicalAbiHash(abis[entry.name])).toBe(entry.abiHash);
});

for (const tokenIn of [false, true]) {
  test(`${tokenIn ? 'MILE → ETH' : 'ETH → MILE'} uses configured router and exact V4 settlement encoding`, () => {
    const swap = encodeSwap(config, tokenIn, 100n, 90n, 123456n);
    expect(swap.address).toBe(config.network!.uniswapV4.universalRouter);
    expect(swap.value).toBe(tokenIn ? 0n : 100n);
    expect(swap.args[0]).toBe('0x10');
    expect(swap.args[2]).toBe(123456n);
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), swap.args[1][0]);
    expect(actions).toBe('0x060c0f');
    expect(params).toHaveLength(3);
    const [exact] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0]);
    expect(exact.poolKey.currency0).toBe(zeroAddress);
    expect(exact.poolKey.currency1.toLowerCase()).toBe(token);
    expect(exact.poolKey.hooks).toBe(zeroAddress);
    expect(exact.poolKey.fee).toBe(3000);
    expect(exact.poolKey.tickSpacing).toBe(60);
    expect(exact.zeroForOne).toBe(!tokenIn);
    expect(exact.amountIn).toBe(100n);
    expect(exact.amountOutMinimum).toBe(90n);
    const [inputCurrency, amountIn] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[1]);
    const [outputCurrency, minOut] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2]);
    expect(inputCurrency.toLowerCase()).toBe(tokenIn ? token : zeroAddress);
    expect(outputCurrency.toLowerCase()).toBe(tokenIn ? zeroAddress : token);
    expect(amountIn).toBe(100n);
    expect(minOut).toBe(90n);
    expect(quoteParams(config, tokenIn, 100n).zeroForOne).toBe(!tokenIn);
  });
}

test('swap construction rejects zero, overflow and missing vetted network', () => {
  expect(() => encodeSwap(config, false, 0n, 1n, 1n)).toThrow();
  expect(() => encodeSwap(config, false, 1n, 0n, 1n)).toThrow();
  expect(() => encodeSwap(config, false, 2n ** 128n, 1n, 1n)).toThrow();
  expect(() => encodeSwap({ ...config, network: undefined }, false, 1n, 1n, 1n)).toThrow();
});

test('runtime loads manifest and ABI files relative to a gateway subpath and rejects ABI tampering', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetched: string[] = [];
  let corrupt = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'https://gateway.example/ipfs/site/index.html' } } });
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const pathname = new URL(String(url)).pathname;
    fetched.push(pathname);
    const entry = manifest.contracts.find(candidate => pathname.endsWith(candidate.abiPath));
    return new Response(JSON.stringify(entry ? (corrupt ? [] : abis[entry.name]) : manifest), { status: 200 });
  }) as typeof fetch;
  try {
    const loaded = await loadDeployment();
    expect(loaded.contracts).toEqual(manifest.contracts);
    expect(fetched).toContain('/ipfs/site/imd-deployment.json');
    expect(fetched).toContain('/ipfs/site/abi/LaunchToken.json');
    expect(fetched).toContain('/ipfs/site/abi/MilestoneEscrow.json');
    corrupt = true;
    await expect(loadDeployment()).rejects.toThrow('ABI failed attestation verification');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
