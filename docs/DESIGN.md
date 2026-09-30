# Milestone interface design

## Overview

Milestone is a public escrow workspace for funders, recipients and arbiters using MILE on Sepolia. The implemented page puts contract totals above the work area, keeps named parties and milestone states visible, and describes the next eligible action beside each milestone. A pale background, dark green text, white work surfaces and lime primary actions establish the hierarchy without illustrations or decorative imagery.

This document lives at `docs/DESIGN.md` because the assignment's explicit write budget permits `docs/**`, `web/**` and `dist/**` but prohibits creating a repository-root `DESIGN.md`. It documents the final implementation rather than a proposed design. The reusable rules are the tokens, typography, surfaces, fields and transaction feedback; the introductory hero and its three-step diagram are this page's composition, not a mandatory template for every future page.

The source of truth is [style.css](../web/src/style.css), then [components.tsx](../web/src/components.tsx), [App.tsx](../web/src/App.tsx) and [Swap.tsx](../web/src/Swap.tsx). The interface intentionally uses a light theme. It has no theme switch, downloaded font, image dependency or external icon library. Imported guide licenses are retained in [licenses/](licenses/).

## Colors

Colors are CSS custom properties in `style.css :root`; new UI should use the semantic aliases rather than duplicate their literal values.

| Primitive | Exact value | Semantic alias and use |
| --- | --- | --- |
| `--neutral-0` | `#fff` | `--color-surface`: cards, fields, default buttons; inverse text |
| `--neutral-50` | `#f6f7f2` | `--color-page`: page and inset quote/payment surfaces |
| `--neutral-100` | `#edf0e8` | `--color-subtle`: notices, selected counts, success feedback, disabled fields |
| `--neutral-200` | `#d7ddd3` | `--color-border`: one-pixel boundaries and dividers |
| `--neutral-500` | `#606b63` | `--color-muted`: supporting copy, labels, timestamps and secondary states |
| `--neutral-900` | `#243b30` | `--color-text`: primary text; dark wallet button and flow-card background |
| `--lime-200` | `#d9f391` | `--color-action`: primary buttons, brand mark detail and diagram accents |
| `--lime-300` | `#c7e77c` | `--color-action-hover`: enabled primary-button hover |
| `--red-700` | `#a52f2f` | `--color-error`: errors and invalid-field borders |
| `--red-50` | `#fff0ed` | `--color-error-bg`: error surfaces |
| `--color-focus` | `#285d9c` | Three-pixel keyboard focus outline |

Existing local colors are purposeful exceptions: `#eaf0e2` for role guidance, the connection prompt and active badges; `#365243` for dark-button hover; and `#d6dfd7`, `#a7b6a9`, `#738676`, `#526959` for inverse diagram text and rules. These do not form an additional color ramp. The inline SVG mark uses the same `#d9f391` lime.

Pending, approved, claimed, refunded and cancelled states are named in text; color is not their only distinction. Approved milestone text is darker and heavier. Disabled buttons use opacity `0.48` and a `not-allowed` cursor. Contrast measurements and their tested pairs belong to [rendered-contrast.json](evidence/rendered-contrast.json); they are selective measurements, not a claim of exhaustive accessibility conformance.

## Typography

The root font stack is `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Inter is a local preference, not a bundled or fetched font. The operating system chooses an available fallback. Addresses use `ui-monospace, SFMono-Regular, Consolas, monospace`; deployment hashes use `ui-monospace, monospace`. No font files or font service are needed to reproduce the layout. CSS requests weights 400, 500, 600 and 650 and sets `font-synthesis: none`; availability of individual weights depends on the installed font.

| Role | Implemented sizing |
| --- | --- |
| Root text | `16px`, line-height `1.5`, weight 400 |
| `h1` | `clamp(2.4rem, 4.2vw, 3.65rem)`, line-height `1.1`, weight 600, tracking `-0.055em` |
| `h2` | `1.45rem`, line-height `1.25`, weight 600, tracking `-0.035em` |
| `h3` | `1.05rem`, line-height `1.4`, weight 600 |
| `--text-sm` | `0.8125rem` / 13px: buttons, labels, notices and help copy |
| `--text-body` | `0.9375rem`: declared token; it does not override the root's 16px size |
| Hero description | `1rem`, line-height `1.65`; `0.9rem` at mobile widths |
| `.eyebrow` | `0.67rem`, uppercase, tracking `0.14em`, weight 650; local smaller variants in cards |
| Fields | `1rem`; large swap amount is `2rem`, reduced to `1.6rem` on mobile |
| Metrics | `1.4rem` with responsive reductions, tracking `-0.04em`, tabular numerals |
| Address / fine print | Address `0.72rem`; general fine print `0.73rem`, line-height `1.65` |

Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`. Large amounts, hashes, feedback and deadlines wrap where needed. Shortened addresses stay on one line while their containing row can wrap. Metrics, step indices and quote values use `font-variant-numeric: tabular-nums`.

