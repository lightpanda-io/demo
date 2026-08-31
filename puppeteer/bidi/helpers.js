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

import puppeteer from 'puppeteer-core';

// Lightpanda serves WebDriver BiDi on /session, the path Firefox advertises
// its BiDi endpoint on. The same port speaks CDP on every other path, which
// is why these tests are split from puppeteer/ rather than parameterised:
// they exercise a different server module.
const browserAddress = process.env.BROWSER_ADDRESS ?? 'ws://127.0.0.1:9222';

export async function connectBrowser() {
    return puppeteer.connect({
        browserWSEndpoint: browserAddress + '/session',
        protocol: 'webDriverBiDi',
    });
}

export function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// Polls `fn` in the page until it returns something truthy.
//
// The BiDi module only implements content extraction so far, so there is no
// server-side wait to lean on: page.waitForSelector and page.waitForFunction
// both need script.addPreloadScript and handles. Polling from here is what a
// script writer can do today, and it keeps the test independent of exactly
// when a given engine fires `load` relative to a fetch the page started.
export async function waitFor(page, fn, message, timeout = 5000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = await page.evaluate(fn);
        if (value) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}
