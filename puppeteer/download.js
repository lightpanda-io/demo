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

// End-to-end test for Browser.setDownloadBehavior file downloads
// (lightpanda issue #2701). It opts in with `behavior: 'allow'`, navigates to a
// `Content-Disposition: attachment` response, and asserts that:
//   - Browser.downloadWillBegin and Browser.downloadProgress (completed) fire,
//   - the file lands on disk under downloadPath with the suggested name,
//   - the on-disk bytes match the served image byte-for-byte.

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectBrowser } from './helpers.js'

const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';
const downloadURL = baseURL + '/download/image';

// Fetch the expected bytes directly: a plain HTTP GET ignores Content-
// Disposition and just returns the body, so we can compare the on-disk download
// byte-for-byte without hard-coding the image.
const expected = Buffer.from(await (await fetch(downloadURL)).arrayBuffer());
assert.ok(expected.length > 0, 'served image should not be empty');

// Lightpanda writes the file via std.fs.cwd().makePath, so downloadPath must be
// absolute (its CWD is not this test's CWD). mkdtemp returns an absolute path,
// and the browser shares this filesystem (both run on 127.0.0.1).
const downloadPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lpd-download-'));

function withTimeout(promise, ms, msg) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${msg}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

// Browser.* are browser-scoped events: like Chrome, Lightpanda emits them with
// no sessionId, so puppeteer surfaces them on the root CDP connection, not on
// the page session (client). Its Connection routes a message bearing a
// sessionId to that session and a sessionless one to the connection itself, so
// the listeners below must sit on client.connection() — listening on `client`
// would never fire.
const connection = client.connection();

try {
  // Register the listeners before navigating so we never miss an event.
  // The opt-in is Browser.setDownloadBehavior, so Lightpanda emits Browser.*
  // events (not the deprecated Page.downloadWillBegin / Page.downloadProgress).
  let onWillBegin, onCompleted;
  const willBegin = new Promise(res => { onWillBegin = res; });
  const completed = new Promise(res => { onCompleted = res; });

  connection.on('Browser.downloadWillBegin', e => onWillBegin(e));
  connection.on('Browser.downloadProgress', e => {
    if (e.state === 'completed') onCompleted(e);
  });

  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });

  // Navigate at the CDP level (Page.navigate) instead of page.goto(): we drive
  // the page's primary session directly, so the high-level page API is not
  // reused afterward. Navigating to an attachment streams the body to disk
  // instead of rendering a page; the download events below are what we assert.
  await client.send('Page.navigate', { url: downloadURL });

  const begin = await withTimeout(willBegin, 5000, 'Browser.downloadWillBegin');
  const progress = await withTimeout(completed, 5000, 'Browser.downloadProgress (completed)');

  // Browser.downloadWillBegin
  assert.ok(begin.guid, 'downloadWillBegin.guid should be set');
  assert.equal(begin.suggestedFilename, 'lightpanda.png');
  assert.ok(begin.url.endsWith('/download/image'), `unexpected url: ${begin.url}`);

  // Browser.downloadProgress (completed)
  assert.equal(progress.guid, begin.guid, 'progress/willBegin guid mismatch');
  assert.equal(progress.state, 'completed');
  assert.equal(progress.totalBytes, expected.length);
  assert.equal(progress.receivedBytes, expected.length);

  // The file landed on disk under downloadPath with the suggested name.
  const onDisk = path.join(downloadPath, 'lightpanda.png');
  assert.ok(fs.existsSync(onDisk), `file not found: ${onDisk}`);
  const got = fs.readFileSync(onDisk);
  assert.ok(got.equals(expected), 'downloaded bytes differ from the served image');

  console.log(`downloaded ${got.length} bytes to ${onDisk} (guid ${begin.guid})`);
} finally {
  // We drove the page's primary CDP session directly, so don't reuse the
  // high-level page API; closing the context tears the page down.
  await page.close();
  await context.close().catch(() => {});
  await browser.disconnect();
  fs.rmSync(downloadPath, { recursive: true, force: true });
}
