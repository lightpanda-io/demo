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

// Box and document sizes behind the scroll clamp, recorded from Chrome.
// Re-check with BROWSER_ADDRESS=http://127.0.0.1:9222.
'use strict'

import { connectBrowser } from './helpers.js';

const base = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/layout/';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();

const failures = [];
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function open(file) {
    const page = await context.newPage();
    await page.goto(base + file, { waitUntil: 'load', timeout: 10000 });
    return page;
}

{
    const page = await open('box.html');
    const q = (id) => `document.getElementById('${id}')`;

    check('a sheet width beats the width attribute',
        await page.evaluate(`${q('img')}.offsetWidth`), 50);

    check('a stronger rule\'s auto leaves nothing to scroll', await page.evaluate(`(() => {
        const b = ${q('panelAuto')};
        b.scrollTop = 9999;
        return { client: b.clientHeight, scroll: b.scrollHeight, top: b.scrollTop };
    })()`), { client: 500, scroll: 500, top: 0 });

    check('a percentage of an auto parent is auto', await page.evaluate(`(() => {
        const b = ${q('inlineAuto')};
        b.scrollTop = 9999;
        return { client: b.clientHeight, top: b.scrollTop };
    })()`), { client: 500, top: 0 });

    check('vh resolves against the viewport',
        await page.evaluate(`${q('tenth')}.clientHeight === Math.round(innerHeight / 10)`), true);

    // Line heights depend on the font; assert only the shape.
    check('text wraps at an explicit width', await page.evaluate(`(() => {
        const w = ${q('textW')}, line = ${q('textFree')}.clientHeight;
        return { width: w.clientWidth, severalLines: w.clientHeight > 2 * line };
    })()`), { width: 200, severalLines: true });

    check('text in an auto-width box is a line tall',
        await page.evaluate(`${q('textFree')}.clientHeight > 10`), true);

    await page.close();
}

{
    const page = await open('short.html');

    check('a short document', await page.evaluate(() => {
        const html = document.documentElement, body = document.body;
        return {
            htmlScroll: html.scrollHeight === innerHeight,
            htmlClient: html.clientHeight === innerHeight,
            htmlOffset: html.offsetHeight,
            body: [body.scrollHeight, body.clientHeight, body.offsetHeight],
        };
    }), { htmlScroll: true, htmlClient: true, htmlOffset: 100, body: [100, 100, 100] });

    check('a short document does not scroll', await page.evaluate(() => {
        scrollTo(500, 500);
        return { x: scrollX, y: scrollY };
    }), { x: 0, y: 0 });

    await page.close();
}

{
    const page = await open('tall.html');

    check('a tall document measures its content', await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        body: document.body.offsetHeight,
    })), { height: 3000, width: 3000, body: 3000 });

    check('the viewport clamps on both axes', await page.evaluate(() => {
        const html = document.documentElement;
        scrollTo(1e6, 1e6);
        return {
            x: scrollX === html.scrollWidth - html.clientWidth,
            y: scrollY === html.scrollHeight - html.clientHeight,
        };
    }), { x: true, y: true });

    await page.close();
}

{
    const page = await open('full.html');

    check('a full-height body', await page.evaluate(() => ({
        body: document.body.clientHeight === innerHeight,
        bodyOffset: document.body.offsetHeight === innerHeight,
        bodyScroll: document.body.scrollHeight,
        htmlScroll: document.documentElement.scrollHeight,
    })), { body: true, bodyOffset: true, bodyScroll: 3000, htmlScroll: 3000 });

    await page.close();
}

await context.close();
await browser.disconnect();

if (failures.length > 0) {
    console.log(failures.join('\n'));
    throw new Error(`${failures.length} layout expectation(s) failed`);
}
