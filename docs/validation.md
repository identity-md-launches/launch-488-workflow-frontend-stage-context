# Milestone worker validation

## Delivery and scope

Implemented the approved public MILE escrow workspace, all five escrow actions, explicit approval/deposit steps, browser-wallet/network handling and configured Uniswap v4 swaps. Source, package manifest/lockfile and frontend build/test configuration are under `web/`; the complete static export is under `dist/`; documentation, licenses and evidence are under `docs/`. Deployed Solidity, root build configuration, dependencies under `lib/` and existing implementation ABI exports are unchanged.

The implementation plan was to validate the pinned handoff/ABIs first, build state-aware escrow and swap controls, exercise the actual static export with mocked RPC/wallet responses, then repair observed defects and regenerate the final manifest. The visual direction was inferred from the product: a compact, intentionally light workspace with clear roles and one next action. There was no supplied live domain, WalletConnect ID or USD price source.

The assignment requests a root `DESIGN.md` but explicitly restricts writable paths to `web/**`, `dist/**` and `docs/**`, plus `web/.gitignore`. The stronger path restriction is honored: the full implemented design document is [docs/DESIGN.md](DESIGN.md). No root file was created. `web/.gitignore` uses only its explicit path allowance and excludes nested dependency/cache/test-result directories.

## Final checks

All checks below ran on this worker. They are self-reported evidence, not independent certification.

| Check | Command / evidence | Result |
| --- | --- | --- |
| TypeScript | `npm --prefix web run typecheck` | Exit 0 after final source/config changes. |
| Production export | `npm --prefix web run build` | Exit 0; Vite relative base, pinned ABIs, final manifest emitted after all export bytes. |
| Deployment inventory | `npm --prefix web run verify` | Exit 0; 2 attested ABIs, 7 SHA-256 assets plus manifest, 531,987 total export bytes. |
| Development smoke | Bounded local Vite process; source entrypoint plus manifest and both ABI JSON compared byte-for-byte to `dist/` | Pass; server stopped after verification. |
| Combined tests | `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome npm --prefix web test` | **38 passed, 0 failed, exit 0, 30.9 seconds**: 23 production browser cases, 10 chain-service cases, 5 deployment/encoding cases. |
| Browser | Chromium 145.0.7632.6 via Playwright 1.56.1 | Production `/site/` subpath; desktop 1440×1000, intermediate 768×1000, mobile 320×1000 and 320×900. |
| Package/scope | [package-audit.json](evidence/package-audit.json) | Full repository candidate byte count under 8 MiB; no dependency/cache files, new submodule, protected-file changes or out-of-scope deliverables. |
| Main-checkout commit | `git add -- web dist docs && git commit …` | Blocked before staging: `.git/index.lock` cannot be created because `.git` is read-only. No main-checkout commit was produced. Files remain present for collection. |

[Browser report](evidence/browser-validation.md), [run/asset binding](evidence/browser-run.json), [screenshots](evidence/) and [deployment verification](deployment-validation.md) contain detailed evidence. All screenshot balances, roles, escrows and quotes are synthetic fixtures. Tests assert encoded function arguments and router settlement data, not only button clicks.

The export manifest's SHA-256 is `d22dae9d83238b53d974827e4179ce79b2b736937917aa09f1205384386a75f6`. Its declared asset inventory matches the browser evidence. Every ABI and `index.html` is included; the manifest excludes itself. The runtime app fetches exactly this manifest and its referenced ABIs, and reads all deployment/network addresses from it. No private credentials or server are used.

## Better Interface: consolidated six-domain review

