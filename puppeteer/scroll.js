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

// Scroll offsets clamp to the scrollable extent, and a wheel latches to a
// single scroll container. Every expectation here was recorded from Chrome
// (see the assertions' notes); run it against Chrome with
// BROWSER_ADDRESS=http://127.0.0.1:9222 to re-check them.
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

// Chrome animates a wheel scroll; let it finish before reading offsets back.
const settle = () => new Promise(r => setTimeout(r, 400));

async function wheel(selector, deltaY) {
    // Aim at the middle of the container's own box: a child scrolls out of it,
    // and then the wheel would land on whatever took its place.
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

// A scroll offset never passes scrollHeight - clientHeight. The limit itself is
// whatever the box measures, so assert it relationally.
check('inline-sized box clamps', await page.evaluate(() => {
    const b = document.getElementById('box');
    b.scrollTop = 9999;
    b.scrollLeft = 9999;
    return {
        top: b.scrollTop === b.scrollHeight - b.clientHeight,
        left: b.scrollLeft === b.scrollWidth - b.clientWidth,
    };
}), { top: true, left: true });

// Same shape, sized by a stylesheet rule rather than an inline style.
check('stylesheet-sized box clamps', await page.evaluate(() => {
    const s = document.getElementById('sheet');
    s.scrollTop = 9999;
    return s.scrollTop === s.scrollHeight - s.clientHeight;
}), true);

// An explicit box whose content is text, with no element child to measure.
check('text-only box clamps', await page.evaluate(() => {
    const t = document.getElementById('text');
    t.scrollTop = 9999;
    return t.scrollTop === t.scrollHeight - t.clientHeight && t.scrollTop > 0;
}), true);

// The viewport clamps the same way, against the document's own extent.
check('the viewport clamps', await page.evaluate(() => {
    window.scrollTo(0, 99999);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const clamped = window.scrollY === max;
    window.scrollTo(0, 0);
    return clamped;
}), true);

// A wheel latches to one scroller: the container keeps the delta it can't use
// instead of passing the rest to the page (cc/input/input_handler.cc,
// FindNodeToLatch).
await reset();
const extent = await page.evaluate(() => {
    const o = document.getElementById('outer');
    return o.scrollHeight - o.clientHeight;
});
await wheel('#outer', 1000);
check('a saturating wheel does not reach the page', await state(), { outer: extent, win: 0 });

// Once it can no longer move, the next wheel latches to the page instead.
await wheel('#outer', 100);
check('the next wheel chains to the page', await state(), { outer: extent, win: 100 });

// Reversing direction latches back to the container. What it can't give back
// stays unscrolled — no split here either.
await reset();
await page.evaluate(() => { window.scrollTo(0, 300); document.getElementById('outer').scrollTop = 9999; });
await settle();
await wheel('#outer', -500);
check('reversing does not chain the remainder', await state(), { outer: 0, win: 300 });

// overscroll-behavior keeps the latch on a container that can't move.
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
