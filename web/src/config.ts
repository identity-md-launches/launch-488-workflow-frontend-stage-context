import { type Abi, type Address, isAddress, keccak256, stringToHex, zeroAddress } from 'viem';
import poolInput from '../config/pool-input.json' with { type: 'json' };

export type ContractName = 'LaunchToken' | 'MilestoneEscrow';
export type DeploymentContract = { name: string; address: Address; abiHash: string; abiPath: string };
export type Network = {
  chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
  uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address };
};
export type WalletAddChain = {
  chainId: string; chainName: string; rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[];
};
export type Deployment = {
  version: 1; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: DeploymentContract[]; assets: { path: string; sha256: string }[];
  network?: Network; walletAddChain?: WalletAddChain;
};
export type LoadedDeployment = Deployment & { abis: Record<string, Abi> };
export const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : value;
export const canonicalAbiHash = (abi: Abi): string => keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
const safePath = (path: string): boolean => typeof path === 'string' && !!path && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !path.split('/').some(part => !part || part === '.' || part === '..');

/** The exported manifest is the sole runtime source for deployments and network addresses. */
export async function loadDeployment(): Promise<LoadedDeployment> {
  const base = new URL('./', window.location.href);
  const response = await fetch(new URL('imd-deployment.json', base));
  if (!response.ok) throw new Error('The deployment configuration could not be loaded.');
  const config: Deployment = await response.json();
  const keys = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain'];
  if (Object.keys(config).some(key => !keys.includes(key)) || config.version !== 1 || !Number.isSafeInteger(config.chainId) || config.chainId <= 0 || !/^[a-f0-9]{40}$/.test(config.sourceCommit) || !/^[a-f0-9]{64}$/.test(config.attestationHash) || !Array.isArray(config.contracts) || !Array.isArray(config.assets)) throw new Error('The deployment configuration is invalid.');
  if (config.network && (config.network.chainId !== config.chainId || !config.network.rpcUrls.length || Object.values(config.network.uniswapV4).some(address => !isAddress(address)))) throw new Error('The network configuration is invalid.');
  if (config.walletAddChain && BigInt(config.walletAddChain.chainId) !== BigInt(config.chainId)) throw new Error('The wallet network configuration is invalid.');
  if (new Set(config.contracts.map(entry => entry.name)).size !== config.contracts.length) throw new Error('Duplicate deployment contract.');
  const abis = Object.fromEntries(await Promise.all(config.contracts.map(async entry => {
    if (!isAddress(entry.address) || !safePath(entry.abiPath) || !/^[a-f0-9]{64}$/.test(entry.abiHash)) throw new Error('The contract configuration is invalid.');
    const abiResponse = await fetch(new URL(entry.abiPath, base));
    if (!abiResponse.ok) throw new Error(`${entry.name} ABI could not be loaded.`);
    const abi: Abi = await abiResponse.json();
    if (!Array.isArray(abi) || canonicalAbiHash(abi) !== entry.abiHash) throw new Error(`${entry.name} ABI failed attestation verification.`);
    return [entry.name, abi];
  })));
  const loaded = { ...config, abis };
  contract(loaded, 'LaunchToken');
  contract(loaded, 'MilestoneEscrow');
  return loaded;
}

export function contract(config: LoadedDeployment, name: ContractName | string): DeploymentContract & { abi: Abi } {
  const entry = config.contracts.find(candidate => candidate.name === name);
  if (!entry || !config.abis[name]) throw new Error(`Missing ${name} deployment.`);
  return { ...entry, abi: config.abis[name] };
}

/** Pool parameters are derived from the attested handoff at build time; token/hook addresses come from the runtime manifest. */
export function poolKey(config: LoadedDeployment) {
  const token = contract(config, poolInput.tokenContract).address;
  const paired = poolInput.pairedCurrency as Address;
  const [currency0, currency1] = BigInt(paired) < BigInt(token) ? [paired, token] : [token, paired];
  return {
    currency0, currency1, fee: poolInput.fee, tickSpacing: poolInput.tickSpacing,
    hooks: poolInput.hookContract ? contract(config, poolInput.hookContract).address : zeroAddress,
  };
}
