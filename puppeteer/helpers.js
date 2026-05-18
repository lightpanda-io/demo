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

const browserAddress = process.env.BROWSER_ADDRESS ?? 'ws://127.0.0.1:9222';

export async function connectBrowser() {
    const opts = browserAddress.startsWith('ws://')
        ? { browserWSEndpoint: browserAddress }
        : { browserURL: browserAddress };

    return puppeteer.connect(opts);
}

export async function isCacheClearable(browser) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
        const client = await page._client();
        const result = await client.send("Network.canClearBrowserCache");
        return result.result;
    } catch {
        return false;
    } finally {
        await page.close();
        await context.close();
    }
}

export async function needsCache(browser) {
    let avail = await isCacheClearable(browser);

    if (!avail) {
        console.log("Cache not available, skipping.");
        await browser.disconnect();
        process.exit(0);
    }
}

