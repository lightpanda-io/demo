// Copyright 2023-2025 Lightpanda (Selecy SAS)
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
"use strict";

import puppeteer from "puppeteer-core";

const browserAddress = process.env.BROWSER_ADDRESS
  ? process.env.BROWSER_ADDRESS
  : "ws://127.0.0.1:9222";
const baseURL = process.env.URL ? process.env.URL : "http://127.0.0.1:1234";

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://duckduckgo.com", {
  waitUntil: "networkidle0",
  timeout: 10000,
});

await page.type("input[name=q]", "lightpanda");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }),
  page.keyboard.press("Enter"),
]);

const result = await page.evaluate(() => {
  // DuckDuckGo serves an anti-bot challenge ("anomaly modal") instead of
  // results when it flags the traffic as automated. Detect it so we don't
  // report a misleading "invalid results" failure.
  const captcha =
    document.querySelector('[data-testid="anomaly-modal"]') !== null ||
    document.body.innerHTML.includes("containing a duck");

  const links = Array.from(
    document.querySelectorAll('a[data-testid="result-title-a"]'),
  ).map((row) => row.getAttribute("href"));

  return { captcha, links };
});

await page.close();
await context.close();
await browser.disconnect();

if (result.captcha) {
  // Not a Lightpanda failure: DuckDuckGo blocked the request with its
  // bot-detection CAPTCHA, so no results were ever rendered. Skip the
  // assertions instead of reporting a false negative.
  console.log("SKIP: DuckDuckGo served an anti-bot CAPTCHA, no results to check");
  // integration/main.go detects the special error code
  process.exit(103);
}

const links = result.links;

let found = {
  homepage: false,
  github: false,
  sourceforge: false,
};
for (const link of links) {
  if (link === "https://lightpanda.io/") found.homepage = true;
  else if (link.startsWith("https://github.com/lightpanda-io"))
    found.github = true;
  else if (
    link.startsWith(
      "https://sourceforge.net/projects/lightpanda-browser.mirror/",
    )
  )
    found.sourceforge = true;
}

if (!found.homepage || !found.github || !found.sourceforge) {
  console.log("Failed to find expected links", found);
  throw new Error("invalid results");
}
