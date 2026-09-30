# Production browser and interaction validation

The final corrected export passed **38 tests: 23 browser tests, 10 service integration tests and 5 deployment/encoding tests**, with exit code 0 in 30.9 seconds. The final aggregate run was executed by the root worker; the earlier 28-test production/browser run also passed. Chromium 145.0.7632.6 ran headlessly through Playwright 1.56.1. [browser-run.json](browser-run.json) records the tested deployment manifest SHA-256 and exact asset inventory. These are worker observations, not independent certification.

Run from `web/`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome npm test
```

The executable override uses this worker's existing Chromium. Playwright 1.56.1's browser installer did not recognize Ubuntu 26.04; its cached browser launched successfully. Other supported machines can install Chromium with `npx playwright install chromium` and run `npm test` without the override. No browser binary or dependency directory is part of the delivery.

The test configuration starts and stops its own bounded static server. It serves the production `dist/` at `/site/`, with no route rewrites. The browser fetches the real exported manifest, JavaScript, CSS and implementation ABIs. All configured public RPC requests and wallet operations are intercepted by the fixture; screenshot balances, escrows and quotes are synthetic. No real signature, approval, deposit or swap was requested.

## Verified interactions

- Deployment files and relative paths load below a gateway subpath without JavaScript exceptions or failed local resources. Missing deployed code disables transactions and explains the read failure.
- Missing wallet and rejected connection are recoverable. Wrong-chain controls stay disabled. An unknown chain follows switch → add → switch and supplies the exact exported network parameters.
- Escrow opening validates parties, amounts, future deadlines and the five-milestone limit. Approval and full deposit are separate transactions, with decoded arguments checked against the user's inputs.
- Named arbiter approval and cancellation, named recipient claims after deadline/cancellation, and funder reclaim after an unapproved deadline all reach the correct contract function. Dismissed cancellation sends nothing; unrelated accounts cannot act.
- Native ETH swaps quote without sending a transaction and execute with the correct router/value. MILE swaps require exact token approval to Permit2, then exact Permit2 approval to the router, then execution. Decoded router commands, actions, settlement currencies, minimum output and pool configuration are also checked by the deployment tests.
- Quoter and router simulation reverts explain the error and never request `eth_sendTransaction`. Wallet transaction rejection recovers without a success state.
- Editing a quote or changing accounts invalidates review. Form values reset on account change. Pending transactions disable navigation and duplicate actions. Account changes during pending approval do not restore the previous account's form. A maximum-uint256 deadline remains readable without crashing or horizontal overflow.

The ten service integration tests additionally check same-block reads and six-item pagination; absent code and wrong immutable currency; wrong chain or changed account before signing; target allowlisting; rejected signatures; and receipt replacement. Cancelled/replaced transactions update the explorer hash without falsely confirming the original action; repriced transactions can confirm. These tests call the real service with a mocked EIP-1193 transport and require no live endpoint.

## Rendered checks and repairs

The production escrow view was rendered at 1440, 768 and 320 CSS pixels; open/swap forms were exercised at 320 pixels with five milestones, full addresses, 18-decimal amounts and a quote. Document/body width stayed within each viewport. [viewport-checks.json](viewport-checks.json) records dimensions. Saved screenshots include full pages and mobile viewport crops; the latter were viewed to check actual date and quote readability.

The keyboard sequence Tab → skip link → Enter → Tab → Escrows → Tab → Open escrow → Enter opened the form. The screenshot shows the visible blue focus ring; [keyboard-checks.json](keyboard-checks.json) records its computed 3px outline and bounds. The representative button's transition became `0s` under reduced motion.

| Finding | Location | Repair and final recheck |
| --- | --- | --- |
| Form retained another account's recipient/amount | `web/src/App.tsx:557` | Key open/swap panels by wallet identity; account-change tests pass, including an approval already waiting in the wallet. |
| Muted side-card text measured 4.437:1 contrast | `web/src/style.css:14` | Muted token changed from `#657068` to `#606b63`. Actual solid background remained `#eaf0e2`; final measured ratio is **4.777:1**. |
| 320px deadline input clipped the start of the date | `web/src/style.css:1480` | Deadline field spans the mobile grid. Viewed final [mobile-open-viewport.png](mobile-open-viewport.png): full date and time are visible. |

Eight representative enabled text pairs were measured from computed rendered foregrounds and recursively composited solid backgrounds: heading, muted body, muted side-card, primary action, dark action, inverse flow heading/description and error. All passed 4.5:1; [rendered-contrast.json](rendered-contrast.json) contains colors, backgrounds, selectors, font sizes and ratios. This is selected-pair coverage, not a claim of complete accessibility conformance.

## Limits

Real wallet extensions, live account funding, deployed-chain receipts, real liquidity/quotes, physical devices, assistive-technology sessions and browser-native 200% zoom were not exercised. A narrow viewport is reflow testing, not native zoom. Keyboard coverage is the recorded representative sequence, not every possible focus route. No broad automated accessibility scanner, RTL variant, alternate theme or translated content was tested. Public RPC/deployed-code observations are documented separately in the deployment validation report; these mocked browser checks do not establish live-chain availability.
