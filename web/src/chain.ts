import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  fallback,
  http,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Transport,
} from 'viem'
import { contract, type LoadedDeployment } from './config'

export type WalletProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

export type Milestone = {
  amount: bigint
  deadline: bigint
  status: 0 | 1 | 2 | 3
}

export type Escrow = {
  id: bigint
  funder: Address
  recipient: Address
  arbiter: Address
  totalAmount: bigint
  remainingAmount: bigint
  cancelled: boolean
  milestones: Milestone[]
}

export type Snapshot = {
  verified: true
  name: string
  symbol: string
  decimals: number
  supply: bigint
  balance: bigint
  allowance: bigint
  nativeBalance: bigint
  escrowCount: bigint
  totalLocked: bigint
  timestamp: bigint
  blockNumber: bigint
  escrows: Escrow[]
  page: number
  pageSize: number
}

/** Configured public RPCs are tried first. A wallet is a read fallback only on this chain. */
export async function publicClient(config: LoadedDeployment, provider?: WalletProvider) {
  const urls = config.network?.rpcUrls ?? []
  const transports: Transport[] = urls.map(url => http(url, { timeout: 12_000, retryCount: 0 }))
  if (provider) {
    try {
      const chainId = await provider.request({ method: 'eth_chainId' })
      if (Number(chainId) === config.chainId) transports.push(custom(provider, { retryCount: 0 }))
    } catch {
      // Wallet read access is optional when public RPCs are configured.
    }
  }
  if (!transports.length) throw new Error('No RPC is available. Connect a wallet on the deployment network to read contract state.')
  const chain = defineChain({
    id: config.chainId,
    name: config.network?.name ?? `Chain ${config.chainId}`,
    nativeCurrency: config.network?.nativeCurrency ?? { name: 'Native currency', symbol: 'Native', decimals: 18 },
    rpcUrls: { default: { http: urls } },
  })
  return createPublicClient({ chain, transport: fallback(transports, { retryCount: 0 }), batch: { multicall: false } })
}

/** Check actual chain responses, code presence, and the escrow's immutable token binding. */
async function verifyDeployment(config: LoadedDeployment, client: Awaited<ReturnType<typeof publicClient>>) {
  if (await client.getChainId() !== config.chainId) {
    throw new Error('RPC network does not match the deployment. Transactions are disabled.')
  }
  const contracts = await Promise.all(config.contracts.map(async deployed => ({
    name: deployed.name,
    code: await client.getCode({ address: deployed.address }),
  })))
  const missing = contracts.find(deployed => !deployed.code || deployed.code === '0x')
  if (missing) throw new Error(`No deployed code was found for ${missing.name}. Transactions are disabled.`)
  const token = contract(config, 'LaunchToken')
  const escrow = contract(config, 'MilestoneEscrow')
  const currency = await client.readContract({ address: escrow.address, abi: escrow.abi, functionName: 'token' })
  if (typeof currency !== 'string' || currency.toLowerCase() !== token.address.toLowerCase()) {
    throw new Error('Escrow currency does not match the deployed token. Transactions are disabled.')
  }
}

/** Every displayed value in one snapshot is pinned to the same latest block. IDs start at 1. */
export async function readSnapshot(config: LoadedDeployment, account?: Address, page = 0, provider?: WalletProvider): Promise<Snapshot> {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid escrow page.')
  const client = await publicClient(config, provider)
  await verifyDeployment(config, client)
  const block = await client.getBlock()
  const blockNumber = block.number
  const token = contract(config, 'LaunchToken')
  const escrow = contract(config, 'MilestoneEscrow')
  const tokenRead = (functionName: string, args: readonly unknown[] = []) => client.readContract({
    address: token.address, abi: token.abi, functionName, args, blockNumber,
  })
  const escrowRead = (functionName: string, args: readonly unknown[] = []) => client.readContract({
    address: escrow.address, abi: escrow.abi, functionName, args, blockNumber,
  })
  const [name, symbol, decimals, supply, escrowCount, totalLocked, balance, allowance, nativeBalance] = await Promise.all([
    tokenRead('name'), tokenRead('symbol'), tokenRead('decimals'), tokenRead('totalSupply'),
    escrowRead('escrowCount'), escrowRead('totalLocked'),
    account ? tokenRead('balanceOf', [account]) : Promise.resolve(0n),
    account ? tokenRead('allowance', [account, escrow.address]) : Promise.resolve(0n),
    account ? client.getBalance({ address: account, blockNumber }) : Promise.resolve(0n),
  ])
  if (typeof name !== 'string' || typeof symbol !== 'string' || typeof decimals !== 'number'
    || typeof supply !== 'bigint' || typeof escrowCount !== 'bigint' || typeof totalLocked !== 'bigint'
    || typeof balance !== 'bigint' || typeof allowance !== 'bigint') {
    throw new Error('Contract state returned an unexpected format. Try refreshing.')
  }
  const pageSize = 6
  const firstId = escrowCount - BigInt(page * pageSize)
  const ids = Array.from({ length: pageSize }, (_, index) => firstId - BigInt(index)).filter(id => id > 0n)
  const escrows = await Promise.all(ids.map(async id => ({
    ...(await escrowRead('getEscrow', [id]) as Omit<Escrow, 'id'>), id,
  })))
  return {
    verified: true, name, symbol, decimals, supply, balance, allowance, nativeBalance,
    escrowCount, totalLocked, timestamp: block.timestamp, blockNumber, escrows, page, pageSize,
  }
}

