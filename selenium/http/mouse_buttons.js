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

// The pointer/mouse/activation event sequence of WebDriver clicks, recorded
// from chromedriver with headless Chrome on Linux. Stock W3C WebDriver over
// HTTP, so it runs unchanged against chromedriver. Lightpanda needs
// `serve --protocol webdriver`.
import assert from 'node:assert/strict';
import { Builder, Browser, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/mouse_buttons/';

const driver = await new Builder()
  .usingServer(serverURL)
  .forBrowser(Browser.CHROME)
  .setChromeOptions(new chrome.Options().addArguments('--headless=new'))
  .build();

// The steps run back to back in one session, so a click count carried over
// from the previous step shows up as a stray dblclick.
async function step(name, fn, expected) {
  await driver.get(url);
  await fn(await driver.findElement(By.id('t')));
  const events = await driver.executeScript('return window.events');
  assert.deepEqual(events, expected, name);
}

try {
  await step('click', (t) => t.click(), [
    'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0',
    'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0',
  ]);
  // Linux and macOS fire contextmenu on press, Windows on release.
  await step('contextClick', (t) => driver.actions().contextClick(t).perform(), [
    'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0',
    'pointerdown:2:2', 'mousedown:2:2', 'contextmenu:2:2', 'pointerup:2:0', 'mouseup:2:0', 'auxclick:2:0',
  ]);
  await step('doubleClick', (t) => driver.actions().doubleClick(t).perform(), [
    'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0',
    'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0',
    'pointerdown:0:1', 'mousedown:0:1', 'pointerup:0:0', 'mouseup:0:0', 'click:0:0', 'dblclick:0:0',
  ]);
  await step('middle click', (t) => driver.actions().move({ origin: t }).press(1).release(1).perform(), [
    'pointerover:-1:0', 'mouseover:0:0', 'pointermove:-1:0',
    'pointerdown:1:4', 'mousedown:1:4', 'pointerup:1:0', 'mouseup:1:0', 'auxclick:1:0',
  ]);
} finally {
  await driver.quit();
}
