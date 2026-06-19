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
'use strict'

// Integration demo: log into the Lightpanda staging console.
//
// The console (https://console.staging.lightpanda.io) is a Next.js SPA whose
// /login page is a Mantine form: an email field (placeholder
// "ziggy@lightpanda.io"), a type="password" field, and a type="submit" button.
// On success the form mutation flips the auth state and the Next.js router
// client-side-navigates to "/" (the dashboard) — there is no full page reload,
// so we wait on location.pathname rather than page.waitForNavigation().
//
// Credentials are read from LP_LOGIN / LP_PASSWD (with defaults below) so the
// secret never has to live on the command line.

import puppeteer from 'puppeteer-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const baseURL = process.env.URL ? process.env.URL : 'https://console.staging.lightpanda.io';

const login = process.env.LP_LOGIN;
const passwd = process.env.LP_PASSWD;

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(baseURL + '/login', {waitUntil: 'networkidle0', timeout: 30000});

// The Mantine inputs are rendered client-side; wait for the form to mount.
const emailSel = 'input[placeholder="ziggy@lightpanda.io"]';
const passwordSel = 'input[type="password"]';
await page.waitForSelector(emailSel, {timeout: 10000});
await page.waitForSelector(passwordSel, {timeout: 10000});

await page.type(emailSel, login);
await page.type(passwordSel, passwd);

// Submit the credentials. Login success triggers a client-side router push to
// "/", so we wait for the pathname to leave /login instead of a navigation.
await page.click('button[type="submit"]');

await page.waitForFunction(() => {
  return window.location.pathname === '/';
}, {timeout: 30000});

// Sanity check: we are on the dashboard and no longer on the login page.
const pathname = await page.evaluate(() => window.location.pathname);
if (pathname !== '/') {
  console.log('unexpected pathname after login:', pathname);
  throw new Error('login did not redirect to the dashboard');
}

console.log('logged in as', login, '-> reached', baseURL + pathname);

// --- Create a new API token with a unique name -----------------------------
//
// /tokens lists the account's tokens in a table whose first column is the
// token name. "Create a token" opens a Mantine modal: a <form> with a name
// field (placeholder "Your token name") and a submit button that stays
// disabled until the field is filled. On success the page shows a
// confirmation and the new token appears as a row in the list.

const tokenName = 'lp-integration-' + Date.now();

await page.goto(baseURL + '/tokens', {waitUntil: 'networkidle0', timeout: 30000});

// Open the create-token modal. The button has no id, so match it by text.
await page.waitForFunction(() => {
  return Array.from(document.querySelectorAll('button'))
    .some(b => b.textContent.trim() === 'Create a token');
}, {timeout: 10000});
await page.evaluate(() => {
  Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'Create a token').click();
});

// Fill the unique name; the submit button enables once the field is valid.
const nameSel = 'input[placeholder="Your token name"]';
await page.waitForSelector(nameSel, {timeout: 10000});
await page.type(nameSel, tokenName);

const submitSel = 'form button[type="submit"]';
await page.waitForFunction((sel) => {
  const b = document.querySelector(sel);
  return b && !b.disabled;
}, {timeout: 5000}, submitSel);
// Dispatch the click directly: the modal button has no layout box Puppeteer can
// resolve to a clickable point, so page.click() would fail.
await page.evaluate((sel) => document.querySelector(sel).click(), submitSel);

// Wait for the creation confirmation.
await page.waitForFunction(() => {
  return document.body.innerText.includes('successfully been created');
}, {timeout: 30000});

// Reload the list and verify the freshly created token is listed by name.
await page.goto(baseURL + '/tokens', {waitUntil: 'networkidle0', timeout: 30000});
await page.waitForFunction((name) => {
  return Array.from(document.querySelectorAll('td'))
    .some(td => td.textContent.trim() === name);
}, {timeout: 15000}, tokenName).catch(() => {
  throw new Error('created token "' + tokenName + '" was not found in the token list');
});

console.log('token created and listed:', tokenName);

await page.close();
await context.close();
await browser.disconnect();
