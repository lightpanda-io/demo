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
import { connect } from "puppeteer-core";

const browser = await connect({ browserWSEndpoint: "ws://127.0.0.1:9222" });

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://google.com", { waitUntil: "networkidle0" });

await page.type("input.lst", "lightpanda");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }),
  page.keyboard.press("Enter"),
]);

const hasConsent = await page.evaluate(() => {
  return document.querySelectorAll('form[action="https://consent.google.com/save"] input[type="submit"]').length;
});
if (hasConsent) {
  console.log("form consent detected");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('form[action="https://consent.google.com/save"] input[type="submit"]'),
  ]);
}


const html = await page.content();
console.log(html);

await page.close();
await context.close();
await browser.disconnect();

