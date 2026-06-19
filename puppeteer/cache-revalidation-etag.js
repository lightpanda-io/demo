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
import puppeteer from "puppeteer-core";
import { connectBrowser, needsCache } from "./helpers.js";

const base = process.env.BASE_URL || "http://127.0.0.1:1236";
const url = `${base}/revalidate-etag/page.html`;
const bumpUrl = `${base}/revalidate/bump`;

const browser = await connectBrowser();
await needsCache(browser);
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

let servedFromCache = false;
client.on("Network.requestServedFromCache", () => {
  servedFromCache = true;
});

await client.send("Network.clearBrowserCache");

// 1. Cold miss — stores current version (vN).
let response = await page.goto(url, {
  waitUntil: "networkidle0",
  timeout: 4000,
});
if (servedFromCache) throw new Error("Expected cold miss");
let body = await page.content();
const versionMatch = body.match(/v(\d+)/);
if (!versionMatch) throw new Error(`Could not parse version from: ${body}`);
const v0 = versionMatch[1];
console.log(`OK: cold miss, got v${v0}`);

// Wait for max-age=1 to expire.
await new Promise((r) => setTimeout(r, 1500));

// 2. Stale → revalidation: server unchanged → 304 → served from cache (v0).
servedFromCache = false;
await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
body = await page.content();
if (!body.includes(`v${v0}`)) {
  throw new Error(`Expected revalidated v${v0}, got: ${body}`);
}
console.log(`OK: revalidation succeeded (304), still v${v0}`);

await new Promise((r) => setTimeout(r, 1500));

// 3. Bump server-side version out-of-band (simulates content change).
await fetch(bumpUrl);

// 4. Stale → revalidation: If-None-Match no longer matches → 200 with new version.
servedFromCache = false;
response = await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
if (servedFromCache)
  throw new Error("Expected network fetch for changed content");
if (response.status() !== 200) {
  throw new Error(`Expected 200, got ${response.status()}`);
}
body = await page.content();
const v1Match = body.match(/v(\d+)/);
if (!v1Match || v1Match[1] === v0) {
  throw new Error(`Expected new version after change, got: ${body}`);
}
const v1 = v1Match[1];
console.log(`OK: revalidation detected change, got v${v1}`);

// 5. Fresh from cache, vN+1.
await new Promise((r) => setTimeout(r, 100));
servedFromCache = false;
await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
if (!servedFromCache) throw new Error("Expected fresh cache hit");
body = await page.content();
if (!body.includes(`v${v1}`)) {
  throw new Error(`Expected cached v${v1}, got: ${body}`);
}
console.log(`OK: served fresh v${v1} from cache`);

await page.close();
await context.close();
await browser.disconnect();
