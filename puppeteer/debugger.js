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

// Drive the CDP Debugger domain through a raw CDP session.
// Debugger.enable must return a debuggerId, report the page scripts with
// Debugger.scriptParsed and serve their source with Debugger.getScriptSource.
// Lightpanda doesn't support pausing: the commands that set up or drive a
// pause (breakpoints, Debugger.pause, stepping...) answer a CDP error, and a
// `debugger;` statement doesn't stop the page script.
// Lightpanda specific: on Chrome the breakpoint and pause commands succeed.

import assert from 'assert';
import { connectBrowser } from './helpers.js'

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';
const pageURL = baseURL + '/debugger/index.html';
const scriptURL = baseURL + '/debugger/app.js';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

try {
    const session = await page.createCDPSession();

    const scripts = [];
    session.on('Debugger.scriptParsed', (evt) => scripts.push(evt));

    const { debuggerId } = await session.send('Debugger.enable');
    assert.ok(typeof debuggerId === 'string' && debuggerId.length > 0, 'Debugger.enable must return a debuggerId');

    // Pausing is not supported: the commands answer a CDP error.
    await assert.rejects(
        session.send('Debugger.setBreakpointByUrl', { url: scriptURL, lineNumber: 3 }),
        /Debugger pausing is not supported/,
    );
    await assert.rejects(session.send('Debugger.pause'), /Debugger pausing is not supported/);

    await page.goto(pageURL, { waitUntil: 'load', timeout: 5000 });

    const result = await page.$eval('#result', (el) => el.textContent);
    assert.equal(result, 'done:42', 'the script must run through the debugger statement');

    const app = scripts.find((s) => s.url === scriptURL);
    assert.ok(app, `no Debugger.scriptParsed for ${scriptURL}, got: ${scripts.map((s) => s.url)}`);

    const { scriptSource } = await session.send('Debugger.getScriptSource', { scriptId: app.scriptId });
    assert.ok(scriptSource.includes('lightpanda-debugger-fixture'), 'Debugger.getScriptSource returned the wrong source');

    await session.send('Debugger.disable');
} finally {
    await page.close();
    await context.close();
    await browser.disconnect();
}