async function assertWallet(config: LoadedDeployment, provider: WalletProvider, account: Address) {
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }),
    provider.request({ method: 'eth_accounts' }),
  ])
  if (Number(chainId) !== config.chainId) throw new Error(`Switch your wallet to ${config.network?.name ?? `chain ${config.chainId}`} before continuing.`)
  if (!accounts[0] || accounts[0].toLowerCase() !== account.toLowerCase()) {
    throw new Error('The selected wallet account changed. Reconnect and review the action again.')
  }
}

/** Simulate, recheck wallet identity, request one signature, then wait for a successful receipt. */
export async function sendContract(
  config: LoadedDeployment,
  provider: WalletProvider,
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  value?: bigint,
  onHash?: (hash: Hash) => void,
) {
  const allowedTargets = [
    ...config.contracts.map(deployed => deployed.address),
    config.network?.uniswapV4.universalRouter,
    config.network?.uniswapV4.permit2,
  ].filter((target): target is Address => !!target)
  if (!allowedTargets.some(target => target.toLowerCase() === address.toLowerCase())) {
    throw new Error('Transaction target is not in the verified deployment configuration.')
  }
  await assertWallet(config, provider, account)
  const client = await publicClient(config, provider)
  await verifyDeployment(config, client)
  const simulation = await client.simulateContract({ address, abi, functionName, args, account, value })
  await assertWallet(config, provider, account)
  const wallet = createWalletClient({ chain: client.chain, account, transport: custom(provider) })
  const hash = await wallet.writeContract(simulation.request)
  onHash?.(hash)
  let replacementReason: 'cancelled' | 'replaced' | 'repriced' | undefined
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
    onReplaced: ({ reason, transactionReceipt }) => {
      replacementReason = reason
      onHash?.(transactionReceipt.transactionHash)
    },
  })
  if (replacementReason === 'cancelled') throw new Error('The transaction was cancelled in your wallet. The requested action did not complete.')
  if (replacementReason === 'replaced') throw new Error('The transaction was replaced in your wallet. Check its explorer link; the original action was not confirmed.')
  if (receipt.status !== 'success') throw new Error('The transaction was mined but reverted. No requested contract action completed. Refresh the current state before retrying.')
  return receipt
}

const contractErrors: Record<string, string> = {
  InvalidToken: 'The escrow currency is invalid.',
  InvalidParty: 'Use valid, nonzero recipient and arbiter addresses other than the escrow contract.',
  InvalidMilestoneCount: 'An escrow needs between one and five milestones.',
  ArrayLengthMismatch: 'Every milestone needs an amount and a deadline.',
  InvalidAmount: 'Every milestone amount must be greater than zero.',
  InvalidDeadline: 'Every deadline must be later than the latest block time.',
  EscrowNotFound: 'That escrow does not exist. Refresh the list.',
  MilestoneNotFound: 'That milestone does not exist. Refresh the list.',
  Unauthorized: 'The connected account is not authorized for this action.',
  EscrowCancelled: 'This escrow is already cancelled. Approved milestones remain claimable.',
  InvalidMilestoneStatus: 'This milestone has changed state. Refresh before trying again.',
  DeadlinePassed: 'The milestone deadline has passed; it can no longer be approved.',
  DeadlineNotPassed: 'The milestone can be reclaimed only after its deadline.',
  IncorrectDepositAmount: 'The full token deposit could not be verified.',
  ERC20InsufficientBalance: 'There is not enough MILE in this account.',
  ERC20InsufficientAllowance: 'Approve enough MILE for this action first.',
  SafeERC20FailedOperation: 'The token transfer failed. Check your balance and approval.',
}

export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const rejected = error.walk(cause => !!cause && typeof cause === 'object' && 'code' in cause && cause.code === 4001)
    if (rejected && 'code' in rejected && rejected.code === 4001) return 'Request declined in your wallet. No new transaction was submitted.'
    const reverted = error.walk(cause => cause instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && contractErrors[name]) return contractErrors[name]
      if (name) return `Simulation reverted (${name}). Review the amount, permissions and current state.`
      if (reverted.reason) return `Simulation reverted: ${reverted.reason}`
    }
    if (/timed out.*receipt|receipt.*timed out/i.test(error.message)) {
      return 'The transaction was submitted but confirmation is taking longer than expected. Check its explorer link before retrying.'
    }
    return error.shortMessage
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 4001) {
    return 'Request declined in your wallet. No new transaction was submitted.'
  }
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.'
}
