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

// Choose the answer of alert/confirm/prompt with lp:browsingContext.handleUserPrompt.
//
// In Lightpanda, alert(), confirm() and prompt() never block: they return at
// once. So the standard browsingContext.handleUserPrompt always comes too late
// and answers "no such alert". Instead, Lightpanda's own lp:browsingContext.handleUserPrompt
// sets the answer *before* the page opens the dialog. It takes the same params
// as browsingContext.handleUserPrompt. The next dialog uses the answer, then
// it's cleared. Without an answer, dialogs are dismissed: confirm() returns
// false and prompt() returns null.
//
// selenium-webdriver has no class for the lp module, but bidi.send() sends any
// command as is.
//
// Run Lightpanda with `serve --protocol webdriver` first.
import { Builder, Browser, Capabilities } from 'selenium-webdriver';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web page to load.
const url = process.env.URL ? process.env.URL : 'https://demo-browser.lightpanda.io/campfire-commerce/';

// Sends a raw BiDi command. bidi.send() resolves with the whole reply, errors
// included, so check the type here.
async function send(bidi, method, params) {
  const res = await bidi.send({ method, params });
  if (res.type === 'error') {
    throw new Error(`${method}: ${res.error}: ${res.message}`);
  }
  return res.result;
}

function check(name, got, want) {
  if (got !== want) {
    throw new Error(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  console.log(`${name}: ${JSON.stringify(got)}`);
}

(async () => {
  const capabilities = new Capabilities();
  capabilities.setBrowserName(Browser.CHROME);
  capabilities.set('webSocketUrl', true);

  const driver = await new Builder()
    .usingServer(serverURL)
    .withCapabilities(capabilities)
    .build();

  await driver.get(url);

  const bidi = await driver.getBidi();
  await bidi.waitForConnection();

  // The window handle is the BiDi browsing context id.
  const context = await driver.getWindowHandle();

  // No answer set: the dialog is dismissed.
  check('confirm, no answer', await driver.executeScript("return confirm('Proceed?')"), false);

  // Accept the next confirm().
  await send(bidi, 'lp:browsingContext.handleUserPrompt', { context, accept: true });
  check('confirm, accepted', await driver.executeScript("return confirm('Proceed?')"), true);

  // The previous dialog used the answer.
  check('confirm, answer used', await driver.executeScript("return confirm('Proceed?')"), false);

  // Accept the next prompt() and type a text.
  await send(bidi, 'lp:browsingContext.handleUserPrompt', { context, accept: true, userText: 'Lightpanda' });
  check('prompt, typed text', await driver.executeScript("return prompt('Your name?', 'Guest')"), 'Lightpanda');

  // Accept without a text: prompt() returns its default text.
  await send(bidi, 'lp:browsingContext.handleUserPrompt', { context, accept: true });
  check('prompt, default text', await driver.executeScript("return prompt('Your name?', 'Guest')"), 'Guest');

  // Dismiss: prompt() returns null.
  await send(bidi, 'lp:browsingContext.handleUserPrompt', { context, accept: false });
  check('prompt, dismissed', await driver.executeScript("return prompt('Your name?', 'Guest')"), null);

  // The standard command has no open prompt to act on.
  try {
    await send(bidi, 'browsingContext.handleUserPrompt', { context, accept: true });
  } catch (err) {
    console.log('standard command:', err.message);
  }

  await driver.quit();
  bidi.close();
})();
