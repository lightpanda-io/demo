'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:9222',
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

let resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
let headers = await resp.json();

assert.equal(headers['User-Agent'], "Lightpanda/1.0");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

// Mozilla is ignored
await page.setUserAgent("Mozilla/5.0");

resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
headers = await resp.json();

assert.equal(headers['User-Agent'], "Lightpanda/1.0");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

// Override UA
await page.setUserAgent("foo/bar");

resp = await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});
headers= await resp.json();

assert.equal(headers['User-Agent'], "foo/bar");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

await page.close();
await context.close();
await browser.disconnect();
