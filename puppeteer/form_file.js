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
'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234'
const browser = await connectBrowser();

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

let content = "no content";

try {
  await page.goto(baseURL + "/form/input_file.html");

  const input = await page.waitForSelector("input[type=file]");
  await input.uploadFile(import.meta.dirname + "/../public/form/input_file.html");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("input[type=submit]"),
  ]);

  content = await page.evaluate(() => { return document.querySelector('p').textContent; });

} finally {
  await context.close();
  await browser.disconnect();
}

assert.equal(content, 'received: input_file.html (144)');
