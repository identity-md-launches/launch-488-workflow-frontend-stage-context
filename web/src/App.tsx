import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { loadDeployment, contract, type LoadedDeployment } from "./config";
import {
  readSnapshot,
  sendContract,
  errorMessage,
  type Snapshot,
  type Escrow,
  type WalletProvider,
} from "./chain";
import {
  AddressView,
  Feedback,
  Mark,
  Notice,
  TransactionContext,
  useAction,
} from "./components";
import Swap from "./Swap";

const amount = (value: bigint, decimals = 18) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
    Number(formatUnits(value, decimals)),
  );
const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
type Wallet = { provider?: WalletProvider; account?: Address; chain?: number };
type Shared = {
  config: LoadedDeployment;
  snapshot?: Snapshot;
  wallet: Wallet;
  ready: boolean;
  refresh: () => Promise<void>;
};

export default function App() {
  const [config, setConfig] = useState<LoadedDeployment>();
  const [fatal, setFatal] = useState("");
  useEffect(() => {
    let live = true;
    loadDeployment()
      .then((c) => {
        if (live) setConfig(c);
      })
      .catch((e) => {
        if (live) setFatal(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, []);
  if (fatal)
    return (
      <main className="boot">
        <Mark />
        <h1>Deployment could not be verified</h1>
        <Notice error>{fatal}</Notice>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>
    );
  if (!config)
    return (
      <main className="boot" aria-live="polite">
        <Mark />
        <h1>Opening Milestone</h1>
        <p>Verifying deployment and contract interfaces…</p>
      </main>
    );
  if (!config.network)
    return (
      <main className="boot">
        <h1>Network configuration unavailable</h1>
        <p>
          This export is missing the vetted network configuration. Transactions
          are disabled.
        </p>
      </main>
    );
  return <Dashboard config={config} />;
}
function Dashboard({ config }: { config: LoadedDeployment }) {
  const [busy, setBusy] = useState(false);
  const transactionLock = useRef(false);
  const [transaction, setTransaction] = useState<{
    message: string;
    hash?: Hash;
    error?: boolean;
  }>();
  const guard = {
    begin: () => {
      if (transactionLock.current) return false;
      transactionLock.current = true;
      setBusy(true);
      setTransaction({
        message:
          "Transaction in progress. Keep this page open until confirmation.",
      });
      return true;
    },
    submitted: (hash: Hash) =>
      setTransaction({
        message: "Transaction submitted. Waiting for confirmation…",
        hash,
      }),
    end: (message: string, error: boolean) => {
      transactionLock.current = false;
      setBusy(false);
      setTransaction((t) => ({ ...t, message, error }));
    },
  };
  const [wallet, setWallet] = useState<Wallet>({});
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"escrows" | "open" | "swap">("escrows");
  const identity = `${wallet.account || ""}:${wallet.chain || ""}:${page}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const walletSequence = useRef(0);
  const epoch = useRef(0);
  const activeReads = useRef(0);
  useEffect(() => {
    const provider = (window as unknown as { ethereum?: WalletProvider })
      .ethereum;
    if (!provider) return;
    let live = true;
    const update = async () => {
      const sequence = ++walletSequence.current;
      epoch.current++;
      setWallet({ provider });
      setSnapshot(undefined);
      setReadError("");
      try {
        const [accounts, chain] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (live && sequence === walletSequence.current)
          setWallet({
            provider,
            account: (accounts as Address[])[0],
            chain: Number(chain),
          });
      } catch (e) {
        if (live && sequence === walletSequence.current)
          setWalletError(errorMessage(e));
      }
    };
    const disconnected = () => {
      walletSequence.current++;
      epoch.current++;
      setSnapshot(undefined);
      setWallet({ provider });
    };
    void update();
    provider.on?.("accountsChanged", update);
    provider.on?.("chainChanged", update);
    provider.on?.("disconnect", disconnected);
    return () => {
      live = false;
      provider.removeListener?.("accountsChanged", update);
      provider.removeListener?.("chainChanged", update);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (latestIdentity.current !== identity) return;
    const version = epoch.current;
    const requestId = ++activeReads.current;
    try {
      const data = await readSnapshot(
        config,
        wallet.account,
        page,
        wallet.provider,
      );
      if (
        version === epoch.current &&
        requestId === activeReads.current &&
        latestIdentity.current === identity
      ) {
        setSnapshot(data);
        setReadError("");
      }
    } catch (e) {
      if (
        version === epoch.current &&
        requestId === activeReads.current &&
        latestIdentity.current === identity
      ) {
        setReadError(errorMessage(e));
        setSnapshot(undefined);
      }
      throw e;
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [config, wallet.account, wallet.chain, wallet.provider, page]);
  useEffect(() => {
    epoch.current++;
    setSnapshot(undefined);
    setLoading(true);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await refresh().catch(() => {});
      if (!stopped) timer = setTimeout(poll, 8000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      epoch.current++;
    };
  }, [refresh]);
  async function connect(switchOnly = false) {
    if (connecting || transactionLock.current) return;
    setConnecting(true);
    setWalletError("");
    const provider = (window as unknown as { ethereum?: WalletProvider })
      .ethereum;
    try {
      if (!provider)
        throw new Error(
          "No browser wallet found. Install an Ethereum browser wallet, then reload this page.",
        );
      if (switchOnly) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${config.chainId.toString(16)}` }],
          });
        } catch (e) {
          if (
            (e as { code?: number }).code !== 4902 &&
            !/unknown chain|unrecognized chain|not added/i.test(
              String((e as Error).message),
            )
          )
            throw e;
          if (!config.walletAddChain)
            throw new Error(
              "This wallet does not know this network. Add the configured network in your wallet.",
            );
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [config.walletAddChain],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${config.chainId.toString(16)}` }],
          });
        }
      }
      const sequence = ++walletSequence.current;
      const accounts = (await provider.request({
        method: switchOnly ? "eth_accounts" : "eth_requestAccounts",
      })) as Address[];
      const chain = Number(await provider.request({ method: "eth_chainId" }));
      epoch.current++;
      setSnapshot(undefined);
      if (sequence === walletSequence.current)
        setWallet({ provider, account: accounts[0], chain });
    } catch (e) {
      setWalletError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }
  const wrong = !!wallet.account && wallet.chain !== config.chainId;
  const ready = !!wallet.account && !wrong && !!snapshot && !readError && !busy;
  const shared = { config, snapshot, wallet, ready, refresh };
  const token = contract(config, "LaunchToken");
  return (
    <TransactionContext.Provider value={guard}>
      <a className="skip" href="#workspace">
        Skip to workspace
      </a>
      <header className="header shell">
        <a className="brand" href="#" aria-label="Milestone home">
          <Mark />
          <span>
            milestone<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="wallet-tools">
          <span className="network">
            <span aria-hidden="true">◉</span> {config.network!.name}{" "}
            <span className="testnet">Testnet</span>
          </span>
          {wallet.account ? (
            <>
              <AddressView
                value={wallet.account}
                config={config}
                label="Connected wallet"
              />
              {wrong && (
                <button
                  disabled={connecting || busy}
                  onClick={() => void connect(true)}
                >
                  {connecting
                    ? "Switching…"
                    : `Switch to ${config.network!.name}`}
                </button>
              )}
            </>
          ) : (
            <button
              className="dark"
              disabled={connecting || busy}
              onClick={() => void connect()}
            >
              {connecting ? "Connecting…" : "Connect wallet"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      <main className="shell">
        <section className="hero">
          <div>
            <p className="eyebrow">Work, backed.</p>
            <h1>
              A little trust.
              <br />A clear <span>milestone.</span>
            </h1>
            <p className="hero-description">
              Fund the work. Agree on the milestones.
              <br className="desktop-break" /> Release payment when it’s ready.
            </p>
          </div>
          <div className="flow-card">
            <div className="flow-top">
              <span className="eyebrow">From promise to progress</span>
              <span aria-hidden="true">↗</span>
            </div>
            <ol className="flow">
              <li>
                <span>01</span>
                <strong>Fund</strong>
                <small>Lock MILE upfront</small>
              </li>
              <li>
                <span>02</span>
                <strong>Approve</strong>
                <small>Arbiter checks the work</small>
              </li>
              <li>
                <span>03</span>
                <strong>Release</strong>
                <small>Recipient claims MILE</small>
              </li>
            </ol>
            <div className="flow-bottom">
              <span>Fully funded. No escrow fees.</span>
              <span aria-hidden="true">✓</span>
            </div>
          </div>
        </section>
        <section className="metrics" aria-label="Live contract overview">
          <div>
            <span className="metric-label">The currency</span>
            <strong>
              {snapshot?.symbol || "MILE"}{" "}
              <small>{snapshot?.name || "Milestone"}</small>
            </strong>
          </div>
          <div>
            <span className="metric-label">Fixed token supply</span>
            <strong>
              {snapshot ? amount(snapshot.supply, snapshot.decimals) : "—"}{" "}
              <small>MILE</small>
            </strong>
          </div>
          <div>
            <span className="metric-label">Locked in escrows</span>
            <strong>
              {snapshot ? amount(snapshot.totalLocked, snapshot.decimals) : "—"}{" "}
              <small>MILE</small>
            </strong>
          </div>
          <div>
            <span className="metric-label">Wallet balance</span>
            <strong>
              {wallet.account && snapshot
                ? amount(snapshot.balance, snapshot.decimals)
                : "—"}{" "}
              <small>MILE</small>
            </strong>
          </div>
        </section>
        {transaction && (
          <div
            className={`transaction-status ${transaction.error ? "transaction-error" : ""}`}
            aria-live="polite"
          >
            <p>{transaction.message}</p>
            {transaction.hash && (
              <a
                href={`${config.network!.explorer}/tx/${transaction.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View latest transaction ↗
              </a>
            )}
          </div>
        )}
        {walletError && <Notice error>{walletError}</Notice>}
        {wrong && (
          <Notice>
            Wrong network. Switch to {config.network!.name} to enable
            transactions.
          </Notice>
        )}
        {readError && (
          <Notice error>
            <strong>Live state unavailable.</strong> {readError} Transactions
            are disabled.{" "}
            <button
              onClick={() => {
                setLoading(true);
                void refresh().catch(() => {});
              }}
            >
              Retry reads
            </button>
          </Notice>
        )}
        <div className="workspace" id="workspace">
          <section className="workspace-main">
            <nav className="tabs" aria-label="Workspace">
              <button
                disabled={busy}
                aria-pressed={panel === "escrows"}
                onClick={() => setPanel("escrows")}
              >
                Escrows{" "}
                {snapshot && <span>{snapshot.escrowCount.toString()}</span>}
              </button>
              <button
                disabled={busy}
                aria-pressed={panel === "open"}
                onClick={() => setPanel("open")}
              >
                Open escrow
              </button>
              <button
                disabled={busy}
                aria-pressed={panel === "swap"}
                onClick={() => setPanel("swap")}
              >
                Get MILE <span aria-hidden="true">↗</span>
              </button>
            </nav>
            {!wallet.account && (
              <div className="connect-note">
                <div>
                  <strong>Your wallet is your workspace.</strong>
                  <p>Connect to fund milestones and manage your role.</p>
                </div>
                <button
                  onClick={() => void connect()}
                  disabled={connecting || busy}
                >
                  Connect wallet
                </button>
              </div>
            )}
            {panel === "escrows" ? (
              <>
                <div className="section-heading">
                  <div>
                    <h2>Milestones, made clear.</h2>
                    <p>
                      Every escrow is public. Only its named parties can act.
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => setPanel("open")}
                  >
                    + Open escrow
                  </button>
                </div>
                {loading && !snapshot ? (
                  <div className="empty" role="status">
                    <span className="spinner" />
                    <h3>Reading the ledger…</h3>
                    <p>Checking the deployment and loading escrow state.</p>
                  </div>
                ) : snapshot?.escrows.length ? (
                  <div className="escrows">
                    {snapshot.escrows.map((escrow) => (
                      <EscrowCard
                        key={escrow.id.toString()}
                        {...shared}
                        escrow={escrow}
                      />
                    ))}
                  </div>
                ) : (
                  !readError && (
                    <div className="empty">
                      <div className="empty-icon" aria-hidden="true">
                        ◇
                      </div>
                      <h3>A fresh start for good work.</h3>
                      <p>
                        No escrows yet. Create the first one with a recipient,
                        <br className="desktop-break" /> an arbiter, and a
                        milestone worth reaching.
                      </p>
                      <button onClick={() => setPanel("open")}>
                        Create an escrow <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  )
                )}
                {snapshot && snapshot.escrowCount > 6n && (
                  <div className="pagination">
                    <button
                      disabled={busy || page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Newer escrows
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                      disabled={
                        busy || BigInt((page + 1) * 6) >= snapshot.escrowCount
                      }
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Older escrows
                    </button>
                  </div>
                )}
              </>
            ) : panel === "open" ? (
              <OpenEscrow
                key={`${wallet.account}:${wallet.chain}`}
                {...shared}
              />
            ) : (
              <Swap key={`${wallet.account}:${wallet.chain}`} {...shared} />
            )}
          </section>
          <aside>
            <div className="side-card">
              <div className="side-icon" aria-hidden="true">
                ↗
              </div>
              <h2>
                Clear terms. <br />
                Shared confidence.
              </h2>
              <p>
                Up to five milestones. One fully funded escrow. Everyone knows
                what comes next.
              </p>
              <dl className="roles">
                <div>
                  <dt>Funder</dt>
                  <dd>Deposits MILE and reclaims overdue, unapproved funds.</dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>Claims each approved milestone.</dd>
                </div>
                <div>
                  <dt>Arbiter</dt>
                  <dd>Approves milestones or cancels pending work.</dd>
                </div>
              </dl>
              <p className="fine-print">
                Approval is final. If an escrow is cancelled, approved funds
                remain claimable.
              </p>
            </div>
            <div className="deployment-card">
              <h3>On the record</h3>
              <p className="verified">
                {snapshot
                  ? "✓ Contract code & currency verified"
                  : "○ Awaiting chain verification"}
              </p>
              <div className="contract-row">
                <span>MILE token</span>
                <AddressView
                  config={config}
                  value={token.address}
                  label="MILE token"
                />
              </div>
              <div className="contract-row">
                <span>Milestone escrow</span>
                <AddressView
                  config={config}
                  value={contract(config, "MilestoneEscrow").address}
                  label="Escrow contract"
                />
              </div>
              <p className="fine-print">
                {snapshot
                  ? `Block ${snapshot.blockNumber.toLocaleString()} · refreshes every 8 seconds`
                  : "Live reads use the configured public RPCs."}
              </p>
              <p className="fine-print">
                {config.network!.name} test tokens. USD context is unavailable.
              </p>
              <details>
                <summary>Deployment details</summary>
                <p className="mono">Source: {config.sourceCommit}</p>
                <a
                  href="./imd-deployment.json"
                  target="_blank"
                  rel="noreferrer"
                >
                  View deployment manifest ↗
                </a>
                {config.network!.faucets?.map((url, i) => (
                  <a
                    key={url}
                    className="faucet"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Sepolia ETH faucet {i + 1} ↗
                  </a>
                ))}
              </details>
            </div>
          </aside>
        </div>
        <footer>
          <span className="footer-brand">milestone.</span>
          <span>Good work. Clear terms.</span>
          <span>No admin. No escrow fees.</span>
        </footer>
      </main>
    </TransactionContext.Provider>
  );
}
function OpenEscrow({ config, snapshot, wallet, ready, refresh }: Shared) {
  const [recipient, setRecipient] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [rows, setRows] = useState([{ amount: "", deadline: "" }]);
  const [formError, setFormError] = useState("");
  const action = useAction();
  const token = contract(config, "LaunchToken");
  const escrow = contract(config, "MilestoneEscrow");
  let total = 0n;
  let validAmounts = true;
  try {
    for (const row of rows) {
      if (
        !/^\d+(\.\d+)?$/.test(row.amount) ||
        (row.amount.split(".")[1]?.length || 0) > (snapshot?.decimals ?? 18)
      )
        throw new Error();
      const v = parseUnits(row.amount, snapshot?.decimals ?? 18);
      if (v <= 0n) throw new Error();
      total += v;
    }
  } catch {
    validAmounts = false;
  }
  const needsApproval =
    !snapshot || snapshot.allowance < total || !validAmounts;
  const invalidParty = (v: string) =>
    !isAddress(v.trim()) ||
    same(v.trim(), zeroAddress) ||
    same(v.trim(), escrow.address);
  const [invalidField, setInvalidField] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setInvalidField("");
    if (!ready || !wallet.provider || !wallet.account || !snapshot) return;
    if (invalidParty(recipient) || invalidParty(arbiter)) {
      setFormError(
        "Enter valid recipient and arbiter addresses. Neither may be zero or the escrow contract.",
      );
      setInvalidField(invalidParty(recipient) ? "recipient" : "arbiter");
      document
        .getElementById(invalidParty(recipient) ? "recipient" : "arbiter")
        ?.focus();
      return;
    }
    if (!validAmounts) {
      setFormError(
        "Enter a positive MILE amount for every milestone, with at most 18 decimal places.",
      );
      const index = rows.findIndex((r) => {
        try {
          return (
            !/^\d+(\.\d+)?$/.test(r.amount) ||
            (r.amount.split(".")[1]?.length || 0) > snapshot.decimals ||
            parseUnits(r.amount, snapshot.decimals) <= 0n
          );
        } catch {
          return true;
        }
      });
      setInvalidField(`amount-${index}`);
      document.getElementById(`amount-${index}`)?.focus();
      return;
    }
    const deadlines = rows.map((r) =>
      BigInt(Math.floor(new Date(r.deadline).getTime() / 1000) || 0),
    );
    if (deadlines.some((d) => d <= snapshot.timestamp)) {
      setFormError(
        "Choose a future deadline for every milestone. Dates use your local time zone.",
      );
      const index = deadlines.findIndex((d) => d <= snapshot.timestamp);
      setInvalidField(`deadline-${index}`);
      document.getElementById(`deadline-${index}`)?.focus();
      return;
    }
    if (total > snapshot.balance) {
      setFormError(
        "Your MILE balance is below the deposit total. Get MILE or reduce the amounts.",
      );
      return;
    }
    await action.run(
      async (onHash) => {
        if (needsApproval)
          await sendContract(
            config,
            wallet.provider!,
            wallet.account!,
            token.address,
            config.abis.LaunchToken,
            "approve",
            [escrow.address, total],
            undefined,
            onHash,
          );
        else
          await sendContract(
            config,
            wallet.provider!,
            wallet.account!,
            escrow.address,
            config.abis.MilestoneEscrow,
            "openEscrow",
            [
              getAddress(recipient.trim()),
              getAddress(arbiter.trim()),
              rows.map((r) => parseUnits(r.amount, snapshot.decimals)),
              deadlines,
            ],
            undefined,
            onHash,
          );
        await refresh();
      },
      needsApproval
        ? "MILE approved. Review your terms, then open the escrow."
        : "Escrow opened. The full deposit is now held by the contract.",
    );
  }
  return (
    <div className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Set the terms</p>
          <h2>Start with a milestone.</h2>
          <p>The full deposit is held until it’s claimed or refunded.</p>
        </div>
      </div>
      <form onSubmit={submit} aria-describedby="open-help">
        <fieldset disabled={!ready || action.pending}>
          <div className="form-grid">
            <label htmlFor="recipient">
              Recipient
              <input
                id="recipient"
                name="recipient"
                placeholder="0x…"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                required
                autoComplete="off"
                spellCheck="false"
                aria-invalid={invalidField === "recipient"}
                aria-describedby={formError ? "open-error" : undefined}
              />
              <small>The wallet that receives payment.</small>
            </label>
            <label htmlFor="arbiter">
              Arbiter
              <input
                id="arbiter"
                name="arbiter"
                placeholder="0x…"
                value={arbiter}
                onChange={(e) => setArbiter(e.target.value.trim())}
                required
                autoComplete="off"
                spellCheck="false"
                aria-invalid={invalidField === "arbiter"}
                aria-describedby={formError ? "open-error" : undefined}
              />
              <small>The wallet that approves the work.</small>
            </label>
          </div>
          <div className="milestone-form-heading">
            <h3>
              Milestones <span>{rows.length}/5</span>
            </h3>
            <small>Deadlines use your local time zone.</small>
          </div>
          {rows.map((row, i) => (
            <div className="milestone-form" key={i}>
              <span className="step-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <label htmlFor={`amount-${i}`}>
                Amount (MILE)
                <input
                  id={`amount-${i}`}
                  aria-invalid={invalidField === `amount-${i}`}
                  aria-describedby={
                    invalidField === `amount-${i}` ? "open-error" : undefined
                  }
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, n) =>
                        n === i ? { ...r, amount: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder="100"
                  required
                />
              </label>
              <label htmlFor={`deadline-${i}`}>
                Deadline
                <input
                  id={`deadline-${i}`}
                  aria-invalid={invalidField === `deadline-${i}`}
                  aria-describedby={
                    invalidField === `deadline-${i}` ? "open-error" : undefined
                  }
                  type="datetime-local"
                  value={row.deadline}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, n) =>
                        n === i ? { ...r, deadline: e.target.value } : r,
                      ),
                    )
                  }
                  required
                />
              </label>
              <button
                type="button"
                className="remove"
                aria-label={`Remove milestone ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="add"
            disabled={rows.length >= 5}
            onClick={() => setRows([...rows, { amount: "", deadline: "" }])}
          >
            + Add milestone
          </button>
          <div className="deposit-total">
            <span>Total deposit</span>
            <strong>
              {validAmounts
                ? formatUnits(total, snapshot?.decimals ?? 18)
                : "0"}{" "}
              <small>MILE</small>
            </strong>
          </div>
          <p id="open-help" className="fine-print">
            Parties and terms cannot be edited after opening. Approve exactly
            this deposit, then confirm a separate transaction to open the
            escrow. ETH is needed for gas.
          </p>
          {formError && (
            <p className="error" id="open-error" role="alert">
              {formError}
            </p>
          )}
          <button
            className="primary wide"
            type="submit"
            disabled={!ready || action.pending}
          >
            {action.pending
              ? "Processing…"
              : needsApproval
                ? "Approve MILE"
                : "Open escrow"}
          </button>
        </fieldset>
        <p className="fine-print">
          {!ready
            ? "Connect a wallet on Sepolia and wait for verified live state to continue."
            : needsApproval
              ? "Step 1 of 2 · Allow the escrow to transfer the deposit."
              : "Step 2 of 2 · Deposit the full amount and create your escrow."}
        </p>
        <Feedback action={action} config={config} />
      </form>
    </div>
  );
}
function EscrowCard({ escrow, ...shared }: Shared & { escrow: Escrow }) {
  const { config, wallet, ready, refresh, snapshot } = shared;
  const cancel = useAction();
  const role = same(wallet.account, escrow.funder)
    ? "Funder"
    : same(wallet.account, escrow.recipient)
      ? "Recipient"
      : same(wallet.account, escrow.arbiter)
        ? "Arbiter"
        : undefined;
  return (
    <article className="escrow-card" data-testid={`escrow-${escrow.id}`}>
      <div className="escrow-header">
        <div>
          <span className="eyebrow">Escrow #{escrow.id.toString()}</span>
          <h3>
            {formatUnits(escrow.totalAmount, snapshot?.decimals ?? 18)}{" "}
            <small>MILE</small>
          </h3>
        </div>
        <div className="badges">
          {role && (
            <span className="badge role">You’re the {role.toLowerCase()}</span>
          )}
          <span className={`badge ${escrow.cancelled ? "neutral" : "active"}`}>
            {escrow.cancelled
              ? "Cancelled"
              : escrow.remainingAmount === 0n
                ? "Settled"
                : "Active"}
          </span>
        </div>
      </div>
      <div className="parties">
        {(["funder", "recipient", "arbiter"] as const).map((p) => (
          <div key={p}>
            <span>{p}</span>
            <AddressView
              config={config}
              value={escrow[p]}
              label={`Escrow ${escrow.id} ${p}`}
            />
          </div>
        ))}
      </div>
      <ol className="milestone-list">
        {escrow.milestones.map((m, i) => (
          <MilestoneRow key={i} {...shared} escrow={escrow} index={i} />
        ))}
      </ol>
      <div className="escrow-footer">
        <p>
          <strong>
            {formatUnits(escrow.remainingAmount, snapshot?.decimals ?? 18)} MILE
          </strong>{" "}
          remaining
        </p>
        <button
          disabled={
            !ready ||
            !same(wallet.account, escrow.arbiter) ||
            escrow.cancelled ||
            cancel.pending
          }
          onClick={() => {
            if (
              !window.confirm(
                `Cancel escrow #${escrow.id}? Every pending amount returns to the funder. Approved amounts remain claimable. This cannot be undone.`,
              )
            )
              return;
            void cancel.run(async (onHash) => {
              await sendContract(
                config,
                wallet.provider!,
                wallet.account!,
                contract(config, "MilestoneEscrow").address,
                config.abis.MilestoneEscrow,
                "cancelEscrow",
                [escrow.id],
                undefined,
                onHash,
              );
              await refresh();
            }, "Escrow cancelled. Approved amounts remain claimable.");
          }}
        >
          {cancel.pending ? "Cancelling…" : "Cancel escrow"}
        </button>
      </div>
      <p className="fine-print">
        Only the arbiter can cancel. Pending funds return to the funder.
      </p>
      <Feedback action={cancel} config={config} />
    </article>
  );
}
function MilestoneRow({
  escrow,
  index,
  config,
  snapshot,
  wallet,
  ready,
  refresh,
}: Shared & { escrow: Escrow; index: number }) {
  const milestone = escrow.milestones[index];
  const action = useAction();
  const overdue = !!snapshot && snapshot.timestamp > milestone.deadline;
  const approved = milestone.status === 1;
  const fn = approved
    ? "claimMilestone"
    : overdue
      ? "reclaimMilestone"
      : "approveMilestone";
  const label = approved
    ? "Claim milestone"
    : overdue
      ? "Reclaim milestone"
      : "Approve milestone";
  const actor = approved
    ? escrow.recipient
    : overdue
      ? escrow.funder
      : escrow.arbiter;
  const allowed =
    ready &&
    same(wallet.account, actor) &&
    (approved || (milestone.status === 0 && (!escrow.cancelled || overdue)));
  const date =
    milestone.deadline <= 8_640_000_000_000n
      ? new Date(Number(milestone.deadline) * 1000)
      : undefined;
  const status = [
    "Pending approval",
    "Approved · claimable",
    "Claimed",
    "Refunded",
  ][milestone.status];
  return (
    <li data-testid={`milestone-${escrow.id}-${index}`}>
      <div className="milestone-info">
        <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>
            {formatUnits(milestone.amount, snapshot?.decimals ?? 18)} MILE
          </strong>
          <time dateTime={date?.toISOString()}>
            {date
              ? date.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : `Far-future deadline · Unix seconds ${milestone.deadline}`}
          </time>
        </div>
      </div>
      <div className="milestone-action">
        <span className={`status status-${milestone.status}`}>
          {overdue && milestone.status === 0 ? "Overdue · reclaimable" : status}
        </span>
        {milestone.status < 2 && (
          <>
            <button
              disabled={!allowed || action.pending}
              onClick={() => {
                if (
                  fn === "approveMilestone" &&
                  !window.confirm(
                    `Approve milestone ${index + 1} in escrow #${escrow.id}? This irrevocably releases ${formatUnits(milestone.amount, snapshot?.decimals ?? 18)} MILE for the recipient to claim.`,
                  )
                )
                  return;
                void action.run(async (onHash) => {
                  await sendContract(
                    config,
                    wallet.provider!,
                    wallet.account!,
                    contract(config, "MilestoneEscrow").address,
                    config.abis.MilestoneEscrow,
                    fn,
                    [escrow.id, BigInt(index)],
                    undefined,
                    onHash,
                  );
                  await refresh();
                }, `${label} confirmed.`);
              }}
            >
              {action.pending ? "Processing…" : label}
            </button>
            <small>
              Only the {approved ? "recipient" : overdue ? "funder" : "arbiter"}
            </small>
          </>
        )}
      </div>
      <Feedback action={action} config={config} />
    </li>
  );
}
