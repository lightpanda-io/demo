'use strict'

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// `zig build test-server` in the browser repo
const serverRoot = 'http://127.0.0.1:9582';
// Unset: launch the installed Chrome stable (or CHROME_PATH) with a fixed
// environment, so results only change with the Chrome version.
const browserAddress = process.env.BROWSER_ADDRESS;
const browserRepo = process.env.BROWSER_REPO ?? path.resolve(import.meta.dirname, '../../browser');
const timeoutMs = 2000;

const TESTS_DIR = 'src/browser/tests';
const TEST_MARKER = /<meta\s+name=["']?lp-mode["']?\s+content=["']?test["']?\s*\/?>/i;

// Without a filter, only files tagged with the lp-mode meta run. With one,
// every matching file runs, tagged or not, so a file can be tried before
// it's tagged.
function findTests(filter) {
  const root = path.join(browserRepo, TESTS_DIR);
  return fs.readdirSync(root, { recursive: true })
    .filter((rel) => rel.endsWith('.html'))
    .filter((rel) => !filter || rel.includes(filter))
    .map((rel) => ({ rel, tagged: TEST_MARKER.test(fs.readFileSync(path.join(root, rel), 'utf8')) }))
    .filter((t) => filter || t.tagged)
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

async function connect() {
  if (browserAddress) {
    return puppeteer.connect({ browserWSEndpoint: browserAddress });
  }

  const browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    // puppeteer's defaults change behavior (cookie_store.html times out)
    ignoreDefaultArgs: true,
    args: [
      '--headless',
      '--disable-gpu',
      '--disable-popup-blocking',
      '--autoplay-policy=no-user-gesture-required',
      // Finch field trials can change web-facing behavior between two
      // profiles of the same version.
      '--enable-benchmarking',
      '--lang=en-US',
    ],
    env: {
      ...process.env,
      // UI strings (validationMessage, ...) follow LANG on Linux, --lang elsewhere
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en_US',
      TZ: 'UTC',
      // No audio device, as on CI: the default AudioContext rate otherwise
      // follows the hardware (Linux only)
      PULSE_SERVER: 'unix:/nonexistent',
      ALSA_CONFIG_PATH: '/dev/null',
    },
  });
  console.log(await browser.version());
  return browser;
}

// One tab for the whole run: a fresh context per test costs Chrome ~100ms
// each. Storage, cookies and cache carry over from one test to the next.
async function runTest(page, rel) {
  await fetch(`${serverRoot}/reset`);

  const logs = [];
  const onConsole = (msg) => {
    // Chrome's own /favicon.ico request, which the server 404s
    if (msg.location()?.url?.endsWith('/favicon.ico')) {
      return;
    }
    if (msg.type() === 'error' || msg.type() === 'warn') {
      logs.push(`console.${msg.type()}: ${msg.text()}`);
    }
  };
  const onPageError = (err) => logs.push(`pageerror: ${err.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(`${serverRoot}/${TESTS_DIR}/${rel}`, { waitUntil: 'load', timeout: timeoutMs });

    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        // testing is undefined until testing.js is run
        const ok = await page.evaluate(() => typeof testing === 'undefined' ? false : testing.assertOk());
        if (ok) {
          return { ok: true, logs };
        }
      } catch (err) {
        return { ok: false, error: err.message, logs };
      }

      if (Date.now() >= deadline) {
        await page.evaluate(() => testing.printTimeoutState()).catch(() => {});
        return { ok: false, error: 'timed out', logs };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (err) {
    return { ok: false, error: err.message, logs };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

const tests = findTests(process.argv[2]);
if (tests.length === 0) {
  console.log('no tests found');
  process.exit(1);
}

const browser = await connect();
const context = await browser.createBrowserContext();
const page = await context.newPage();
// testing.js otherwise calls assertOk on load itself, which would run
// the testing.onload callbacks a second time.
await page.evaluateOnNewDocument(() => { window.__lp_external_runner = true; });

let failures = 0;
for (const { rel, tagged } of tests) {
  const name = tagged ? rel : `${rel} (untagged)`;
  const result = await runTest(page, rel);
  if (result.ok) {
    process.stdout.write('.');
    continue;
  }

  failures += 1;
  console.log(`FAIL ${name}: ${result.error}`);
  for (const line of result.logs) {
    console.log(`     ${line.replaceAll('\n', '\n     ')}`);
  }
}
await context.close();
await (browserAddress ? browser.disconnect() : browser.close());

console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures === 0 ? 0 : 1);
