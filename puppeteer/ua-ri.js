'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();

let override_value = "";

await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.isInterceptResolutionHandled()) return;

  const headers = Object.assign({}, req.headers(), {
    "User-Agent": override_value,
    "Sec-Ch-Ua": override_value,
  });

  req.continue({ headers });
});

// Overriding UA with Mozilla via request interception must be ignored.
override_value = "Mozilla/5.0"

let resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
let headers = await resp.json();

assert.equal(headers['User-Agent'], "Lightpanda/1.0");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

// Overriding UA via request interception is allowed.
override_value = "foo/bar"

resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
headers = await resp.json();

assert.equal(headers['User-Agent'], "foo/bar");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
headers= await resp.json();

await page.close();
await context.close();
await browser.disconnect();
