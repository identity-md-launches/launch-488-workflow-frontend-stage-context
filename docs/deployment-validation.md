# Deployment binding

The frontend build reads the ABI JSON arrays directly from Git commit `5ec21faf39d6147238907ea54bd313d31f928200`, at `docs/abi/LaunchToken.json` and `docs/abi/MilestoneEscrow.json`. It recursively sorts JSON object keys (preserving array order), serializes compact JSON, and hashes the UTF-8 bytes with Keccak-256. Both values match the supplied deployment handoff:

| Contract | Canonical ABI Keccak-256 |
| --- | --- |
| LaunchToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| MilestoneEscrow | `ffcc27876e6434104a60bfe02e734b99212bc541dc27fe18dd504517f364b1b8` |

`web/scripts/export.mjs` runs after Vite, copies the raw pinned ABI files, inventories every exported file except `imd-deployment.json`, and writes the final SHA-256 inventory. `npm run verify` repeats the full handoff, network, pool, ABI, safe-path, schema, asset count, asset byte, and asset hash checks without rewriting the export. It rejects symlinks and traversal paths. The recorded handoff and network inputs allow rebuilding after the temporary `.imd/reads/` inputs are removed; while present, they are also compared against those original inputs.

`web/src/config.ts` loads the exported `imd-deployment.json` and its referenced ABI files at runtime, verifies their canonical Keccak hashes, and supplies deployment/network addresses to all reads, transactions, quotes and approvals. Pool parameters in `web/config/pool-input.json` are derived from the handoff and checked against it during export. The hookless pool's token address is resolved from the loaded manifest. The frontend does not contain a separate contract-address or RPC map.

Five automated tests in `web/tests/deployment.spec.ts` passed locally: both implementation ABI hashes; decoded native-to-token swap commands, pool, amounts, router and settlement currencies; the reverse token-to-native path; invalid amount/overflow/missing-network guards; and gateway-subpath configuration/ABI loading with rejection of tampered ABI contents. These inspect encoded transaction intent and runtime loading without broadcasting transactions. The standard `npm test` suite includes these tests.

## Read-only network attempt

On 2026-09-30, the worker attempted `eth_chainId` and `eth_getCode` for both deployed contracts against each of the three public RPC endpoints provided in the network input. All nine HTTP requests returned **403 Forbidden** from this worker environment:

- `https://ethereum-sepolia-rpc.publicnode.com`
- `https://rpc.sepolia.ethpandaops.io`
- `https://sepolia.rpc.sentio.xyz`

This is a connectivity limitation, not evidence about the chain's deployed code. Worker live-chain reads, quotes, approvals, and swaps remain unverified. No real transaction was broadcast. The app requires its runtime chain/code checks before enabling transactions; mocked browser checks cannot certify live-chain behavior. Publication's independent RPC and deployed-code checks are a later workflow gate, not part of this worker's completed checks.