Overview supply, locked funds and wallet balance use `Intl.NumberFormat("en-US")` with at most six fractional digits. Escrow amounts, deposit totals, swap balances and minimum output use `formatUnits` with the token's decimals; they retain the base-unit-derived value. The estimated exchange rate uses at most six significant digits and is marked approximately. Dates are entered through native `datetime-local` controls and displayed with the visitor's local date/time formatting. The interface explicitly says deadlines use local time. Out-of-range display dates fall back to Unix seconds. No invented USD conversion is shown.

## Layout

`.shell` centers content with `max-width: 1240px` and desktop inline padding of `40px`. The header shares that edge. The hero uses a `1.1fr 1fr` grid with an `80px` gap. The four-column `.metrics` strip precedes `.workspace`, whose desktop columns are `minmax(0, 1fr) 282px` with a `35px` gap. Escrow cards form a vertical list with `22px` gaps. The secondary column contains role guidance and deployment information.

Spacing is expressed directly in CSS, not through a separate spacing-token scale. Common control gaps are 7–12px, content gaps 14–24px, and panel padding 20–28px. Reuse `.shell`, `.workspace`, `.panel`, `.section-heading`, `.form-grid`, `.escrows` and `.fine-print` to keep alignment consistent. Use `min-width: 0` for grid/flex children that can contain token amounts or addresses.

The cascade has these exact `max-width` breakpoints:

| Breakpoint | Result |
| --- | --- |
| `1050px` | Shell padding becomes 28px; sidebar 248px; workspace gap 25px; panel padding 22px. Party fields stack and milestone dates move to a second row because the main column is narrower. |
| `800px` | Workspace becomes one column. The former sidebar becomes a two-column region below it. Hero remains two columns; `h1` is 2.65rem. The wider work area restores two-column party fields and the inline milestone form layout. |
| `590px` | Shell padding becomes 20px. Hero, guidance, party fields and parties stack; metrics become a two-by-two grid. Heading is 3rem with line-height 1.08. Header wallet controls wrap. Milestone actions move below their details; cancellation becomes full width. Quote rows stack. Deadline fields occupy the full mobile milestone row (`grid-column: 1 / -1`) to keep the native date value visible. |
| `360px` | Metric values become 0.96rem with tighter tracking; metric units move below the number; metric horizontal padding becomes 14px. |

The final trailing `.tabs` rules keep button labels on one line and set `column-gap: clamp(14px, 3vw, 24px)`; these take precedence over earlier fixed tab gaps. Long messages and amounts use `overflow-wrap: anywhere`. Pagination and wallet controls wrap rather than impose a fixed page width.

Screenshots cover [1440px](evidence/mocked-1440.png), [768px](evidence/mocked-768.png) and [320px](evidence/mocked-320.png) with mocked chain state. The layouts show the intended desktop sidebar, intermediate lower guidance area and mobile stacking. [Viewport measurements](evidence/viewport-checks.json) record page widths at those sizes. [Mobile escrow](evidence/mobile-open-form.png), [mobile swap](evidence/mobile-swap-form.png) and [keyboard](evidence/keyboard-checks.json) evidence cover additional states. These examples do not establish behavior in every browser, font installation, viewport or real wallet.

## Elevation & Depth

The surface system is flat: no shadows, gradients, sticky overlays or custom modal layer. White cards use one-pixel borders; guidance surfaces use a pale tonal fill. The dark flow card is a visual anchor, not an elevated control. Subtle rules divide metrics, milestone rows and footers.

The keyboard skip link is the only fixed overlay (`z-index: 100`), normally placed above the viewport and moved to 12px from its top when focused. Diagram number circles use `z-index: 1` to cover their connecting rule. Approval and cancellation confirmation use native `window.confirm`; their appearance belongs to the browser.

## Shapes

`--radius: 16px` is used by the flow card. Work panels, escrow cards, metric strips and guidance cards use 12px corners; notices, quote cards and payment insets use 10px. Buttons, fields, inline feedback and the small guidance icon use 8px. Badges use 5px, the testnet marker 4px, and diagram steps/spinners are circular. The logo is an inline SVG with a rounded-square background and an M-shaped path.

Most structural borders are solid and one pixel. The empty escrow state has a dashed border. Active workspace navigation is indicated by a two-pixel underline with no enclosing button border. Focus is separate from these treatments: `3px solid var(--color-focus)` with a 3px offset. Forced-color mode uses `Highlight` for focus and `CanvasText` outlines around dark/accent surfaces.

