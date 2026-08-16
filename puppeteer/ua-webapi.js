'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();

// Load a page first so fetch runs from the same origin.
await page.goto('http://127.0.0.1:1234/get/headers', {waitUntil: 'load'});

const fetchHeaders = async (value) => {
  return await page.evaluate(async (value) => {
    const resp = await fetch('/get/headers', {
      headers: {
        "User-Agent": value,
        "Sec-Ch-Ua": value,
      },
    });
    return await resp.json();
  }, value);
};

// Overriding UA with Mozilla via fetch must be ignored.
let headers = await fetchHeaders("Mozilla/5.0");

assert.equal(headers['User-Agent'], "Lightpanda/1.0");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

// Overriding UA via fetch is allowed.
headers = await fetchHeaders("foo/bar");

assert.equal(headers['User-Agent'], "foo/bar");
assert.equal(headers['Sec-Ch-Ua'], '"Lightpanda";v="1"');

await page.close();
await context.close();
await browser.disconnect();
