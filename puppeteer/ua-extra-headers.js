'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();

// Mozilla is ignored
await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0",
    "Sec-Ch-Ua": "Mozilla/5.0",
});

let resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
let headers = await resp.json();

assert.equal(headers['User-Agent'], "Lightpanda/1.0");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

// Override UA
await page.setExtraHTTPHeaders({
    "User-Agent": "foo/bar",
    "Sec-Ch-Ua": "foo/bar",
});

resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
headers = await resp.json();

assert.equal(headers['User-Agent'], "foo/bar");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

await page.close();
await context.close();
await browser.disconnect();
