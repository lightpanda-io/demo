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

// Lightpanda serves WebDriver on http://127.0.0.1:9222 (`serve --protocol
// webdriver`). The driver is built the usual way, with Builder().usingServer()
// and BiDi enabled: pages are loaded over the HTTP session (driver.get), and
// everything else goes through the BiDi modules shipped in selenium-webdriver.
import { Builder, Browser } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { BrowsingContext } from 'selenium-webdriver/bidi/generated/browsing_context.js';
import { Script } from 'selenium-webdriver/bidi/generated/script.js';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web page to load.
const url = process.env.URL ? process.env.URL : 'https://demo-browser.lightpanda.io/campfire-commerce/';

(async () => {
  const driver = await new Builder()
    .usingServer(serverURL)
    .forBrowser(Browser.CHROME)
    .setChromeOptions(new chrome.Options().enableBidi())
    .build();

  const session = await driver.getSession();
  const caps = await driver.getCapabilities();
  console.log('session', session.getId(), caps.getBrowserName(), caps.getBrowserVersion());

  // Load the page and wait for the load event.
  await driver.get(url);

  const bidi = await driver.getBidi();
  await bidi.waitForConnection();

  const browsingContext = new BrowsingContext(bidi);
  const script = new Script(bidi);

  // The session's top-level browsing context, the page driver.get loaded.
  const { contexts } = await browsingContext.getTree({});
  const context = contexts[0].context;

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

  await driver.quit();
  bidi.close();
})();
