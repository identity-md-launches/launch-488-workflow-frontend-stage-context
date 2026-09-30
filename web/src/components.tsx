import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAddress, type Address, type Hash } from "viem";
import type { LoadedDeployment } from "./config";
import { errorMessage } from "./chain";

export function AddressView({
  value,
  config,
  label,
}: {
  value: Address;
  config: LoadedDeployment;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const address = getAddress(value);
  return (
    <span className="address-wrap">
      <a
        className="address"
        href={`${config.network!.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        title={address}
        aria-label={`${label || "Address"} ${address} on explorer`}
      >
        {address.slice(0, 6)}…{address.slice(-4)}{" "}
        <span aria-hidden="true">↗</span>
      </a>
      <button
        className="copy"
        aria-label={`Copy ${label || "address"}`}
        title={address}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setError("");
          } catch {
            setError(`Copy unavailable. Address: ${address}`);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {error && <small role="status">{error}</small>}
    </span>
  );
}
export type TransactionGuard = {
  begin: () => boolean;
  end: (message: string, error: boolean) => void;
  submitted: (hash: Hash) => void;
};
export const TransactionContext = createContext<TransactionGuard | undefined>(
  undefined,
);
export function useAction() {
  const guard = useContext(TransactionContext);
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hash, setHash] = useState<Hash>();
  async function run(
    work: (onHash: (hash: Hash) => void) => Promise<void>,
    complete: string,
  ) {
    if (locked.current || (guard && !guard.begin())) return;
    locked.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    setHash(undefined);
    setPhase("Preparing wallet request…");
    try {
      await work((value) => {
        setHash(value);
        guard?.submitted(value);
        setPhase("Waiting for confirmation…");
      });
      setSuccess(complete);
      guard?.end(complete, false);
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      guard?.end(message, true);
    } finally {
      locked.current = false;
      setPending(false);
      setPhase("");
    }
  }
  return { pending, phase, error, success, hash, run };
}
export type ActionState = ReturnType<typeof useAction>;
export function Feedback({
  action,
  config,
}: {
  action: ActionState;
  config: LoadedDeployment;
}) {
  return (
    <div className="feedback" aria-live="polite">
      {action.pending && (
        <p className="pending">
          <span className="spinner" aria-hidden="true" />
          {action.phase}
        </p>
      )}
      {action.error && (
        <p role="alert" className="error">
          {action.error}
        </p>
      )}
      {action.success && <p className="success">{action.success}</p>}
      {action.hash && (
        <a
          href={`${config.network!.explorer}/tx/${action.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction ↗
        </a>
      )}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Mark() {
  return (
    <svg aria-hidden="true" width="36" height="36" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="13" fill="currentColor" />
      <path d="M11 33V17h7v8l6-10 6 10v-8h7v16h-8l-5-8-5 8z" fill="#d9f391" />
    </svg>
  );
}
