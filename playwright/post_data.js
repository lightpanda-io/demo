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

// Import the Chromium browser into our scraper.
import { chromium } from 'playwright-core';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// Connect to an existing browser
console.log("Connection to browser on " + browserAddress);
const browser = await chromium.connectOverCDP({
    endpointURL: browserAddress,
    logger: {
      isEnabled: (name, severity) => true,
      log: (name, severity, message, args) => console.log(`${name} ${message}`)
    }
});

const context = await browser.newContext({
    baseURL: baseURL,
});

const page = await context.newPage();

const posts = [];
page.on('request', (req) => {
  if (req.method() === 'POST') posts.push(req);
});

// A fetch POST: playwright builds request.postData() from the
// postDataEntries sent with Network.requestWillBeSent.
await page.goto('/');

const fetchBody = 'name=lightpanda&over=9000';
const ok = await page.evaluate(async (body) => {
  const res = await fetch('/form/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  });
  return res.ok;
}, fetchBody);
if (!ok) throw new Error('fetch POST failed');

if (posts.length !== 1) {
  throw new Error('expected 1 POST request, got ' + posts.length);
}
if (posts[0].postData() !== fetchBody) {
  console.log(posts[0].postData());
  throw new Error('invalid fetch postData');
}

// A form submission: the document request carries the body too.
posts.length = 0;
await page.goto('/form/post.html');
await page.waitForFunction(() => {
  const p = document.querySelector('#method');
  return p && p.textContent != '';
}, null, { timeout: 4000 });

const formBody = 'h1=v1&h3=v3&favorite+drink=tea';
if (posts.length !== 1) {
  throw new Error('expected 1 form POST request, got ' + posts.length);
}
if (posts[0].postData() !== formBody) {
  console.log(posts[0].postData());
  throw new Error('invalid form postData');
}

await page.close();
await context.close();

// Turn off the browser to clean up after ourselves.
await browser.close();
