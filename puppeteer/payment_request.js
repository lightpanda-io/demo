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

// Expectations recorded from headless Chrome; re-check with
// BROWSER_ADDRESS=http://127.0.0.1:9222.
'use strict'

import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/payment_request.html';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url, { waitUntil: 'load', timeout: 10000 });
await page.evaluate(() => window.checkoutReady);

const failures = [];
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check('feature detection', await page.evaluate(() => window.log), ['payment-request', 'canMakePayment:false']);
check('express button stays hidden', await page.$eval('#express', (e) => e.classList.contains('hidden')), true);

await page.click('#pay');
await page.waitForSelector('#card-form:not(.hidden)', { timeout: 5000 });
check('show() falls back to the card form', await page.evaluate(() => window.log.slice(2)), ['show:NotSupportedError', 'card-form']);

const errors = await page.evaluate(() => {
    const methods = [{ supportedMethods: 'https://example.com/pay' }];
    const total = (value, currency = 'USD') => ({ total: { label: 'Total', amount: { currency, value } } });
    const attempt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.name; } };
    return {
        noMethods: attempt(() => new PaymentRequest([], total('1'))),
        badCurrency: attempt(() => new PaymentRequest(methods, total('1', 'US'))),
        badAmount: attempt(() => new PaymentRequest(methods, total('1,00'))),
        negativeTotal: attempt(() => new PaymentRequest(methods, total('-1'))),
        badMethod: attempt(() => new PaymentRequest([{ supportedMethods: 'Not A Method' }], total('1'))),
        localhostMethod: attempt(() => new PaymentRequest([{ supportedMethods: 'http://localhost/pay' }], total('1'))),
    };
});
check('constructor validation', errors, {
    noMethods: 'TypeError',
    badCurrency: 'RangeError',
    badAmount: 'TypeError',
    negativeTotal: 'TypeError',
    badMethod: 'RangeError',
    localhostMethod: 'ok',
});

const reuse = await page.evaluate(async () => {
    if (!('PaymentRequest' in window)) {
        return null;
    }
    const r = new PaymentRequest([{ supportedMethods: 'https://example.com/pay' }],
        { total: { label: 'Total', amount: { currency: 'USD', value: '1' } } });
    const name = (p) => p.then(() => 'ok', (e) => e.name);
    return {
        enrolled: await r.hasEnrolledInstrument(),
        abortBeforeShow: await name(r.abort()),
        secondShowAfterFailure: await name(r.show().catch(() => {}).then(() => r.show())),
        canMakePaymentAfterShow: await name(r.canMakePayment()),
    };
});
check('request lifecycle', reuse, {
    enrolled: false,
    abortBeforeShow: 'InvalidStateError',
    secondShowAfterFailure: 'InvalidStateError',
    canMakePaymentAfterShow: 'InvalidStateError',
});

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