The pinned workflow, all six domains' core principles and document-web-design method were read and applied during implementation. This table distinguishes checks performed from limits; reading a guide alone was not counted as a check.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/links/forms, labeled fields, errors linked with `aria-describedby`, invalid-field focus, text states, skip link, visible 3px focus, native confirmations and reduced-motion behavior. Representative keyboard sequence and screenshot verified. Screen-reader sessions, every focus route, native-device touch and a full accessibility scanner were not performed. |
| Layout | Checked | Desktop/sidebar, intermediate layout and 320px reflow; five-milestone form, full addresses and quote content. Document/body width equals viewport at all three measured widths. Viewed final screenshots and corrected mobile date clipping. Native 200% zoom and RTL/localized variants were not tested. |
| Writing | Checked | Labels match contract actions; irreversible approval/cancellation consequences are explicit; wrong chain, missing wallet, rejection, missing code, quote failure and simulation failure state the next step. MILE/ETH units and unavailable USD context are explicit. English only. |
| Typography | Checked | Descending heading hierarchy, system font fallback, 16px inputs, balance/amount wrapping, tabular changing numbers and readable dates. Narrow number wrapping repaired. Actual installed font availability/weights outside this Chromium environment are not established. |
| Colors | Checked | Eight representative rendered foreground/background pairs measured with WCAG relative luminance, all ≥4.5:1 after repair. Minimum tested ratio is 4.777:1. [Full measured pairs](evidence/rendered-contrast.json). Disabled-state contrast, every hover/focus boundary and forced-color OS behavior were not exhaustively measured. |
| UI details | Checked | Boot/read loading, missing-wallet/wrong-chain states, transaction pending/confirmation/rejection, expired quote, role-disabled actions and empty-state source paths reviewed. Real production controls tested; native confirmation acceptance/dismissal tested. Reduced-motion representative check passed. No custom modal, theme switch or image system exists; animation-panel slow playback was not performed. |

## Findings repaired and rechecked

| Severity | Final source | Finding → repair → recheck |
| --- | --- | --- |
| High | `web/src/App.tsx:1071` | A valid on-chain uint256 deadline could exceed JavaScript Date limits and blank the entire dashboard. Guard date conversion and render far-future Unix seconds instead. Maximum-uint256 browser case passes without overflow. |
| Medium | `web/src/App.tsx:90`, `web/src/components.tsx:65` | Per-component pending state could be lost when navigating away during signing. Added a shared ref lock, disabled navigation/other writes and durable page-level hash/status. Delayed swap/approval browser tests pass. |
| Medium | `web/src/App.tsx:128` | An old account's asynchronous reads or wallet responses could overwrite the current wallet state. Bind refresh results to account/chain/page identity and sequence wallet-event responses. In-flight account-change browser case and service signature checks pass. |
| Medium | `web/src/App.tsx:557` | Open-escrow fields retained another account's terms after account changes. Remount open/swap panels by wallet identity. Form/quote account-change cases pass. |
| Medium | `web/src/chain.ts:176` | A successful same-nonce cancellation/replacement receipt could incorrectly report the original action completed. Track replacement reason and explorer hash; only repricing preserves success. All three replacement scenarios pass. |
| Medium | `web/src/style.css:14` | Muted text on `#eaf0e2` measured 4.437:1. Changed shared muted token from `#657068` to `#606b63`; measured final ratio **4.777:1**. |
| Medium | `web/src/style.css:1480` | At 320px the native deadline field clipped the first date characters despite no page overflow. Span the full milestone row. Final viewed [mobile-open-viewport.png](evidence/mobile-open-viewport.png) shows the complete date/time. |
| Low | `web/src/style.css:1466`, `web/src/App.tsx:570` | Narrow supply digits and tab labels wrapped awkwardly; hiding a line break joined “terms.Shared”. Adjust narrow metric size, keep tabs on one line and preserve the space. Final mobile screenshot inspected. |
| Medium | `web/src/App.tsx:692` | Validation needed a consistent field association for rejected parties/amounts/deadlines. Mark the failing field invalid, associate the error and focus the first failing row. Form-boundary browser tests pass. |

Remaining limits below are disclosed, not claimed as fixed or passed. No unresolved reproduced issue blocks the tested frontend flows.

## Live-chain and publication limits

Nine read-only requests—chain ID and code for both contracts against each supplied RPC—returned HTTP 403 on this worker. This does not establish whether deployment code or liquidity exists on Sepolia. Actual chain reads, live quote accuracy, gas costs, approvals, escrow transfers, swaps and real wallet extension behavior remain unverified. No real transaction or signature was requested.

The runtime disables actions until chain ID, deployment code presence, immutable escrow currency and ABI verification succeed. It simulates before signing and rechecks the selected wallet account/chain. These checks are tested with mocks; they do not certify contract correctness, exact runtime-bytecode equivalence or the later publication environment. Receipt timeouts retain the explorer link; reloading loses in-memory pending state. ENS lookup and multi-wallet/WalletConnect discovery are not implemented. Absolute social-preview metadata awaits a published domain.

Implementation, static export and worker-side checks are complete for the described frontend scope. The main-checkout Git commit is unavailable because Git metadata is read-only. The root design-document location conflicts with the write budget, so its complete content is supplied under `docs/`. IPFS publishing, naming, fixed-CID/named asset checks and configured-RPC code checks belong to the publisher; this worker did not perform or claim those checks.
