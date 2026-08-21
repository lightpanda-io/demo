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

// Lightpanda exposes a WebDriver BiDi endpoint on ws://127.0.0.1:9222/session.
// It is a BiDi-only endpoint: there is no classic WebDriver HTTP server, so
// Selenium's `Builder` can't be used. We talk to it with the low-level BiDi
// modules shipped in selenium-webdriver instead.
import BiDi from 'selenium-webdriver/bidi/index.js';
import { Session } from 'selenium-webdriver/bidi/generated/session.js';
import { BrowsingContext } from 'selenium-webdriver/bidi/generated/browsing_context.js';
import { Script } from 'selenium-webdriver/bidi/generated/script.js';

// BiDi websocket url.
const bidiURL = process.env.BIDI_URL ? process.env.BIDI_URL : 'ws://127.0.0.1:9222/session';

// web page to load.
const url = process.env.URL ? process.env.URL : 'https://demo-browser.lightpanda.io/campfire-commerce/';

(async () => {
  const bidi = new BiDi(bidiURL);
  await bidi.waitForConnection();

  const session = new Session(bidi);
  const res = await session.new({ capabilities: {} });
  console.log('session', res.sessionId, res.capabilities.browserName, res.capabilities.browserVersion);

  const browsingContext = new BrowsingContext(bidi);
  const script = new Script(bidi);

  // Create a new top-level browsing context (a tab).
  const { context } = await browsingContext.create({ type: 'tab' });

  // Load the page and wait for the load event.
  await browsingContext.navigate({ context, url, wait: 'complete' });

  // Evaluate some JavaScript in the page.
  const title = await script.evaluate({
    expression: 'document.title',
    target: { context },
    awaitPromise: false,
  });
  console.log('title:', title.result.value);

  // Find all links with a locator.
  const { nodes } = await browsingContext.locateNodes({
    context,
    locator: { type: 'css', value: 'a' },
  });
  console.log('links:', nodes.length);

  await browsingContext.close({ context });
  await session.end();
  bidi.close();
})();
