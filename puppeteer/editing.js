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

import assert from 'assert';
import { connectBrowser } from './helpers.js'

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.goto(baseURL + '/editing.html', {waitUntil: 'load'});

const state = (id) => page.evaluate((id) => ({value: document.getElementById(id).value, events: window.events[id]}), id);

// Enter in a <textarea> is a line break, for beforeinput and input alike.
await page.focus('#ta');
await page.evaluate(() => document.getElementById('ta').setSelectionRange(3, 3));
await page.keyboard.press('Enter');
assert.deepStrictEqual(await state('ta'), {
  value: 'one\n',
  events: ['keydown', 'beforeinput:insertLineBreak:null', 'textInput:\n', 'input:insertLineBreak:null', 'keyup'],
}, 'Enter in a textarea');

// A readonly control still fires beforeinput and textInput for typed text,
// as Chrome lets any text control reach them, but its value doesn't change and
// no input follows. Backspace and Enter are editing commands, disabled on a
// readonly control, so they fire no edit event at all.
for (const id of ['ro', 'roi']) {
  await page.focus('#' + id);
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.keyboard.sendCharacter('y');
  assert.deepStrictEqual(await state(id), {
    value: 'ro',
    events: [
      'keydown', 'beforeinput:insertText:x', 'textInput:x', 'keyup',
      'keydown', 'keyup',
      'keydown', 'keyup',
      'beforeinput:insertText:y', 'textInput:y',
    ],
  }, `readonly #${id}`);
}

await page.close();
await context.close();
await browser.disconnect();
