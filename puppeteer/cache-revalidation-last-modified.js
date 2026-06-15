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

const url = process.env.URL
  ? process.env.URL
  : "http://127.0.0.1:1236/revalidate-lm/page.html";

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

// First request — cold miss, should fetch and store.
await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
if (servedFromCache) {
  throw new Error("Expected first request to not be served from cache");
}
console.log("OK: first request was a cache miss");

// Wait for the 1s max-age to expire.
await new Promise((resolve) => setTimeout(resolve, 2000));

// Second request — entry is stale, should revalidate (If-Modified-Since)
// and serve from cache after a 304.
servedFromCache = false;
await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
if (!servedFromCache) {
  throw new Error(
    "Expected second request to be served from cache after revalidation",
  );
}
console.log("OK: second request was revalidated and served from cache");

// Third request — fresh, served from cache.
servedFromCache = false;
await page.goto(url, { waitUntil: "networkidle0", timeout: 4000 });
if (!servedFromCache) {
  throw new Error("Expected third request to be served from cache");
}
console.log("OK: third request was served from cache");

await page.close();
await context.close();
await browser.disconnect();
