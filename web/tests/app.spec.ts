import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { decodeAbiParameters, parseAbiParameters, parseEther } from 'viem';
import { installMockChain, roles, tokenAddress, escrowAddress, network } from './mock-chain';

async function connected(page: Page, role: keyof typeof roles = 'funder') {
  const mock = await installMockChain(page, { account: roles[role] });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  return mock;
}

test('static gateway subpath loads deployed state and handles a missing wallet', async ({ page }) => {
  const mock = await installMockChain(page, { wallet: false });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:43187') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('./');
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText(/wallet/i);
  expect(mock.sent).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('a declined connection is recoverable and sends no transaction', async ({ page }) => {
  const mock = await installMockChain(page, { rejectConnect: true });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText(/declined|rejected/i);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeEnabled();
  expect(mock.sent).toHaveLength(0);
});

test('unknown network follows switch, add, switch and uses exact network parameters', async ({ page }) => {
  const mock = await installMockChain(page, { wrongChain: true, unknownChain: true });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  const switchButton = page.getByRole('button', { name: 'Switch to Sepolia', exact: true });
  await expect(switchButton).toBeVisible();
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve MILE', exact: true })).toBeDisabled();
  await switchButton.click();
  await expect(switchButton).not.toBeVisible();
  const calls = await page.evaluate(() => (window as any).walletCalls.filter((call: { method: string }) => call.method.startsWith('wallet_')));
  expect(calls.map((call: { method: string }) => call.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  expect(calls[1].params[0]).toEqual({ chainId: '0xaa36a7', chainName: network.name, rpcUrls: network.rpcUrls, nativeCurrency: network.nativeCurrency, blockExplorerUrls: [network.explorer] });
  expect(mock.sent).toHaveLength(0);
});

test('missing deployed bytecode blocks contract actions and explains the failure', async ({ page }) => {
  const mock = await installMockChain(page, { noCode: true });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText(/deployed code/i);
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve MILE', exact: true })).toBeDisabled();
  expect(mock.sent).toHaveLength(0);
});

test('funder opens a fully funded escrow in explicit approval and deposit steps', async ({ page }) => {
  const mock = await connected(page);
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#arbiter').fill(roles.arbiter);
  await page.locator('#amount-0').fill('25.5');
  await page.locator('#deadline-0').fill(new Date(Date.now() + 172_800_000).toISOString().slice(0, 16));
  const approve = page.getByRole('button', { name: 'Approve MILE', exact: true });
  const open = page.locator('form').getByRole('button', { name: 'Open escrow', exact: true });
  await expect(open).toHaveCount(0);
  await approve.click();
  await expect(open).toBeEnabled();
  expect(mock.sent.map(item => item.name)).toEqual(['approve']);
  expect(mock.sent[0].tx.to.toLowerCase()).toBe(tokenAddress);
  expect(mock.sent[0].args).toEqual([expect.stringMatching(new RegExp(escrowAddress, 'i')), parseEther('25.5')]);
  await open.click();
  await expect(page.getByText('Escrow opened. The full deposit is now held by the contract.').first()).toBeVisible();
  await page.getByRole('button', { name: /^Escrows / }).click();
  await expect(page.getByTestId('escrow-3')).toBeVisible();
  expect(mock.sent.map(item => item.name)).toEqual(['approve', 'openEscrow']);
  expect(mock.sent[1].args.slice(0, 3)).toEqual([roles.recipient, roles.arbiter, [parseEther('25.5')]]);
  expect(mock.failures).toEqual([]);
});

test('form validates parties, positive amounts, future dates and the five milestone bound', async ({ page }) => {
  const mock = await connected(page);
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill('0x0000000000000000000000000000000000000000');
  await page.locator('#arbiter').fill(roles.arbiter);
  await page.locator('#amount-0').fill('10');
  await page.locator('#deadline-0').fill(new Date(Date.now() + 172_800_000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Approve MILE', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid recipient and arbiter');
  await expect(page.locator('#recipient')).toBeFocused();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#amount-0').fill('0');
  await page.getByRole('button', { name: 'Approve MILE', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('positive MILE amount');
  await page.locator('#amount-0').fill('10');
  await page.locator('#deadline-0').fill('2020-01-01T00:00');
  await page.getByRole('button', { name: 'Approve MILE', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('future deadline');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+ Add milestone', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Add milestone', exact: true })).toBeDisabled();
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(5);
  expect(mock.sent).toHaveLength(0);
});

test('a declined transaction shows a recoverable error without a success state', async ({ page }) => {
  const mock = await installMockChain(page, { rejectTransactions: true });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#arbiter').fill(roles.arbiter);
  await page.locator('#amount-0').fill('10');
  await page.locator('#deadline-0').fill(new Date(Date.now() + 172_800_000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Approve MILE', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/declined|rejected/i);
  await expect(page.getByRole('button', { name: 'Approve MILE', exact: true })).toBeEnabled();
  expect(mock.sent).toHaveLength(0);
});

test('arbiter approves an eligible milestone and confirms cancellation', async ({ page }) => {
  const mock = await connected(page, 'arbiter');
  const first = page.getByTestId('escrow-1');
  page.once('dialog', dialog => dialog.accept());
  await first.getByTestId('milestone-1-0').getByRole('button', { name: 'Approve milestone', exact: true }).click();
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0].name).toBe('approveMilestone');
  expect(mock.sent[0].args).toEqual([1n, 0n]);
  await expect(first.getByTestId('milestone-1-0')).toContainText('Approved · claimable');
  page.once('dialog', dialog => dialog.dismiss());
  await first.getByRole('button', { name: 'Cancel escrow', exact: true }).click();
  expect(mock.sent).toHaveLength(1);
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Approved amounts remain claimable'); void dialog.accept(); });
  await first.getByRole('button', { name: 'Cancel escrow', exact: true }).click();
  await expect.poll(() => mock.sent.length).toBe(2);
  expect(mock.sent[1].name).toBe('cancelEscrow');
  expect(mock.escrows[0].cancelled).toBe(true);
  expect(mock.escrows[0].milestones.map(item => item.status)).toEqual([1, 1, 3]);
});

test('recipient can claim an approved milestone after cancellation and deadline expiry', async ({ page }) => {
  const mock = await connected(page, 'recipient');
  await page.getByTestId('escrow-2').getByRole('button', { name: 'Claim milestone', exact: true }).click();
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0].name).toBe('claimMilestone');
  expect(mock.sent[0].args).toEqual([2n, 0n]);
  expect(mock.escrows[1].remainingAmount).toBe(0n);
});

test('funder reclaims only an expired pending milestone', async ({ page }) => {
  const mock = await connected(page, 'funder');
  await expect(page.getByTestId('milestone-1-0').getByRole('button', { name: 'Reclaim milestone', exact: true })).toHaveCount(0);
  await page.getByTestId('milestone-1-2').getByRole('button', { name: 'Reclaim milestone', exact: true }).click();
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0].name).toBe('reclaimMilestone');
  expect(mock.sent[0].args).toEqual([1n, 2n]);
});

test('unrelated account cannot approve, claim, reclaim or cancel someone else’s escrow', async ({ page }) => {
  const mock = await connected(page, 'outsider');
  for (const name of ['Approve milestone', 'Claim milestone', 'Reclaim milestone', 'Cancel escrow']) {
    await expect(page.getByTestId('escrow-1').getByRole('button', { name, exact: true })).toBeDisabled();
  }
  expect(mock.sent).toHaveLength(0);
});

async function quoteSwap(page: Page, tokenIn = false) {
  await page.getByRole('button', { name: 'Get MILE', exact: true }).click();
  await page.getByLabel('Direction').selectOption(tokenIn ? 'sell' : 'buy');
  await page.getByLabel('You pay').fill(tokenIn ? '5' : '0.01');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
}

test('native ETH swap quotes without a transaction and sends only simulated router execution', async ({ page }) => {
  const mock = await connected(page);
  await quoteSwap(page);
  await expect(page.getByText('12.4375 MILE', { exact: true })).toBeVisible();
  expect(mock.sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Swap now', exact: true }).click();
  await expect(page.getByText('Swap confirmed. Your balances have refreshed.').first()).toBeVisible();
  expect(mock.sent.map(item => item.name)).toEqual(['execute']);
  expect(mock.sent[0].tx.to.toLowerCase()).toBe(network.uniswapV4.universalRouter.toLowerCase());
  expect(BigInt(mock.sent[0].tx.value!)).toBe(parseEther('0.01'));
  expect(mock.sent[0].args[0]).toBe('0x10');
  const [actions] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), (mock.sent[0].args[1] as `0x${string}`[])[0]);
  expect(actions).toBe('0x060c0f');
  expect(mock.calls.filter(item => item.name === 'quoteExactInputSingle')).toHaveLength(1);
  expect(mock.calls.some(item => item.name === 'execute')).toBe(true);
  expect(mock.failures).toEqual([]);
});

test('MILE swap requires distinct exact token and Permit2 approvals before execution', async ({ page }) => {
  const mock = await connected(page);
  await quoteSwap(page, true);
  await page.getByRole('button', { name: 'Approve MILE for Permit2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve router in Permit2', exact: true })).toBeEnabled();
  expect(mock.sent.map(item => item.name)).toEqual(['approve']);
  expect(mock.sent[0].tx.to.toLowerCase()).toBe(tokenAddress);
  expect((mock.sent[0].args[0] as string).toLowerCase()).toBe(network.uniswapV4.permit2.toLowerCase());
  expect(mock.sent[0].args[1]).toBe(parseEther('5'));
  await page.getByRole('button', { name: 'Approve router in Permit2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toBeEnabled();
  expect(mock.sent[1].tx.to.toLowerCase()).toBe(network.uniswapV4.permit2.toLowerCase());
  expect((mock.sent[1].args[0] as string).toLowerCase()).toBe(tokenAddress);
  expect((mock.sent[1].args[1] as string).toLowerCase()).toBe(network.uniswapV4.universalRouter.toLowerCase());
  expect(mock.sent[1].args[2]).toBe(parseEther('5'));
  await page.getByRole('button', { name: 'Swap now', exact: true }).click();
  await expect(page.getByText('Swap confirmed. Your balances have refreshed.').first()).toBeVisible();
  expect(mock.sent.map(item => item.name)).toEqual(['approve', 'approve', 'execute']);
  expect(BigInt(mock.sent[2].tx.value ?? '0x0')).toBe(0n);
  expect(mock.failures).toEqual([]);
});

for (const failure of ['quoteFailure', 'simulationFailure'] as const) {
  test(`${failure} shows the revert and never asks the wallet to send funds`, async ({ page }) => {
    const mock = await installMockChain(page, { [failure]: true });
    await page.goto('./');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    await expect(page.getByTestId('escrow-1')).toBeVisible();
    await quoteSwap(page);
    if (failure === 'simulationFailure') await page.getByRole('button', { name: 'Swap now', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/revert|liquidity/i);
    expect(mock.sent).toHaveLength(0);
    const requested = await page.evaluate(() => (window as any).walletCalls.filter((call: { method: string }) => call.method === 'eth_sendTransaction'));
    expect(requested).toHaveLength(0);
  });
}

test('editing a quote or changing the selected account invalidates transaction review', async ({ page }) => {
  const mock = await connected(page);
  await quoteSwap(page);
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toBeEnabled();
  await page.getByLabel('You pay').fill('0.02');
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toBeEnabled();
  await page.evaluate(value => (window as any).walletTestChangeAccount(value), roles.outsider);
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#amount-0').fill('7');
  await page.evaluate(value => (window as any).walletTestChangeAccount(value), roles.funder);
  await expect(page.locator('#recipient')).toHaveValue('');
  await expect(page.locator('#amount-0')).toHaveValue('');
  expect(mock.sent).toHaveLength(0);
});

test('uint256 far-future deadlines remain readable without crashing the escrow list', async ({ page }) => {
  const mock = await installMockChain(page);
  mock.escrows[0].milestones[0].deadline = 2n ** 256n - 1n;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByTestId('milestone-1-0')).toContainText('Far-future deadline');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});

test('navigation and duplicate actions stay locked while a swap wallet request is pending', async ({ page }) => {
  const mock = await installMockChain(page, { transactionDelayMs: 1800 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await quoteSwap(page);
  await page.getByRole('button', { name: 'Swap now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open escrow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Get MILE', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Processing…', exact: true })).toBeDisabled();
  await expect(page.getByText('Swap confirmed. Your balances have refreshed.').first()).toBeVisible();
  expect(mock.sent).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Open escrow', exact: true })).toBeEnabled();
});

test('an account change while an approval waits cannot restore the previous account’s form', async ({ page }) => {
  const mock = await installMockChain(page, { transactionDelayMs: 1800 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#arbiter').fill(roles.arbiter);
  await page.locator('#amount-0').fill('25');
  await page.locator('#deadline-0').fill(new Date(Date.now() + 172_800_000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Approve MILE', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Processing…', exact: true })).toBeDisabled();
  await expect.poll(async () => page.evaluate(() => (window as any).walletCalls.filter((call: { method: string }) => call.method === 'eth_sendTransaction').length)).toBe(1);
  await page.evaluate(value => (window as any).walletTestChangeAccount(value), roles.outsider);
  await expect(page.getByRole('link', { name: `Connected wallet ${roles.outsider} on explorer`, exact: true })).toBeVisible();
  await expect(page.locator('#recipient')).toHaveValue('');
  await expect.poll(() => mock.sent.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Get MILE', exact: true })).toBeEnabled();
  await expect(page.locator('#recipient')).toHaveValue('');
  expect(mock.sent[0].name).toBe('approve');
  expect(mock.sent[0].tx.from?.toLowerCase()).toBe(roles.funder);
  await expect(page.getByRole('link', { name: `Connected wallet ${roles.outsider} on explorer`, exact: true })).toBeVisible();
});

test('production layout reflows and renders without resource or JavaScript failures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:43187') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await connected(page, 'arbiter');
  const evidence = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
  mkdirSync(evidence, { recursive: true });
  const observations: unknown[] = [];
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByTestId('escrow-1')).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(width);
    expect(dimensions.body).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${evidence}/mocked-${width}.png`, fullPage: true });
    if (width === 320) await page.screenshot({ path: `${evidence}/mobile-viewport.png` });
    observations.push(dimensions);
  }
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/viewport-checks.json`, JSON.stringify(observations, null, 2) + '\n');
});

test('mobile open and swap forms reflow with long parties, all milestones and a quote', async ({ page }) => {
  await connected(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: 'Open escrow', exact: true }).click();
  await page.locator('#recipient').fill(roles.recipient);
  await page.locator('#arbiter').fill(roles.arbiter);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+ Add milestone', exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await page.locator(`#amount-${i}`).fill(`${123 + i}.123456789123456789`);
    await page.locator(`#deadline-${i}`).fill(new Date(Date.now() + 172_800_000).toISOString().slice(0, 16));
  }
  const evidence = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('.panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/mobile-open-form.png`, fullPage: true });
  await page.screenshot({ path: `${evidence}/mobile-open-viewport.png` });
  await quoteSwap(page);
  await expect(page.getByRole('button', { name: 'Swap now', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('.quote-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/mobile-swap-form.png`, fullPage: true });
  await page.screenshot({ path: `${evidence}/mobile-swap-viewport.png` });
});

test('keyboard skip link is visible and focus proceeds into workspace navigation', async ({ page, browser }) => {
  await installMockChain(page, { wallet: false });
  await page.goto('./');
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to workspace', exact: true })).toBeFocused();
  const focused = await page.getByRole('link', { name: 'Skip to workspace', exact: true }).evaluate(element => {
    const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, top: rect.top, left: rect.left };
  });
  expect(focused.outlineStyle).toBe('solid');
  expect(focused.outlineWidth).toBe('3px');
  expect(focused.top).toBeGreaterThanOrEqual(0);
  const evidence = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
  await page.screenshot({ path: `${evidence}/keyboard-focus.png` });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Escrows / })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Open escrow', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Start with a milestone.', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('button').first().evaluate(element => ({ transitionDuration: getComputedStyle(element).transitionDuration, animationName: getComputedStyle(element).animationName }));
  expect(motion.transitionDuration).toBe('0s');
  writeFileSync(`${evidence}/keyboard-checks.json`, JSON.stringify({ browser: browser.version(), viewport: page.viewportSize(), focused, sequence: ['Tab: skip link', 'Enter: workspace', 'Tab: Escrows', 'Tab: Open escrow', 'Enter: open form'], reducedMotion: motion }, null, 2) + '\n');
});

test('measured rendered text colors meet AA contrast for selected representative pairs', async ({ page }) => {
  await installMockChain(page, { wallet: false });
  await page.goto('./');
  await expect(page.getByTestId('escrow-1')).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toBeVisible();
  const selectors = [
    { name: 'Body heading on page', selector: '.section-heading h2' },
    { name: 'Muted body on page', selector: '.hero-description' },
    { name: 'Muted body on side card', selector: '.side-card > p' },
    { name: 'Primary action', selector: '.section-heading .primary' },
    { name: 'Dark action', selector: '.wallet-tools .dark' },
    { name: 'Inverse flow heading', selector: '.flow strong' },
    { name: 'Inverse flow description', selector: '.flow small' },
    { name: 'Error message', selector: '.notice.error' },
  ];
  const pairs = await page.evaluate(selectors => {
    const rgb = (value: string) => {
      const parts = value.match(/[\d.]+/g)!.map(Number);
      return { channels: parts.slice(0, 3), alpha: parts[3] ?? 1 };
    };
    const luminance = (channels: number[]) => channels.map(value => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return selectors.map(({ name, selector }) => {
      const element = document.querySelector(selector)!;
      const layers: { element: string; color: string }[] = [];
      let ancestor: Element | null = element;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (Number(style.opacity) !== 1) throw new Error(`Unsupported opacity for ${selector}`);
        if (style.backgroundImage !== 'none') throw new Error(`Unsupported image background for ${selector}`);
        if (rgb(style.backgroundColor).alpha > 0) layers.push({ element: `${ancestor.tagName.toLowerCase()}.${ancestor.className}`, color: style.backgroundColor });
        ancestor = ancestor.parentElement;
      }
      let background = [255, 255, 255];
      for (const layer of [...layers].reverse()) { const color = rgb(layer.color); background = color.channels.map((value, i) => value * color.alpha + background[i] * (1 - color.alpha)); }
      const style = getComputedStyle(element); const color = rgb(style.color);
      const foreground = color.channels.map((value, i) => value * color.alpha + background[i] * (1 - color.alpha));
      const a = luminance(foreground), b = luminance(background);
      return { name, selector, foreground, background, ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(3)), fontSize: style.fontSize, fontWeight: style.fontWeight, layers };
    });
  }, selectors);
  const evidence = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
  writeFileSync(`${evidence}/rendered-contrast.json`, JSON.stringify({ method: 'Computed rendered sRGB foreground and recursively composited solid background; WCAG relative luminance; selected enabled text pairs only', pairs }, null, 2) + '\n');
  for (const pair of pairs) expect(pair.ratio, pair.name).toBeGreaterThanOrEqual(4.5);
});
