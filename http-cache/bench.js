// Copyright 2023-2026 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict'

// HTTP cache benchmark: measures navigation timing and cache-hit ratio
// across repeated loads of the same resource, isolating cold (disk
// cache cleared) vs warm (resource already cached) performance.
//
// Usage:
//   node runner/main.go -serve &   # or your own BASE_URL
//   RUNS=20 node http-cache/bench.js
//
// Env:
//   BASE_URL        default http://127.0.0.1:1234
//   BROWSER_ADDRESS default ws://127.0.0.1:9222 (see helpers.js)
//   RUNS            navigations per scenario, default 20
//   PATH_UNDER_TEST default /caching/simple.html

import { writeFileSync } from 'node:fs';
import { connectBrowser, needsCache } from '../puppeteer/helpers.js'

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 20;
const target = baseURL + (process.env.PATH_UNDER_TEST ?? '/caching/simple.html');

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: pct(0.5),
    p95: pct(0.95),
  };
}

// Runs one navigation and reports timing plus which sub-resources were
// served from the disk cache, via CDP Network events.
async function navigateOnce(browser, { clearCache }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const client = await page._client();

  await client.send('Network.enable');
  if (clearCache) {
    await client.send('Network.clearBrowserCache');
  }

  let requests = 0;
  let cacheHits = 0;
  client.on('Network.requestServedFromCache', () => { cacheHits++; });
  client.on('Network.responseReceived', (event) => {
    requests++;
    if (event.response.fromDiskCache) cacheHits++;
  });

  const start = process.hrtime.bigint();
  await page.goto(target, { waitUntil: 'load', timeout: 4000 });
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

  await page.close();
  await context.close();

  return { durationMs, requests, cacheHits };
}

(async () => {
  const browser = await connectBrowser();
  await needsCache(browser);

  console.log(`target: ${target}`);
  console.log(`runs: ${runs}\n`);

  // Scenario 1: cold loads only (cache cleared before every navigation).
  const cold = [];
  for (let i = 0; i < runs; i++) {
    cold.push(await navigateOnce(browser, { clearCache: true }));
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  // Scenario 2: warm loads (cache cleared once, then repeated navigations
  // in fresh contexts so disk cache persistence is what's measured, not
  // in-memory/session reuse).
  {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const client = await page._client();
    await client.send('Network.clearBrowserCache');
    await page.close();
    await context.close();
  }

  const warm = [];
  for (let i = 0; i < runs; i++) {
    warm.push(await navigateOnce(browser, { clearCache: false }));
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  await browser.disconnect();

  const coldStats = stats(cold.map((r) => r.durationMs));
  const warmStats = stats(warm.map((r) => r.durationMs));
  const warmHitRatio = warm.reduce((s, r) => s + r.cacheHits, 0) / warm.reduce((s, r) => s + r.requests, 0);

  console.log('cold (cache cleared each run), ms:', coldStats);
  console.log('warm (cache persists across runs), ms:', warmStats);
  console.log('warm cache hit ratio:', (warmHitRatio * 100).toFixed(1) + '%');
  console.log('speedup (cold avg / warm avg):', (coldStats.avg / warmStats.avg).toFixed(2) + 'x');

  writeFileSync('http-cache/results.json', JSON.stringify({ target, runs, cold, warm }, null, 2));
})();
