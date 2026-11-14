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

// Drives one perf scenario through puppeteer and prints
// {"wall_ms": [...], "counters": {...}} on stdout. Started by main.go.
//
// Pages under public/perf/ expose `window.__perf`, a promise that resolves
// with the page's counters once its work is done. Awaiting it in one
// Runtime.evaluate keeps polling (and its instructions) out of the measure.

import { connectBrowser } from '../puppeteer/helpers.js';

const scenario = process.argv[2];
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1240';
const iterations = parseInt(process.env.ITERATIONS ?? '1');
// What the page may load, e.g. {"subFrame":true}: set over CDP, so it works
// on a browser started without the matching --load-resources flags.
const loading = process.env.LOADING ? JSON.parse(process.env.LOADING) : null;

function check(cond, msg, data) {
  if (!cond) {
    console.error(scenario, msg, JSON.stringify(data));
    process.exit(1);
  }
}

// Navigate to a perf page and wait for its work.
async function perfPage(page, path) {
  await page.goto(baseURL + path, { waitUntil: 'load' });
  return page.evaluate(() => window.__perf);
}

const scenarios = {
  idle: async () => ({}),

  // The old cdp.js flow.
  campfire: async (page) => {
    await page.goto(baseURL + '/campfire-commerce/', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#product-price').textContent.length > 0 &&
      document.querySelectorAll('#product-reviews > div').length > 0, { polling: 'mutation', timeout: 5000 });
    const res = await page.evaluate(() => ({
      price: document.querySelector('#product-price').textContent,
      related: document.querySelectorAll('#product-related > div').length,
      reviews: document.querySelectorAll('#product-reviews > div').length,
    }));
    check(res.price === '$244.99' && res.related === 3 && res.reviews === 3, 'unexpected product', res);
    return res;
  },

  network: async (page) => {
    const res = await perfPage(page, '/perf/network/');
    check(res.scripts === 13 && res.sheets === 6 && res.fetched === 3 && res.images === 3, 'unexpected network result', res);
    return res;
  },

  frames: async (page) => {
    const res = await perfPage(page, '/perf/frames/');
    check(res.ready === 6 && res.pongs === 60 && res.worker === 50, 'unexpected frames result', res);
    return res;
  },

  style: async (page) => perfPage(page, '/perf/style/'),
  'style-anim': async (page) => perfPage(page, '/perf/style/'),
  layout: async (page) => perfPage(page, '/perf/layout/'),
  gbcr: async (page) => {
    const res = await perfPage(page, '/perf/gbcr/');
    check(res.n === 8007 && res.records === 4200, 'unexpected gbcr result', res);
    return res;
  },
  dom: async (page) => perfPage(page, '/perf/dom/'),
  render: async (page) => {
    const res = await perfPage(page, '/perf/render/');
    check(res.rows > 0, 'unexpected render result', res);
    return res;
  },

  // In-page elementFromPoint loops, then real clicks: puppeteer resolves the
  // box, lightpanda hit-tests the dispatched mouse events.
  hittest: async (page) => {
    const res = await perfPage(page, '/perf/hittest/');
    // page.click() refuses points outside the 800x600 viewport, and our
    // layout doesn't always agree with its scroll math. Aim at the box
    // lightpanda reports instead: still a CDP hit test per event.
    const center = async (sel) => {
      const box = await (await page.$(sel)).boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2];
    };
    for (let i = 0; i < 40; i++) {
      const [x, y] = await center(`#b${(i * 37) % 400}`);
      await page.mouse.click(x, y);
    }
    for (let i = 0; i < 20; i++) {
      const [x, y] = await center(`#b${(i * 53) % 400}`);
      await page.mouse.move(x, y);
    }
    res.clicks = await page.evaluate(() => window.__clicks);
    check(res.clicks === 40, 'clicks lost', res);
    return res;
  },

  // What agents call on a page: full DOM, AX tree, markdown, semantic tree.
  cdp: async (page) => {
    const res = await perfPage(page, '/perf/cdp/');
    const client = await page.createCDPSession();
    const doc = await client.send('DOM.getDocument', { depth: -1 });
    const ax = await client.send('Accessibility.getFullAXTree');
    const md = await client.send('LP.getMarkdown');
    const tree = await client.send('LP.getSemanticTree');
    const inter = await client.send('LP.getInteractiveElements');
    const html = await page.content();
    res.ax = ax.nodes.length;
    res.md = JSON.stringify(md).length;
    res.tree = JSON.stringify(tree).length;
    res.inter = JSON.stringify(inter).length;
    res.html = html.length;
    check(doc.root && res.ax > 1000, 'small trees', res);
    await client.detach();
    return res;
  },
};

const fn = scenarios[scenario];
if (!fn) {
  console.error('unknown scenario', scenario);
  process.exit(1);
}

const browser = await connectBrowser();
const wall_ms = [];
let counters = {};
for (let i = 0; i < iterations; i++) {
  const start = process.hrtime.bigint();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (loading) await page._client().send('LP.configureLoading', loading);
  counters = await fn(page);
  await page.close();
  await context.close();
  wall_ms.push(Number(process.hrtime.bigint() - start) / 1e6);
}
await browser.disconnect();
console.log(JSON.stringify({ wall_ms, counters }));
