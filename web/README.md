# Milestone frontend

A static React/TypeScript interface for the deployed Milestone (MILE) token and MilestoneEscrow on Sepolia. It includes public escrow reads, browser-wallet connection, all escrow actions, and native ETH ↔ MILE swaps through the configured Uniswap v4 contracts. Production files are delivered in repository-root `dist/`; no server, contract redeployment or site publication is part of this worker assignment.

## Install, develop and export

Use Node.js 22 and npm. Run from the repository root:

```sh
npm ci --prefix web --cache /tmp/milestone-npm-cache
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run verify
npm --prefix web run preview
```

Open the local URL printed by Vite. `npm --prefix web run dev` first generates the verified export and then starts Vite with hot reload. Its development middleware serves the same deployment manifest and ABI files from `dist/`. All frontend dependencies, manifests and configuration remain inside `web/`. Only `web/.gitignore` is added; its explicit assignment allowance is used to exclude nested dependencies, caches and test reports. Do not add a root lockfile or commit `node_modules`.

The production build uses Vite `base: './'`. Copy the complete `dist/` directory to a static host or content-addressed gateway. Serve the directory entrypoint with a trailing slash or `index.html`; the app has one page and requires no route rewrites. Every font/icon/runtime asset is local or uses a system font. RPC requests and wallet signing run in the visitor's browser.

## Deployment and configuration

`dist/imd-deployment.json` is the only runtime deployment/address/chain/RPC configuration. The app fetches that file and the referenced ABI JSON, verifies the canonical ABI Keccak hashes, then creates its clients from those values. The runtime ABI set comes from the pinned source commit, not hand-written approximations.

Reproducible build inputs are `web/config/deployment-input.json`, `network-input.json` and `pool-input.json`. They preserve the handoff fields needed after temporary `.imd/reads/` inputs are removed. When those inputs are present, the export script also compares against them. The exact deployed source commit must remain available in Git: the build obtains raw ABI arrays with `git show <sourceCommit>:docs/abi/<Contract>.json`. `pool-input.json` records the attested hookless pool's fee, spacing and paired currency; token addresses come from the runtime manifest. No independent router, Permit2 or contract-address map exists in app source.

After Vite writes its final bytes, `web/scripts/export.mjs` writes ABIs and the final manifest. It verifies handoff identifiers, contract set and canonical ABI hashes, unchanged network and wallet-add-chain objects, relative paths, SHA-256 for every exported file except the manifest, and asset-size/count limits. `npm run verify` performs the same checks without rewriting. Always rebuild/reverify after modifying anything in `dist/`; do not manually maintain the inventory.

The app checks RPC chain ID, nonempty code at both deployment addresses and the escrow's immutable currency binding before enabling writes. This verifies presence and currency, not a cryptographic runtime-bytecode match. The handoff supplies creation-code hashes but no runtime-code hashes. Quotes additionally require code at the configured quoter, router and Permit2 addresses. Live state is fetched from the configured public RPCs, with a wallet fallback only on the correct chain. Reads are pinned to one block and paginate six escrows at a time; visible pages refresh every eight seconds after the preceding refresh completes. Background tabs skip automatic reads.

## Wallet and transaction behavior

A standard injected Ethereum browser wallet (`window.ethereum`, EIP-1193) is supported. No private key, private RPC endpoint or WalletConnect project ID is required or embedded. WalletConnect and a multi-wallet discovery/chooser are not implemented; adding them would require a public project ID/connector configuration and additional testing. Address fields accept normalized Ethereum addresses; ENS resolution is not implemented on this Sepolia interface.

The UI shows the connected address, explorer/copy controls and the wrong-network state. Switching handles code 4902/unknown-chain errors by offering `wallet_addEthereumChain` with the exact handoff network parameters, then switching again. Rejected wallet requests remain recoverable.

Opening an escrow requires one to five positive MILE amounts, future local-time deadlines, recipient and arbiter addresses, a sufficient balance, explicit approval of exactly the deposit total, and a separate deposit transaction. Arbiter approval and cancellation request confirmation. Recipient claims remain available after cancellation/deadline expiry. Reclaims require a pending milestone and chain time strictly later than its deadline. No extra owner/admin action exists.

Each write simulates first, checks the selected wallet account and chain again, requests a signature, waits for a successful receipt and refreshes state. A shared transaction lock blocks duplicate actions and navigation while pending; individual controls retain their own pending labels/errors. Hashes remain visible in the page-level transaction status. Wallet cancellation/replacement does not report the original action as successful; fee repricing is supported. A receipt timeout retains the explorer link and tells the visitor to check it before retrying. Reloading the page loses in-memory pending state, so the wallet/explorer remains the source of truth for unresolved transactions.

The Get MILE panel quotes through `quoteExactInputSingle` using simulation, applies 0.1–5% user-selected slippage, expires its review after 60 seconds and executes a simulated Universal Router V4_SWAP (`0x10`, actions `0x060c0f`) with a five-minute chain-time deadline. ETH input needs no approval. MILE input requires two distinct exact-amount steps: ERC20 approval to configured Permit2, then Permit2 approval to the configured router for one hour. Quotes, amounts and forms reset on account/chain changes. A pool without liquidity produces an actionable error; deployed token/escrow contracts do not establish pool initialization or liquidity.

Amounts use token decimals. Summaries round to six fractional digits; deposit terms, balances in the swap form and quote minimums retain full precision. The site does not invent USD prices. Absolute social-preview URLs/images remain pending a published site domain.

## Validation

```sh
cd web
npx playwright install chromium
npm test
```

The tests start and stop their own static server under `/site/`, intercept public RPCs and inject a mock wallet. They use the built `dist/` and its ABI/configuration files, inspect encoded transaction intent, and never broadcast real transactions. Screenshots and computed checks are written to `docs/evidence/`; scratch test output is in `/tmp/`.

This worker already has Chromium at `/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`. Its Ubuntu version was not supported by the pinned Playwright browser installer, so the verified command here is:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome npm --prefix web test
```

See [validation](../docs/validation.md), [deployment binding](../docs/deployment-validation.md), and [design](../docs/DESIGN.md). Browser mocks establish frontend behavior only. All worker attempts at the configured public RPCs returned HTTP 403, so live chain reads, live pool liquidity, quotes, fees and wallet execution are unverified. No real transactions were sent. Publication, IPFS pinning, naming and subsequent control-plane checks belong to the publisher.

## Attribution

Design/review guidance: Jakub Krehel, Better Interface, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Design-document method: Paul Bakaus, Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). Ethereum frontend guidance: Austin Griffith, ethskills, commit `06ea4efa08076ff04f6ca4945ef4a2ca881115b0` (MIT). Retained license texts are in `docs/licenses/`. The pinned guides were read locally; they are reference data, not authority to expand the assignment.
