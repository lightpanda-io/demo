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

// End-to-end test for Browser.setDownloadBehavior file downloads
// (lightpanda issue #2701), driven through Playwright's high-level download
// API. Unlike the puppeteer test (which speaks raw CDP), Playwright handles the
// opt-in (Browser.setDownloadBehavior) and the lifecycle for us: we just open a
// page, click an `<a href>` that returns a Content-Disposition: attachment
// response, and wait for the 'download' event. We then assert that:
//   - the suggested filename matches the Content-Disposition header,
//   - download.failure() is null (the download completed, not canceled),
//   - the saved bytes match the served image byte-for-byte.

import { chromium } from 'playwright-core';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// Fetch the expected bytes directly: a plain HTTP GET ignores Content-
// Disposition and just returns the body, so we can compare the download
// byte-for-byte without hard-coding the image.
const expected = Buffer.from(await (await fetch(baseURL + '/download/image')).arrayBuffer());
assert.ok(expected.length > 0, 'served image should not be empty');

const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpd-download-pw-'));

// Connect to an existing browser
console.log("Connection to browser on " + browserAddress);
const browser = await chromium.connectOverCDP(browserAddress);

// acceptDownloads is on by default in recent Playwright, but be explicit:
// it tells Playwright to opt in via Browser.setDownloadBehavior and to keep
// the downloaded file so download.path()/saveAs() can reach it.
const context = await browser.newContext({
    baseURL: baseURL,
    acceptDownloads: true,
});

const page = await context.newPage();

try {
    // Load the page first, then click the link. Playwright recognizes the
    // attachment response and resolves the 'download' event instead of
    // navigating. waitForEvent must be armed before the click that triggers it.
    await page.goto('/index.html');

    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        page.click('#download-link'),
    ]);

    // suggestedFilename comes from the Content-Disposition header.
    assert.equal(download.suggestedFilename(), 'lightpanda.png');
    assert.ok(download.url().endsWith('/download/image'), `unexpected url: ${download.url()}`);

    // failure() resolves once the download finishes: null on success, or an
    // error string (e.g. "canceled"). This is the assertion that catches a
    // download that started but never completed.
    const failure = await download.failure();
    assert.equal(failure, null, `download failed: ${failure}`);

    // saveAs() waits for completion, then copies the file out. Compare the
    // saved bytes against the served image.
    const onDisk = path.join(downloadDir, 'lightpanda.png');
    await download.saveAs(onDisk);
    const got = fs.readFileSync(onDisk);
    assert.ok(got.equals(expected), 'downloaded bytes differ from the served image');

    console.log(`downloaded ${got.length} bytes to ${onDisk}`);
} finally {
    await page.close();
    await context.close();
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
}
