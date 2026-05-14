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

import puppeteer from 'puppeteer-core';
import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/magic8ball/';
const browser = await connectBrowser();

const expectedAnswers = [
    'It is certain.',
    'Without a doubt.',
    'Most likely.',
    'Outlook good.',
    'Yes, definitely.',
    'Signs point to yes.',
    'Reply hazy, try again.',
    'Ask again later.',
    'Cannot predict now.',
    "Don't count on it.",
    'My reply is no.',
    'Very doubtful.',
    'Outlook not so good.',
    'Concentrate and ask again.',
    'Absolutely not.',
    'The stars say yes.',
];

// runs
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

for (var run = 0; run<runs; run++) {
    // measure run time.
    const rstart = process.hrtime.bigint();

    await page.goto(url, { waitUntil: 'load' });

    await page.type('#question', 'Will my code work?');
    await page.click('button[type=submit]');

    await page.waitForFunction(() => {
        const a = document.querySelector('#answer').textContent;
        return a !== 'ask me anything' && a !== '...';
    }, { timeout: 5000 });

    const answer = await page.evaluate(() => document.querySelector('#answer').textContent);
    if (!expectedAnswers.includes(answer)) {
        console.log(answer);
        throw new Error("unexpected oracle answer");
    }

    process.stderr.write('.');
    if(run > 0 && run % 80 == 0) process.stderr.write('\n');

    metrics[run] = process.hrtime.bigint() - rstart;
}

await page.close();
await context.close();
await browser.disconnect();

const gduration = process.hrtime.bigint() - gstart;

process.stderr.write('\n');

const avg = metrics.reduce((s, a) => s += a) / BigInt(metrics.length);
const min = metrics.reduce((s, a) => a < s ? a : s);
const max = metrics.reduce((s, a) => a > s ? a : s);

console.log('total runs', runs);
console.log('total duration (ms)', (gduration/1000000n).toString());
console.log('avg run duration (ms)', (avg/1000000n).toString());
console.log('min run duration (ms)', (min/1000000n).toString());
console.log('max run duration (ms)', (max/1000000n).toString());
