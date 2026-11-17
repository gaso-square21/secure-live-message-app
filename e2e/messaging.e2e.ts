import { Browser, BrowserContext, expect, Page, Request, test } from '@playwright/test';

/**
 * A browser context with the clipboard replaced by a recorder. The Copy button is the only way to
 * get the share link, and the real clipboard is shared by every test running in parallel.
 */
async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  return context;
}

/** Clicks Copy link and returns what the button put on the clipboard. */
async function copyLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  return page.evaluate(() => (window as unknown as { copied: string }).copied);
}

/**
 * Each role gets its own browser context, so sender and receiver share nothing but the link,
 * as two people on two machines would.
 */
async function openSender(browser: Browser, onPage?: (page: Page) => void) {
  const page = await (await newContext(browser)).newPage();
  onPage?.(page);
  await page.goto('/send');
  const link = await copyLink(page);
  const message = page.getByLabel('Message');
  return { page, link, message, keyText: new URL(link).hash.slice(1) };
}

async function openReceiver(browser: Browser, link: string, onPage?: (page: Page) => void) {
  const page = await (await browser.newContext()).newPage();
  onPage?.(page);
  await page.goto(link);
  return page;
}

/** Everything a page sends over the network, flattened into searchable text. */
function recordTraffic(page: Page, seen: string[]): void {
  page.on('request', (request: Request) => {
    seen.push(request.url(), JSON.stringify(request.headers()), request.postData() ?? '');
  });
}

test('starts sending from the intro page', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.goto('/');
  await expect(page).toHaveTitle('Secure live message');
  await page.getByTestId('send-box').getByRole('link', { name: 'Send a message' }).click();

  await expect(page).toHaveURL(/\/send$/);
  await expect(page).toHaveTitle('Send live message');
  expect(await copyLink(page)).toMatch(/\/receive\/[\w-]{22}#[\w-]{43}$/);
});

test('delivers consecutive updates from sender to receiver', async ({ browser }) => {
  const sender = await openSender(browser);
  const receiver = await openReceiver(browser, sender.link);

  await expect(receiver).toHaveTitle('Receive live message');
  await expect(receiver.getByTestId('connection')).toHaveText('Live');

  await sender.message.fill('First update');
  await expect(receiver.getByTestId('message')).toHaveText('First update');

  await sender.message.fill('First update,\nthen a second');
  await expect(receiver.getByTestId('message')).toHaveText('First update,\nthen a second');
  await expect(sender.page.getByTestId('status')).toHaveText('All changes sent');

  await sender.message.fill('');
  await expect(receiver.getByTestId('message')).toHaveText('');
  await expect(receiver.getByRole('alert')).toHaveCount(0);
});

test('shows a late receiver the current text', async ({ browser }) => {
  const sender = await openSender(browser);
  await sender.message.fill('written before anyone opened the link');
  await expect(sender.page.getByTestId('status')).toHaveText('All changes sent');

  const receiver = await openReceiver(browser, sender.link);
  await expect(receiver.getByTestId('message')).toHaveText('written before anyone opened the link');
});

test('never sends the key or the plaintext over the network', async ({ browser }) => {
  const traffic: string[] = [];
  const sender = await openSender(browser, (page) => recordTraffic(page, traffic));
  const receiver = await openReceiver(browser, sender.link, (page) => recordTraffic(page, traffic));

  const secret = 'the launch code is 0000';
  await sender.message.fill(secret);
  await expect(receiver.getByTestId('message')).toHaveText(secret);

  const everything = traffic.join('\n');
  expect(everything).toContain('/api/sessions'); // the recording did capture the API calls
  expect(everything).not.toContain(sender.keyText);
  expect(everything).not.toContain('launch code');
});

test('renders received markup as text', async ({ browser }) => {
  const sender = await openSender(browser);
  const receiver = await openReceiver(browser, sender.link);
  let dialogs = 0;
  receiver.on('dialog', (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });

  await sender.message.fill('<img src=x onerror=alert(1)><b>bold</b>');
  await expect(receiver.getByTestId('message')).toHaveText(
    '<img src=x onerror=alert(1)><b>bold</b>',
  );
  await expect(receiver.locator('main img, main b')).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test('shows an alert and no text when the link has the wrong key', async ({ browser }) => {
  const sender = await openSender(browser);
  await sender.message.fill('secret');
  await expect(sender.page.getByTestId('status')).toHaveText('All changes sent');

  const wrongKey = (sender.keyText[0] === 'A' ? 'B' : 'A') + sender.keyText.slice(1);
  const receiver = await openReceiver(browser, sender.link.replace(sender.keyText, wrongKey));

  await expect(receiver.getByTestId('integrity-alert')).toBeVisible();
  await expect(receiver.getByTestId('message')).toHaveCount(0);
});

test('rejects a frame the relay tampered with and keeps the verified text', async ({ browser }) => {
  // Capture two genuine frames as the sender publishes them.
  const frames: string[] = [];
  const sender = await openSender(browser, (page) =>
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().endsWith('/frame')) {
        frames.push(request.postData() ?? '');
      }
    }),
  );
  await sender.message.fill('genuine');
  await expect.poll(() => frames.length).toBe(1);
  await sender.message.fill('altered in transit');
  await expect.poll(() => frames.length).toBe(2);

  // Play a hostile relay: serve the first frame intact and the second with one ciphertext
  // character changed. Playwright cannot rewrite a live event stream (route.fetch waits for the
  // whole body, and SSE never ends), so the stream is answered with a fixed body instead.
  const second = JSON.parse(frames[1]) as { ct: string };
  const tampered = { ...second, ct: (second.ct[0] === 'A' ? 'B' : 'A') + second.ct.slice(1) };
  const receiverContext = await browser.newContext();
  await receiverContext.route('**/api/sessions/*/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${frames[0]}\n\ndata: ${JSON.stringify(tampered)}\n\n`,
    }),
  );

  const receiver = await receiverContext.newPage();
  await receiver.goto(sender.link);

  await expect(receiver.getByTestId('integrity-alert')).toBeVisible();
  await expect(receiver.getByTestId('message')).toHaveText('genuine');
  await expect(receiver.getByTestId('message')).toHaveClass(/opacity-60/);
});

test('moves an older receiver aside when the link is opened again', async ({ browser }) => {
  const sender = await openSender(browser);
  const first = await openReceiver(browser, sender.link);
  await expect(first.getByTestId('connection')).toHaveText('Live');

  const second = await openReceiver(browser, sender.link);
  await expect(second.getByTestId('connection')).toHaveText('Live');
  await expect(first.getByTestId('connection')).toContainText('opened in another tab or device');
});

test('explains a damaged link without contacting the relay', async ({ page }) => {
  const traffic: string[] = [];
  recordTraffic(page, traffic);
  await page.goto('/receive/some-session#not-a-key');

  await expect(page.getByRole('alert')).toContainText('incomplete or damaged');
  expect(traffic.join('\n')).not.toContain('/api/');
});

test('sends the security headers', async ({ request }) => {
  const response = await request.get('/send');
  const headers = response.headers();

  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-content-type-options']).toBe('nosniff');
});