## Components

| Component or source pattern | API, use and states |
| --- | --- |
| `AddressView` in `components.tsx` | Props: `value`, `config`, optional `label`. Checksummed, shortened explorer link with full address in its title/accessibility name; separate Copy button. Reports clipboard failure with the full address. |
| `Mark` in `components.tsx` | Decorative inline SVG; inherits its dark fill through `currentColor`. Has no props and is hidden from assistive technology. Brand links provide the accessible name. |
| `Notice` in `components.tsx` | Props: `children`, optional `error`. Normal notices use `role="status"`; errors use `role="alert"` and the error color pair. |
| `useAction`, `TransactionContext`, `Feedback` in `components.tsx` | Shared transaction state and presentation. `run(work, complete)` sets preparing, submitted/waiting, success or error states. `Feedback` takes `action` and `config`, announces updates politely and links the transaction hash to the configured explorer. |
| Buttons in `style.css` | Base outlined action; `.primary` lime for the current main action, `.dark` for wallet connection, `.wide` for full-width form submission. Hover applies only when enabled. Native `disabled` and changing action labels communicate waiting and unmet prerequisites. |
| Workspace navigation in `App.tsx` | Three ordinary buttons in a named `nav`; `aria-pressed` identifies the selected panel. Reuse native Tab/Enter/Space behavior, not an unimplemented ARIA tablist model. |
| `OpenEscrow` pattern in `App.tsx` | Internal component using shared config, snapshot, wallet, readiness and refresh props. Labeled recipient/arbiter fields, one to five milestone rows, live deposit total, explicit approval then deposit steps. Required fields, invalid-field focus, `aria-invalid` and associated errors support correction. |
| `EscrowCard` / `MilestoneRow` patterns in `App.tsx` | Internal components for parties, role badge, escrow state, amounts, local deadlines and the eligible approve/claim/reclaim action. Cancellation has a consequence confirmation. Approved funds remain visibly claimable after cancellation. Unauthorized actions are disabled with the required role stated. |
| `Swap` in `Swap.tsx` | Props: `config`, optional `snapshot`, `wallet`, `ready`, `refresh`. Direction, amount, balance and slippage controls precede a requested quote. Quote display includes estimate, minimum, approximate rate, expiry and explicit approval steps. Expired or changed quotes cannot be submitted. |
| Loading / empty / failure patterns in `App.tsx` | Boot configuration verification, ledger loading, genuine no-escrow state, missing wallet, wrong network, unavailable live reads and retry are distinct. Missing values use an em dash instead of a fabricated zero. |

`Dashboard` provides a global transaction guard: while an action is pending, other transaction actions and workspace navigation are disabled. The persistent page-level transaction notice retains submission status and its explorer link. A connected account, correct chain and verified live snapshot are prerequisites for actions; role, status and deadline checks further restrict milestone controls. Source actions simulate before wallet signing and recheck wallet identity, as implemented in [chain.ts](../web/src/chain.ts).

Interactive elements have native keyboard semantics and a shared visible focus treatment. A skip link reaches the work area. Decorative arrows and the logo SVG are marked decorative; buttons have text or an accessible label. Controls generally start at 42px high and fields at 46px, with deliberate smaller inline Copy and milestone-action buttons. These sizes are descriptive, not a claim that every target is 44px. Animation is limited to a spinner and 120ms button transitions/press scaling, enabled only under `prefers-reduced-motion: no-preference`.

## Do's and Don'ts

- Start another workspace section with `.panel` and `.section-heading` inside the existing `.workspace-main`; reuse `.form-grid`, labeled fields and `.fine-print` for context.
- Use `.primary` for the next main action and the base button for secondary actions. Preserve native disabled states and explain role or network prerequisites nearby.
- Route transaction UI through `useAction`, `Feedback` and the existing `TransactionContext`. Do not create a parallel pending state that permits simultaneous submissions.
- Preserve explicit MILE/ETH units, local-time deadline wording, minimum swap output and separate approval steps. Keep summary rounding separate from exact action amounts.
- Add status text as well as styling. Keep error colors for errors and lime for actions; do not invent a success palette or dark theme without implementing and checking it.
- Keep runtime contract links and network names derived from deployment configuration. Reuse `AddressView` instead of displaying unlabelled truncated addresses.
- Keep the export self-contained: use CSS or the inline mark for the present visual language rather than adding font/CDN dependencies. Check any new panel at the documented desktop, intermediate and narrow mobile widths, including keyboard focus and long values.
