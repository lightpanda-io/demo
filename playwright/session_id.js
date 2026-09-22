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

// Send browser-level commands (Browser.*, Target.*) through the browser CDP
// session and a page CDP session. Chrome echoes the sessionId in every reply. Playwright routes
// replies by sessionId: a reply without it lands on the root session, which
// throws an "Assertion error" (unknown id) and the page session's send()
// never resolves. Each command is checked for both symptoms.
// Run with DEBUG=pw:protocol to see the raw replies.

import { chromium } from 'playwright-core';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

const timeoutMs = process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 2000;

// The stray reply makes Playwright throw from its message loop: record it
// against the command in flight instead of crashing the process.
let strayReplies = 0;
process.on('uncaughtException', (e) => {
    if (e.message !== 'Assertion error') throw e;
    strayReplies++;
});

const browser = await chromium.connectOverCDP(browserAddress);

const context = await browser.newContext();
const page = await context.newPage();

const session = await context.newCDPSession(page);
// The page targetId is its main frame id.
const targetId = (await session.send('Page.getFrameTree')).frameTree.frame.id;

const cases = [
    // Control: a page-level command, always answered on the session.
    ['Page.getFrameTree', {}],
    ['Browser.getVersion', {}],
    ['Browser.grantPermissions', { permissions: ['geolocation'] }],
    ['Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied' }],
    ['Browser.resetPermissions', {}],
    ['Target.getTargets', {}],
    ['Target.getBrowserContexts', {}],
    ['Target.getTargetInfo', {}],
    ['Target.getTargetInfo', { targetId }],
    // Last: it closes the page.
    ['Target.closeTarget', { targetId }],
];

const failures = [];
async function check(label, session, cases) {
    for (const [method, params] of cases) {
        const name = `${label}: ${method} ${JSON.stringify(params)}`;
        const strayBefore = strayReplies;
        let failed = false;
        let outcome;
        try {
            await Promise.race([
                session.send(method, params),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
            ]);
            outcome = 'reply received';
        } catch (e) {
            // A CDP error reply still reached the session: only a timeout is a failure.
            failed = e.message === 'timeout';
            outcome = failed ? `no reply on the session after ${timeoutMs}ms` : `error reply received (${e.message.split('\n')[0]})`;
        }
        if (strayReplies > strayBefore) {
            // Target.closeTarget: the page closing rejects send() before the timeout.
            failed = true;
            outcome += ', reply without sessionId hit the root session';
        }
        if (failed) failures.push(name);
        console.log(`${failed ? 'FAIL' : 'ok  '} ${name}: ${outcome}`);
    }
}

// The browser session (Target.attachToBrowserTarget) is what
// browser.newBrowserCDPSession() opens. Run it first: the page session
// cases end by closing the page.
const browserSession = await browser.newBrowserCDPSession();
await check('browser session', browserSession, cases.filter(([method]) =>
    !method.startsWith('Page.') && method !== 'Target.closeTarget'));
await check('page session', session, cases);

await context.close().catch(() => {});
await browser.close();

if (failures.length > 0) {
    console.log(`${failures.length} replies not routed to their session: ${failures.join(', ')}`);
    process.exit(1);
}
