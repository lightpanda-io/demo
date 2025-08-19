// Copyright 2023-2024 Lightpanda (Selecy SAS)
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
import { chromium } from 'playwright';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'https://doesnotexist.localhost:9832';

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
await page.route('**', async (route, request) => {
  const url = request.url();
  if (url === 'https://doesnotexist.localhost:9832/nope/') {
    return route.continue({
      url: "https://httpbin.io/xhr/post",
    });
  }
  if (url === 'https://httpbin.io/post') {
    return route.continue({
      method: 'POST',
      url: 'https://HTTPBIN.io/post',
      headers: {'pw-injected': 'great', 'content-type': 'application/x-www-form-urlencoded'},
      postData: 'over=9000&tea=keemun',
    });
  }

  console.error("unexpected request: ", url);
  return route.abort();
});
await page.goto('/nope/');

await page.waitForSelector('#response', {timeout: 5000});
const response = await page.locator('#response').textContent();
const data = JSON.parse(response);

if (data.url !== 'http://HTTPBIN.io/post') {
  console.log(data.url);
  throw new Error("Expected URL to be 'http://HTTPBIN.io/post'");
}

if (data.headers['Pw-Injected'] != 'great') {
  console.log(data.headers);
  throw new Error("Expected 'Pw-Injected: great' header");
}

if (data.headers['Content-Type'] != 'application/x-www-form-urlencoded') {
  console.log(data.headers);
  throw new Error("Expected 'Content-Type: application/x-www-form-urlencoded' header");
}

if (data.headers['User-Agent'] != 'Lightpanda/1.0') {
  console.log(data.headers);
  throw new Error("Expected 'User-Agent: Lightpanda/1.0' header");
}

if (Object.keys(data.form).length != 2) {
  console.log(data.form);
  throw new Error("Expected 2 form field");
}

if (data.form['over'] != '9000') {
  console.log(data.form);
  throw new Error("Expected form field 'over: 9000'");
}

if (data.form['tea'] != 'keemun') {
  console.log(data.form);
  throw new Error("Expected form field 'tea: keemun'");
}

await page.close();
await context.close();

// Turn off the browser to clean up after ourselves.
await browser.close();
