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

import { connectBrowser } from './helpers.js'

// Puppeteer excludes page targets from auto-attach, so every page in
// browser.pages() must be one it can navigate. Chrome lists its default tab;
// a browser with no default page lists none. Either way goto must not hang.
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/form/get.html';

const browser = await connectBrowser();

for (const page of await browser.pages()) {
    await page.goto(url, {timeout: 4000});
    const html = await page.content();
    if (html.includes('favorite drink') == false) {
        console.log(html);
        throw new Error("invalid HTML content");
    }
}

await browser.disconnect();
