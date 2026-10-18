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

// The legacy keyCode, which and charCode of typed keys, as headless Chrome
// reports them. Runs unchanged against Chrome.
import assert from 'assert';
import { chromium } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// Each character with the windowsVirtualKeyCode Playwright sends for it, which
// keydown and keyup report. keypress reports the character's code point.
const KEYS = [
  ['a', 65], ['.', 190], ['b', 66], ['%', 53], ['c', 67], ['(', 57],
  ['d', 68], ["'", 222], ['e', 69], ['&', 55], ['f', 70], ['!', 49],
  ['G', 71], [',', 188], [';', 186], ['?', 191], ['[', 219], ['~', 192],
  ['5', 53], [' ', 32],
];

const browser = await chromium.connectOverCDP(browserAddress);
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseURL + '/keyboard_keycode.html', { waitUntil: 'load' });

await page.focus('#ta');
const text = KEYS.map(([c]) => c).join('');
await page.keyboard.type(text);

const state = await page.evaluate(() => ({ value: document.getElementById('ta').value, events: window.events }));

// The page cancels keydowns with keyCode 46 or 37-40, as ProseMirror does:
// with the right key codes, no character is lost.
assert.strictEqual(state.value, text, 'typed text');

assert.deepStrictEqual(state.events, KEYS.flatMap(([c, vk]) => {
  const cp = c.codePointAt(0);
  return [`keydown:${c}:${vk}/${vk}/0`, `keypress:${c}:${cp}/${cp}/${cp}`, `keyup:${c}:${vk}/${vk}/0`];
}), 'key events');

await context.close();
await browser.close();
