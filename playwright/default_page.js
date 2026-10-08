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

import { chromium, errors } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = 'http://127.0.0.1:1234/form/get.html';

// Playwright sends no auto-attach filter, so it lists the default page of the
// default context. In Chrome that page navigates. A browser with no real page
// behind it may reject the navigation, but must not leave goto hanging.
const browser = await chromium.connectOverCDP({ endpointURL: browserAddress });

for (const page of browser.contexts()[0]?.pages() ?? []) {
    try {
        await page.goto(url, { timeout: 4000 });
    } catch (e) {
        if (e instanceof errors.TimeoutError) throw e;
        console.log(`default page rejected navigation: ${e.message.split('\n')[0]}`);
        continue;
    }
    if ((await page.content()).includes('favorite drink') == false) {
        throw new Error("invalid HTML content");
    }
}

await browser.close();
