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

// What a touch produces, and which Input.dispatchTouchEvent payloads the
// protocol accepts. Every expectation here was recorded from Chrome; run it
// against Chrome with BROWSER_ADDRESS=http://127.0.0.1:9222 to re-check them.
//
// The taps go through page.tap() rather than raw coordinates on purpose: it
// resolves the element itself, so the assertions are about touch behaviour
// and not about whether the engine lays the fixture out the same way.
'use strict'

import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/touch.html';

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

const readLog = () => page.evaluate(() => window.log);
const reset = () => page.evaluate(() => window.reset());

// Somewhere inside the target, for the raw-protocol checks below. Those assert
// what the protocol accepts, not where the event lands, so a different layout
// does not change the answer.
const at = await page.evaluate(() => {
    const r = document.getElementById('target').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
// Never throws: a rejected command is an outcome to assert on, and letting it
// escape would hide every check after the first divergence.
async function touch(type, touchPoints) {
    try {
        await client.send('Input.dispatchTouchEvent', { type, touchPoints });
        return { accepted: true, error: null };
    } catch (e) {
        return { accepted: false, error: String(e.message || e).split('\n')[0] };
    }
}
const accepted = async (type, points) => (await touch(type, points)).accepted;
// A rejected command can leave a contact open, so start each case from nothing.
const releaseAll = () => touch('touchCancel', []);

// 1. A tap is not only a touch. Chrome pairs each touch event with a Pointer
// Event, then replays the whole thing as compatibility mouse events ending in
// a click, which is what makes tapping a button work on a page that only ever
// bound click.
await releaseAll();
await reset();
await page.tap('#target');
const tap = await readLog();

// enter and leave fire once per ancestor, so they are asserted separately from
// the ordering; everything else fires exactly once.
const boundaryPerAncestor = (t) => t.endsWith('enter') || t.endsWith('leave');
check('tap event sequence', tap.filter(r => !boundaryPerAncestor(r.type)).map(r => r.type), [
    'pointerover', 'pointerdown', 'touchstart',
    'pointerup', 'pointerout', 'touchend',
    'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click',
]);
check('the pointer and the mouse both enter and leave the target',
    ['pointerenter', 'pointerleave', 'mouseenter'].map(t => tap.some(r => r.type === t)),
    [true, true, true]);
check('every event that fires once lands on the target',
    [...new Set(tap.filter(r => !boundaryPerAncestor(r.type)).map(r => r.target))], ['target']);

// 2. The Touch the page sees. page.tap() goes through Puppeteer's touchscreen,
// which sends radiusX, radiusY and force of 0.5 and an id counted up from 1;
// Chrome reports back what the client sent rather than a house default.
const start = tap.find(r => r.type === 'touchstart');
check('touchstart touch lists', start && [start.touches, start.targetTouches, start.changedTouches], [1, 1, 1]);
check('touches and targetTouches are distinct objects', start && start.listsAreDistinct, true);
check('touchstart reports the client-sent contact', start && start.touch, {
    identifier: 1,
    pageMatchesClient: true,
    radiusX: 0.5,
    radiusY: 0.5,
    rotationAngle: 0,
    force: 0.5,
    targetIsElement: true,
});
const end = tap.find(r => r.type === 'touchend');
check('touchend empties touches but keeps changedTouches',
    end && [end.touches, end.targetTouches, end.changedTouches], [0, 0, 1]);

// A point that leaves them out is the other half of the same rule: then Chrome
// does fill in its own synthetic contact, a 1x1 circle at full force.
await reset();
await releaseAll();
await touch('touchStart', [{ x: at.x, y: at.y, id: 2 }]);
const bare = (await readLog()).find(r => r.type === 'touchstart');
check('an unspecified contact defaults to a 1x1 circle at full force',
    bare && [bare.touch.radiusX, bare.touch.radiusY, bare.touch.rotationAngle, bare.touch.force],
    [1, 1, 0, 1]);
await releaseAll();

// 3. touchCancel is the one type Chrome validates the point count on.
await releaseAll();
await reset();
await touch('touchStart', [{ x: at.x, y: at.y, id: 1 }]);
check('touchCancel carrying a point is rejected',
    await accepted('touchCancel', [{ x: at.x, y: at.y, id: 1 }]), false);
await releaseAll();

// 4. touchEnd is not validated the same way: Chrome takes any number of
// points, releases the contact it knows about and ignores the rest. Puppeteer
// depends on the one-point form, since CdpTouchHandle.end() always sends the
// point being released.
await releaseAll();
await reset();
await touch('touchStart', [{ x: at.x, y: at.y, id: 4 }]);
check('touchEnd carrying two points is accepted',
    await accepted('touchEnd', [
        { x: at.x, y: at.y, id: 4 },
        { x: at.x + 10, y: at.y + 10, id: 5 },
    ]), true);

// 5. Chrome reads touchPoints as the set of contacts that are now down, so an
// id it has not seen before opens a second contact whatever the type says.
await releaseAll();
await reset();
await touch('touchStart', [{ x: at.x, y: at.y, id: 7 }]);
check('touchMove with an unknown id is accepted',
    await accepted('touchMove', [{ x: at.x + 10, y: at.y + 10, id: 8 }]), true);
const second = (await readLog()).filter(r => r.type === 'touchstart');
check('an unknown id opens a second contact', second.length, 2);
check('the second contact joins touches', second[1] && second[1].touches, 2);
await releaseAll();

// 6. Ids are not checked for being whole numbers.
await releaseAll();
await reset();
check('a fractional id is accepted',
    await accepted('touchStart', [{ x: at.x, y: at.y, id: 0.5 }]), true);
await releaseAll();

if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`);
    for (const f of failures) console.log(`  ${f}`);
} else {
    console.log('all checks passed');
}

await page.close();
await context.close();
await browser.disconnect();
process.exit(failures.length > 0 ? 1 : 0);
