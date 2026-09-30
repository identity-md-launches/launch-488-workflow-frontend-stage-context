import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { contract, type LoadedDeployment } from "./config";
import {
  errorMessage,
  publicClient,
  sendContract,
  type Snapshot,
  type WalletProvider,
} from "./chain";
import { encodeSwap, permit2Abi, quoteAbi, quoteParams } from "./uniswap";
import { Feedback, Notice, useAction } from "./components";
import type { Address } from "viem";

type Props = {
  config: LoadedDeployment;
  snapshot?: Snapshot;
  wallet: { provider?: WalletProvider; account?: Address; chain?: number };
  ready: boolean;
  refresh: () => Promise<void>;
};
type Quote = {
  input: bigint;
  output: bigint;
  minimum: bigint;
  expires: number;
  gas: bigint;
};
export default function Swap({
  config,
  snapshot,
  wallet,
  ready,
  refresh,
}: Props) {
  const [tokenIn, setTokenIn] = useState(false);
  const [input, setInput] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [allowance, setAllowance] = useState(0n);
  const [routerAllowance, setRouterAllowance] = useState(0n);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const action = useAction();
  const network = config.network;
  const token = contract(config, "LaunchToken");
  const inputDecimals = tokenIn
    ? (snapshot?.decimals ?? 18)
    : (network?.nativeCurrency.decimals ?? 18);
  const outputDecimals = tokenIn
    ? (network?.nativeCurrency.decimals ?? 18)
    : (snapshot?.decimals ?? 18);
  useEffect(() => {
    generation.current++;
    setQuote(undefined);
    setQuoteError("");
  }, [input, slippage, tokenIn, wallet.account, wallet.chain]);
  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  const fresh = quote && now < quote.expires;
  async function readAllowances() {
    if (!network || !wallet.account) return;
    const client = await publicClient(config, wallet.provider);
    const [tokenAllowance, permitAllowance, block] = await Promise.all([
      client.readContract({
        address: token.address,
        abi: config.abis.LaunchToken,
        functionName: "allowance",
        args: [wallet.account, network.uniswapV4.permit2],
      }),
      client.readContract({
        address: network.uniswapV4.permit2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [
          wallet.account,
          token.address,
          network.uniswapV4.universalRouter,
        ],
      }),
      client.getBlock(),
    ]);
    setAllowance(tokenAllowance as bigint);
    setRouterAllowance(
      BigInt(permitAllowance[1]) > block.timestamp + 300n
        ? permitAllowance[0]
        : 0n,
    );
  }
  async function getQuote(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || !network || !snapshot || quoting) return;
    setQuoting(true);
    setQuoteError("");
    setQuote(undefined);
    const version = generation.current;
    try {
      if (
        !/^\d+(\.\d+)?$/.test(input) ||
        (input.split(".")[1]?.length || 0) > inputDecimals
      )
        throw new Error(
          `Enter a positive amount with at most ${inputDecimals} decimal places.`,
        );
      const amount = parseUnits(input, inputDecimals);
      const percent = Number(slippage);
      if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
      if (
        !/^\d+(\.\d{1,2})?$/.test(slippage) ||
        !Number.isFinite(percent) ||
        percent < 0.1 ||
        percent > 5
      )
        throw new Error(
          "Choose slippage between 0.1% and 5%, with at most two decimal places.",
        );
      if (amount > (tokenIn ? snapshot.balance : snapshot.nativeBalance))
        throw new Error(
          `Your ${tokenIn ? "MILE" : "ETH"} balance is below the swap amount.`,
        );
      const client = await publicClient(config, wallet.provider);
      if ((await client.getChainId()) !== config.chainId)
        throw new Error("The RPC returned the wrong network.");
      for (const name of ["quoter", "universalRouter", "permit2"] as const) {
        const code = await client.getCode({ address: network.uniswapV4[name] });
        if (!code || code === "0x")
          throw new Error(
            `No ${name} contract found on this network. Swaps are disabled.`,
          );
      }
      const result = await client.simulateContract({
        address: network.uniswapV4.quoter,
        abi: quoteAbi,
        functionName: "quoteExactInputSingle",
        args: [quoteParams(config, tokenIn, amount)],
        account: wallet.account,
      });
      const [output, gas] = result.result;
      const minimum =
        (output * (10_000n - BigInt(Math.round(percent * 100)))) / 10_000n;
      if (minimum <= 0n)
        throw new Error(
          "The quote has no usable output. Try a different amount.",
        );
      if (tokenIn) await readAllowances();
      if (generation.current === version) {
        setQuote({
          input: amount,
          output,
          minimum,
          gas,
          expires: Date.now() + 60_000,
        });
        setNow(Date.now());
      }
    } catch (e) {
      if (generation.current === version)
        setQuoteError(
          `${errorMessage(e)} If the pool has no liquidity, try again when liquidity is available.`,
        );
    } finally {
      setQuoting(false);
    }
  }
  const step =
    tokenIn && quote && allowance < quote.input
      ? "token"
      : tokenIn && quote && routerAllowance < quote.input
        ? "permit"
        : "swap";
  async function execute() {
    if (
      !quote ||
      !fresh ||
      !ready ||
      !network ||
      !wallet.account ||
      !wallet.provider ||
      !snapshot
    )
      return;
    await action.run(
      async (onHash) => {
        if (Date.now() >= quote.expires)
          throw new Error(
            "This quote expired. Get a new quote before continuing.",
          );
        if (step === "token")
          await sendContract(
            config,
            wallet.provider!,
            wallet.account!,
            token.address,
            config.abis.LaunchToken,
            "approve",
            [network.uniswapV4.permit2, quote.input],
            undefined,
            onHash,
          );
        else if (step === "permit")
          await sendContract(
            config,
            wallet.provider!,
            wallet.account!,
            network.uniswapV4.permit2,
            permit2Abi,
            "approve",
            [
              token.address,
              network.uniswapV4.universalRouter,
              quote.input,
              Number(snapshot.timestamp + 3600n),
            ],
            undefined,
            onHash,
          );
        else {
          const tx = encodeSwap(
            config,
            tokenIn,
            quote.input,
            quote.minimum,
            snapshot.timestamp + 300n,
          );
          await sendContract(
            config,
            wallet.provider!,
            wallet.account!,
            tx.address,
            tx.abi,
            tx.functionName,
            tx.args,
            tx.value,
            onHash,
          );
          setQuote(undefined);
        }
        await refresh();
        if (tokenIn) await readAllowances();
      },
      step === "swap"
        ? "Swap confirmed. Your balances have refreshed."
        : "Approval confirmed. Continue with the next step.",
    );
  }
  return (
    <div className="panel swap-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">The currency for good work</p>
          <h2>Get MILE.</h2>
          <p>
            Swap in the project’s Uniswap v4 pool on{" "}
            {network?.name || "the configured network"}.
          </p>
        </div>
      </div>
      {!network && (
        <Notice>
          Swaps are unavailable because this deployment has no vetted network
          configuration.
        </Notice>
      )}
      <form onSubmit={getQuote}>
        <fieldset disabled={!ready || action.pending || quoting || !network}>
          <label htmlFor="direction">
            Direction
            <select
              id="direction"
              value={tokenIn ? "sell" : "buy"}
              onChange={(e) => setTokenIn(e.target.value === "sell")}
            >
              <option value="buy">ETH → MILE</option>
              <option value="sell">MILE → ETH</option>
            </select>
          </label>
          <div className="swap-input">
            <label htmlFor="swap-amount">
              You pay
              <input
                id="swap-amount"
                inputMode="decimal"
                placeholder="0.00"
                required
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            <strong>{tokenIn ? "MILE" : "ETH"}</strong>
          </div>
          <p className="fine-print">
            Available:{" "}
            {snapshot
              ? formatUnits(
                  tokenIn ? snapshot.balance : snapshot.nativeBalance,
                  inputDecimals,
                )
              : "—"}{" "}
            {tokenIn ? "MILE" : "ETH"}. Keep some ETH for gas.
          </p>
          <label className="slippage" htmlFor="slippage">
            Slippage tolerance (%)
            <input
              id="slippage"
              inputMode="decimal"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              required
            />
            <small>Your minimum received amount includes this tolerance.</small>
          </label>
          <button
            className="wide"
            type="submit"
            disabled={!ready || action.pending || quoting}
          >
            {quoting ? "Getting quote…" : "Get quote"}
          </button>
        </fieldset>
      </form>
      {quoteError && (
        <p role="alert" className="error">
          {quoteError}
        </p>
      )}
      {quote && (
        <div className="quote-card">
          <dl>
            <div>
              <dt>Estimated received</dt>
              <dd>
                {formatUnits(quote.output, outputDecimals)}{" "}
                {tokenIn ? "ETH" : "MILE"}
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatUnits(quote.minimum, outputDecimals)}{" "}
                {tokenIn ? "ETH" : "MILE"}
              </dd>
            </div>
            <div>
              <dt>Exchange rate</dt>
              <dd>
                1 {tokenIn ? "MILE" : "ETH"} ≈{" "}
                {Number(
                  Number(formatUnits(quote.output, outputDecimals)) /
                    Number(formatUnits(quote.input, inputDecimals)),
                ).toLocaleString(undefined, {
                  maximumSignificantDigits: 6,
                })}{" "}
                {tokenIn ? "ETH" : "MILE"}
              </dd>
            </div>
            <div>
              <dt>Quote validity</dt>
              <dd>
                {fresh
                  ? `${Math.max(0, Math.ceil((quote.expires - now) / 1000))} seconds`
                  : "Expired — get a new quote"}
              </dd>
            </div>
          </dl>
          <p className="fine-print">
            {tokenIn
              ? step === "token"
                ? "Step 1 of 3 · Approve exactly this MILE amount for Permit2."
                : step === "permit"
                  ? "Step 2 of 3 · Allow the configured router to spend this amount through Permit2 for one hour."
                  : "Step 3 of 3 · Swap the reviewed amount through the configured router."
              : "Pay native ETH directly. No token approval is needed."}{" "}
            The swap is simulated before signing and has a five-minute
            transaction deadline.
          </p>
          <button
            className="primary wide"
            disabled={!ready || !fresh || action.pending}
            onClick={() => void execute()}
          >
            {action.pending
              ? "Processing…"
              : step === "token"
                ? "Approve MILE for Permit2"
                : step === "permit"
                  ? "Approve router in Permit2"
                  : "Swap now"}
          </button>
        </div>
      )}
      <Feedback action={action} config={config} />
      <p className="fine-print">
        {!ready
          ? "Connect a wallet on Sepolia and wait for verified live state to continue. "
          : ""}
        Quotes can fail if the pool has no liquidity. USD context is
        unavailable.
      </p>
    </div>
  );
}
