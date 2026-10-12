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

// Scroll clamping and wheel latching, recorded from Chrome.
// Re-check with BROWSER_ADDRESS=http://127.0.0.1:9222.
'use strict'

import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/scroll.html';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page.createCDPSession();

await page.goto(url, { waitUntil: 'load', timeout: 10000 });

const failures = [];
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Chrome animates wheel scrolls.
const settle = () => new Promise(r => setTimeout(r, 400));

async function wheel(selector, deltaY) {
    // Aim at the container itself: its children scroll away.
    const at = await page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
    await client.send('Input.dispatchMouseEvent',
        { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY });
    await settle();
}

const state = () => page.evaluate(() => ({
    outer: document.getElementById('outer').scrollTop,
    win: window.scrollY,
}));

const reset = async () => {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.getElementById('outer').scrollTop = 0;
    });
    await settle();
};

// Offsets never pass scrollHeight - clientHeight.
check('inline-sized box clamps', await page.evaluate(() => {
    const b = document.getElementById('box');
    b.scrollTop = 9999;
    b.scrollLeft = 9999;
    return {
        top: b.scrollTop === b.scrollHeight - b.clientHeight,
        left: b.scrollLeft === b.scrollWidth - b.clientWidth,
    };
}), { top: true, left: true });

check('stylesheet-sized box clamps', await page.evaluate(() => {
    const s = document.getElementById('sheet');
    s.scrollTop = 9999;
    return s.scrollTop === s.scrollHeight - s.clientHeight;
}), true);

check('text-only box clamps', await page.evaluate(() => {
    const t = document.getElementById('text');
    t.scrollTop = 9999;
    return t.scrollTop === t.scrollHeight - t.clientHeight && t.scrollTop > 0;
}), true);

check('the viewport clamps', await page.evaluate(() => {
    window.scrollTo(0, 99999);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const clamped = window.scrollY === max;
    window.scrollTo(0, 0);
    return clamped;
}), true);

// A wheel latches to one scroller (cc/input/input_handler.cc, FindNodeToLatch).
await reset();
const extent = await page.evaluate(() => {
    const o = document.getElementById('outer');
    return o.scrollHeight - o.clientHeight;
});
await wheel('#outer', 1000);
check('a saturating wheel does not reach the page', await state(), { outer: extent, win: 0 });

await wheel('#outer', 100);
check('the next wheel chains to the page', await state(), { outer: extent, win: 100 });

await reset();
await page.evaluate(() => { window.scrollTo(0, 300); document.getElementById('outer').scrollTop = 9999; });
await settle();
await wheel('#outer', -500);
check('reversing does not chain the remainder', await state(), { outer: 0, win: 300 });

await reset();
await page.evaluate(() => {
    const o = document.getElementById('outer');
    o.style.overscrollBehavior = 'contain';
    o.scrollTop = 9999;
});
await settle();
await wheel('#outer', 100);
check('overscroll-behavior: contain cuts the chain', await state(), { outer: extent, win: 0 });

await page.close();
await context.close();
await browser.disconnect();

if (failures.length > 0) {
    console.log(failures.join('\n'));
    throw new Error(`${failures.length} scroll expectation(s) failed`);
}
