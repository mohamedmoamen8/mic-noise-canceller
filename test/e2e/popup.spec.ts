// test/e2e/popup.spec.ts
// Playwright E2E smoke test for the Mic Noise Canceller extension.
//
// PREREQUISITES:
//   1. Run `npm run build` before running this test — it loads from dist/.
//   2. Run `npx playwright install chromium` once to install the browser.
//
// What this tests:
//   - The extension loads without errors
//   - The popup HTML renders (toggle switch, strength slider, calibrate button)
//   - The toggle starts in the OFF state (background returns running:false on a
//     fresh profile)
//
// What this deliberately does NOT test:
//   - Real mic access (requires OS permission grant, not suitable for CI)
//   - Offscreen document audio pipeline (no getUserMedia in headless Chrome)
//
// Run with:  npm run test:e2e

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

// ---------------------------------------------------------------------------
// Fixtures — shared browser context with the extension loaded
// ---------------------------------------------------------------------------

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false, // Extensions require a non-headless context in Playwright
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

// ---------------------------------------------------------------------------
// Helper: get extension ID from the service worker URL
// ---------------------------------------------------------------------------

async function getExtensionId(): Promise<string> {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent('serviceworker');
  }
  // SW URL format: chrome-extension://<id>/background.js
  const url = new URL(sw.url());
  return url.hostname;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('extension loads and service worker is registered', async () => {
  const id = await getExtensionId();
  expect(id).toBeTruthy();
  expect(id.length).toBeGreaterThan(0);
});

test('popup renders core UI elements', async () => {
  const id = await getExtensionId();
  const page = await context.newPage();

  await page.goto(`chrome-extension://${id}/popup.html`);

  // Toggle switch
  await expect(page.locator('#toggleSwitch')).toBeVisible();

  // Strength slider
  await expect(page.locator('#strengthSlider')).toBeVisible();

  // Calibrate button
  await expect(page.locator('#calibrateBtn')).toBeVisible();

  await page.close();
});

test('toggle starts in OFF state (running: false on fresh profile)', async () => {
  const id = await getExtensionId();
  const page = await context.newPage();

  await page.goto(`chrome-extension://${id}/popup.html`);
  // Wait for the init() async function to finish setting UI state
  await page.waitForFunction(() => {
    const toggle = document.getElementById('toggleSwitch') as HTMLInputElement | null;
    // init() sets disabled=false once it has fetched state from background
    return toggle !== null && !toggle.disabled;
  });

  const checked = await page.locator('#toggleSwitch').isChecked();
  expect(checked).toBe(false);

  await page.close();
});

test('popup shows label "Noise reduction is off" initially', async () => {
  const id = await getExtensionId();
  const page = await context.newPage();

  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => {
    const toggle = document.getElementById('toggleSwitch') as HTMLInputElement | null;
    return toggle !== null && !toggle.disabled;
  });

  const label = page.locator('#toggleLabel');
  await expect(label).toHaveText('Noise reduction is off');

  await page.close();
});
