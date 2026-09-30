import { encodeAbiParameters, parseAbi, parseAbiParameters, type Address, type Hex, zeroAddress } from 'viem';
import { contract, poolKey, type LoadedDeployment } from './config';

export const quoteAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
export const routerAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
export const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const exactInputType = parseAbiParameters('( (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)');

export function swapCurrencies(config: LoadedDeployment, tokenIn: boolean): { input: Address; output: Address; zeroForOne: boolean } {
  const key = poolKey(config);
  const token = contract(config, 'LaunchToken').address;
  const paired = key.currency0.toLowerCase() === token.toLowerCase() ? key.currency1 : key.currency0;
  const input = tokenIn ? token : paired;
  const output = tokenIn ? paired : token;
  return { input, output, zeroForOne: input.toLowerCase() === key.currency0.toLowerCase() };
}
export function quoteParams(config: LoadedDeployment, tokenIn: boolean, amountIn: bigint) {
  if (amountIn <= 0n || amountIn >= 2n ** 128n) throw new Error('Swap amount is outside the supported range.');
  return { poolKey: poolKey(config), zeroForOne: swapCurrencies(config, tokenIn).zeroForOne, exactAmount: amountIn, hookData: '0x' as Hex };
}
export function encodeSwap(config: LoadedDeployment, tokenIn: boolean, amountIn: bigint, minOut: bigint, deadline: bigint) {
  if (!config.network) throw new Error('Swaps are unavailable because this deployment has no vetted network configuration.');
  if (amountIn <= 0n || minOut <= 0n || amountIn >= 2n ** 128n || minOut >= 2n ** 128n) throw new Error('Swap amounts are outside the supported range.');
  const { input, output, zeroForOne } = swapCurrencies(config, tokenIn);
  const params = [
    encodeAbiParameters(exactInputType, [{ poolKey: poolKey(config), zeroForOne, amountIn, amountOutMinimum: minOut, hookData: '0x' }]),
    encodeAbiParameters(parseAbiParameters('address currency, uint256 amount'), [input, amountIn]),
    encodeAbiParameters(parseAbiParameters('address currency, uint256 amount'), [output, minOut]),
  ];
  const encoded = encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), ['0x060c0f', params]);
  return {
    address: config.network.uniswapV4.universalRouter,
    abi: routerAbi,
    functionName: 'execute' as const,
    args: ['0x10', [encoded], deadline] as const,
    value: input === zeroAddress ? amountIn : 0n,
  };
}
