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
import { connectBrowser } from './helpers.js'

const url = process.env.URL ?? 'http://127.0.0.1:1234/mouse_buttons/';

const browser = await connectBrowser();

const events = (page) => page.evaluate(() => window.events);

async function run(name, hash, fn, expected) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(url + hash, { waitUntil: 'load' });
  // Hover first, so each sequence starts from a pointer already over the
  // target; a click's own move to the same spot is a pointermove.
  await page.mouse.move(150, 150);
  await page.evaluate(() => { window.events = []; });
  await fn(page);
  assert.deepStrictEqual(await events(page), expected, name);
  await page.close();
  await context.close();
}

await run('left click', '', (p) => p.mouse.click(150, 150), [
  'pointermove:-1:0', 'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0',
]);
// Linux and macOS fire contextmenu on press, Windows on release.
await run('right click', '', (p) => p.mouse.click(150, 150, { button: 'right' }), [
  'pointermove:-1:0', 'pointerdown:2:2', 'mousedown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'mouseup:2:0', 'auxclick:2:0',
]);
await run('middle click', '', (p) => p.mouse.click(150, 150, { button: 'middle' }), [
  'pointermove:-1:0', 'pointerdown:1:4', 'mousedown:1:4', 'pointerup:1:0', 'mouseup:1:0', 'auxclick:1:0',
]);
await run('forward click', '', (p) => p.mouse.click(150, 150, { button: 'forward' }), [
  'pointermove:-1:0', 'pointerdown:4:16', 'mousedown:4:16', 'pointerup:4:0', 'mouseup:4:0', 'auxclick:4:0',
]);
await run('double click', '', (p) => p.mouse.click(150, 150, { clickCount: 2 }), [
  'pointermove:-1:0', 'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0', 'dblclick:0:0',
]);

await run('chord left+right, right up first', '', async (p) => {
  await p.mouse.down();
  await p.mouse.down({ button: 'right' });
  await p.mouse.up({ button: 'right' });
  await p.mouse.up();
}, [
  'pointerdown:0:1', 'mousedown:0:1', 'pointermove:2:3', 'mousedown:2:3', 'contextmenu:2:3',
  'pointermove:2:1', 'mouseup:2:1', 'auxclick:2:1', 'pointerup:0:0', 'mouseup:0:0',
]);
await run('chord left+right, left up first', '', async (p) => {
  await p.mouse.down();
  await p.mouse.down({ button: 'right' });
  await p.mouse.up();
  await p.mouse.up({ button: 'right' });
}, [
  'pointerdown:0:1', 'mousedown:0:1', 'pointermove:2:3', 'mousedown:2:3', 'contextmenu:2:3',
  'pointermove:0:2', 'mouseup:0:2', 'click:0:2', 'pointerup:2:0', 'mouseup:2:0',
]);

await run('right click, pointerdown cancelled', '#pd', (p) => p.mouse.click(150, 150, { button: 'right' }), [
  'pointermove:-1:0', 'pointerdown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'auxclick:2:0',
]);

await run('clickCount 0', '', async (p) => {
  const client = await p.createCDPSession();
  for (const button of ['left', 'right']) {
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 150, button, clickCount: 0 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 150, y: 150, button, clickCount: 0 });
  }
}, [
  'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0',
  'pointerdown:2:2', 'mousedown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'mouseup:2:0',
]);

// A disabled control gets the pointer events, contextmenu and auxclick, but no
// mouse events or click.
await run('disabled', '#disabled', async (p) => {
  await p.mouse.click(150, 150);
  await p.mouse.click(150, 150, { button: 'right' });
}, [
  'pointermove:-1:0', 'pointerdown:0:1', 'pointerup:0:0',
  'pointermove:-1:0', 'pointerdown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'auxclick:2:0',
]);

{
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.mouse.click(150, 150, { clickCount: 2 });
  await page.mouse.click(150, 150, { button: 'right' });
  const classes = await page.evaluate(() => window.classes);
  for (const type of ['click', 'auxclick', 'contextmenu']) {
    assert.strictEqual(classes[type], 'PointerEvent', `${type} class`);
  }
  assert.strictEqual(classes.dblclick, 'MouseEvent', 'dblclick class');
  await page.close();
  await context.close();
}

await browser.disconnect();
