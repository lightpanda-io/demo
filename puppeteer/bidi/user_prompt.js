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

// Choose the answer of alert/confirm/prompt with lp:browsingContext.handleUserPrompt. The
// BiDi counterpart of LP.handleJavaScriptDialog over CDP.
//
// In Lightpanda, alert(), confirm() and prompt() never block: they return at
// once. So the standard browsingContext.handleUserPrompt (what puppeteer's
// dialog.accept() sends) always comes too late. Instead, Lightpanda's own
// lp:browsingContext.handleUserPrompt sets the answer *before* the page opens the dialog. It
// takes the same params as browsingContext.handleUserPrompt. The next dialog
// uses the answer, then it's cleared. Without an answer, dialogs are
// dismissed: confirm() returns false and prompt() returns null.
//
// puppeteer has no API for the lp module, but browser.connection.send() sends
// any BiDi command as is.

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url, {waitUntil: 'load'});

// The page's BiDi browsing context id.
const contextId = page.mainFrame()._id;

async function handleUserPrompt(params) {
  await browser.connection.send('lp:browsingContext.handleUserPrompt', { context: contextId, ...params });
}

function check(name, got, want) {
  assert.strictEqual(got, want, name);
  console.log(`${name}: ${JSON.stringify(got)}`);
}

// No answer set: the dialog is dismissed.
check('confirm, no answer', await page.evaluate(() => confirm('Proceed?')), false);

// Accept the next confirm().
await handleUserPrompt({ accept: true });
check('confirm, accepted', await page.evaluate(() => confirm('Proceed?')), true);

// The previous dialog used the answer.
check('confirm, answer used', await page.evaluate(() => confirm('Proceed?')), false);

// Accept the next prompt() and type a text.
await handleUserPrompt({ accept: true, userText: 'Lightpanda' });
check('prompt, typed text', await page.evaluate(() => prompt('Your name?', 'Guest')), 'Lightpanda');

// Accept without a text: prompt() returns its default text.
await handleUserPrompt({ accept: true });
check('prompt, default text', await page.evaluate(() => prompt('Your name?', 'Guest')), 'Guest');

// Dismiss: prompt() returns null.
await handleUserPrompt({ accept: false });
check('prompt, dismissed', await page.evaluate(() => prompt('Your name?', 'Guest')), null);

await page.close();
await context.close();
await browser.disconnect();
