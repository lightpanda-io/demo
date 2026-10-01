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

// The pointer/mouse/activation event sequence of each mouse button, recorded
// from headless Chrome on Linux. Runs unchanged against Chrome.
import assert from 'assert';
import { chromium } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/mouse_buttons/';

const browser = await chromium.connectOverCDP(browserAddress);

async function run(name, fn, expected) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await fn(page);
  const events = await page.evaluate(() => window.events);
  assert.deepStrictEqual(events, expected, name);
  await context.close();
}

await run('left click', (p) => p.click('#t'), [
  'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0', 'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0',
]);
// Linux and macOS fire contextmenu on press, Windows on release.
await run('right click', (p) => p.click('#t', { button: 'right' }), [
  'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0', 'pointerdown:2:2', 'mousedown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'mouseup:2:0', 'auxclick:2:0',
]);
await run('middle click', (p) => p.click('#t', { button: 'middle' }), [
  'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0', 'pointerdown:1:4', 'mousedown:1:4', 'pointerup:1:0', 'mouseup:1:0', 'auxclick:1:0',
]);
await run('double click', (p) => p.dblclick('#t'), [
  'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0',
  'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0',
  'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0', 'dblclick:0:0',
]);
await run('chord left+right', async (p) => {
  await p.mouse.move(150, 150);
  await p.mouse.down();
  await p.mouse.down({ button: 'right' });
  await p.mouse.up({ button: 'right' });
  await p.mouse.up();
}, [
  'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0', 'pointerdown:0:1', 'mousedown:0:1', 'pointermove:2:3', 'mousedown:2:3', 'contextmenu:2:3',
  'pointermove:2:1', 'mouseup:2:1', 'auxclick:2:1', 'pointerup:0:0', 'mouseup:0:0',
]);

await browser.close();
