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

// Measures the per-host navigation rate limiter (--http-nav-delay).
//
// It runs a web server and a puppeteer client in this process, navigates to
// the server as fast as the browser allows, pauses, then does it again. The
// pause is what shows the cooldown: adaptive mode forgets one unit of
// pressure per 200ms of idle time, so the second burst starts fast again.
//
// See README.md.

'use strict'

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { startServer, now } from './server.js';
import { plot, table, quantile } from './chart.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// CDP endpoint. When this script starts the browsers itself, the host and the
// first port come from here and each mode gets the next port.
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:9222';
// navigations per phase, and there are two phases
const RUNS = parseInt(process.env.RUNS ?? '100', 10);
// Idle time between the two phases. Adaptive mode forgives one unit of
// pressure per 200ms, so 15s is enough to fully cool a 100 navigation burst
// and the second phase starts from scratch.
const PAUSE_MS = parseInt(process.env.PAUSE_MS ?? '15000', 10);
// The rate limiter never throttles localhost, 127.0.0.1 or [::1], so the
// browser has to reach the server under another name. On Linux the whole
// 127/8 is local, so 127.0.0.2 works out of the box.
const TARGET_HOST = process.env.TARGET_HOST ?? '127.0.0.2';
const LPD_PATH = process.env.LPD_PATH ?? path.resolve(HERE, 'lightpanda');
// SPAWN=0 runs a single pass against an already running browser at WS_URL.
const SPAWN = (process.env.SPAWN ?? '1') !== '0';
const OUT = process.env.OUT ?? path.join(HERE, 'results.json');

const MODES = [
    { key: 'off', label: 'disabled (--http-nav-delay 0)', args: ['--http-nav-delay', '0'], char: 'o' },
    { key: 'fixed100', label: 'fixed 100ms (--http-nav-delay 100)', args: ['--http-nav-delay', '100'], char: 'f' },
    { key: 'adaptive', label: 'adaptive (default, no flag)', args: [], char: 'a' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseWsUrl(u) {
    const url = new URL(u);
    return { host: url.hostname, port: parseInt(url.port || '9222', 10) };
}

async function waitForPort(host, port, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const ok = await new Promise((resolve) => {
            const s = net.connect({ host, port });
            s.once('connect', () => { s.destroy(); resolve(true); });
            s.once('error', () => { s.destroy(); resolve(false); });
        });
        if (ok) return;
        if (Date.now() > deadline) throw new Error(`browser did not listen on ${host}:${port}`);
        await sleep(50);
    }
}

// Starts `lightpanda serve` with the flags of one mode. Returns the child and
// a counter of the "navigation delayed" warnings it printed.
function startBrowser(mode, host, port) {
    if (!fs.existsSync(LPD_PATH)) {
        throw new Error(`lightpanda binary not found at ${LPD_PATH} (set LPD_PATH)`);
    }
    const args = ['serve', '--host', host, '--port', String(port), ...mode.args];
    const child = spawn(LPD_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    const state = { delayed: 0, stderr: '' };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        state.stderr += chunk;
        for (const line of chunk.split('\n')) {
            if (line.includes('navigation delayed')) state.delayed += 1;
        }
    });
    child.once('exit', (code, signal) => {
        if (!state.stopping && code !== 0) {
            process.stderr.write(`\nlightpanda (${mode.key}) exited: code=${code} signal=${signal}\n${state.stderr}\n`);
        }
    });
    return { child, state, args };
}

async function stopBrowser(b) {
    if (!b) return;
    b.state.stopping = true;
    b.child.kill('SIGTERM');
    await new Promise((resolve) => {
        const t = setTimeout(() => { b.child.kill('SIGKILL'); resolve(); }, 3000);
        b.child.once('exit', () => { clearTimeout(t); resolve(); });
    });
}

// Two bursts of RUNS navigations, separated by PAUSE_MS of idle time.
async function runMode(mode, wsUrl, serverPort) {
    const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Warm up on 127.0.0.1: it is exempt from the rate limiter, so the first
    // load cost is paid without putting pressure on the measured host.
    await page.goto(`http://127.0.0.1:${serverPort}/warmup`);

    const navs = [];
    const t0 = now();

    for (const phase of [1, 2]) {
        for (let i = 0; i < RUNS; i++) {
            const url = `http://${TARGET_HOST}:${serverPort}/page?m=${mode.key}&p=${phase}&i=${i}`;
            const start = now();
            await page.goto(url);
            const end = now();
            navs.push({ phase, i, start: start - t0, end: end - t0, dur: end - start });

            if (i % 20 === 0) process.stderr.write('.');
        }
        if (phase === 1) {
            process.stderr.write(` pause ${PAUSE_MS}ms `);
            await sleep(PAUSE_MS);
        }
    }

    await page.close();
    await context.close();
    await browser.disconnect();

    return { navs, t0 };
}

function summarize(mode, navs, hits, t0, delayed) {
    const phases = [1, 2].map((phase) => {
        const n = navs.filter((x) => x.phase === phase);
        const h = hits.filter((x) => x.mode === mode.key && x.phase === phase);

        // server side: time between two consecutive arrivals
        const gaps = [];
        for (let i = 1; i < h.length; i++) gaps.push(h[i].t - h[i - 1].t);
        const sorted = [...gaps].sort((a, b) => a - b);

        const span = h.length > 1 ? h[h.length - 1].t - h[0].t : 0;
        return {
            phase,
            navigations: n.length,
            requests: h.length,
            span_ms: span,
            rate_per_s: span > 0 ? ((h.length - 1) / span) * 1000 : 0,
            gap_p50: quantile(sorted, 0.5),
            gap_p95: quantile(sorted, 0.95),
            gap_max: sorted.length ? sorted[sorted.length - 1] : 0,
            first_gap: gaps.length ? gaps[0] : 0,
            last_gap: gaps.length ? gaps[gaps.length - 1] : 0,
            client_p50: quantile(n.map((x) => x.dur).sort((a, b) => a - b), 0.5),
            client_max: n.length ? Math.max(...n.map((x) => x.dur)) : 0,
        };
    });
    return { key: mode.key, label: mode.label, char: mode.char, delayed, phases };
}

// ---------------------------------------------------------------------------

(async () => {
    const ws = parseWsUrl(WS_URL);
    const srv = await startServer({ host: '0.0.0.0', port: 0 });

    // Fail early and clearly if the browser could not reach TARGET_HOST.
    try {
        const probe = await fetch(`http://${TARGET_HOST}:${srv.port}/warmup`);
        await probe.text();
    } catch (err) {
        await srv.close();
        console.error(
            `\ncannot reach the test server on ${TARGET_HOST}:${srv.port}: ${err.message}\n\n` +
            `The rate limiter never throttles localhost / 127.0.0.1 / [::1], so the\n` +
            `server must answer on another address. On macOS, add the alias once:\n` +
            `  sudo ifconfig lo0 alias 127.0.0.2 up\n` +
            `or point TARGET_HOST at any name that resolves to this machine.\n`);
        process.exit(1);
    }

    console.log(`server      http://${TARGET_HOST}:${srv.port}/page`);
    console.log(`runs        ${RUNS} navigations x 2 phases, ${PAUSE_MS}ms pause between them`);
    console.log(`browser     ${SPAWN ? LPD_PATH : `external at ${WS_URL}`}`);
    console.log('');

    const modes = SPAWN ? MODES : [{ key: 'external', label: `external browser at ${WS_URL}`, args: [], char: 'x' }];
    const results = [];
    let browserProc = null;

    const cleanup = async () => { await stopBrowser(browserProc); await srv.close(); };
    process.once('SIGINT', async () => { await cleanup(); process.exit(130); });

    try {
        for (const [idx, mode] of modes.entries()) {
            let wsUrl = WS_URL;
            if (SPAWN) {
                const port = ws.port + idx;
                browserProc = startBrowser(mode, ws.host, port);
                await waitForPort(ws.host, port);
                wsUrl = `ws://${ws.host}:${port}`;
            }

            process.stderr.write(`${mode.key.padEnd(10)} `);
            const { navs, t0 } = await runMode(mode, wsUrl, srv.port);
            process.stderr.write(' done\n');

            results.push(summarize(mode, navs, srv.hits, t0, browserProc?.state.delayed ?? 0));
            results[results.length - 1].navs = navs;
            results[results.length - 1].hits = srv.hits
                .filter((h) => h.mode === mode.key)
                .map((h) => ({ ...h, t: h.t - t0 }));

            await stopBrowser(browserProc);
            browserProc = null;
        }
    } finally {
        await stopBrowser(browserProc);
        await srv.close();
    }

    report(results, srv.strays);

    fs.writeFileSync(OUT, JSON.stringify({
        config: { WS_URL, RUNS, PAUSE_MS, TARGET_HOST, LPD_PATH, SPAWN },
        results,
    }, null, 2));
    console.log(`\nraw data: ${OUT}`);
})();

// ---------------------------------------------------------------------------

function report(results, strays) {
    console.log('\n');
    console.log('='.repeat(88));
    console.log('SUMMARY');
    console.log('='.repeat(88));
    console.log('');

    console.log(table(
        ['mode', 'phase', 'reqs', 'span (s)', 'req/s', 'gap p50', 'gap p95', 'gap max', 'client p50'],
        results.flatMap((r) => r.phases.map((p) => [
            p.phase === 1 ? r.key : '',
            p.phase,
            p.requests,
            (p.span_ms / 1000).toFixed(2),
            p.rate_per_s.toFixed(1),
            p.gap_p50.toFixed(1),
            p.gap_p95.toFixed(1),
            p.gap_max.toFixed(1),
            p.client_p50.toFixed(1),
        ]))));

    console.log('  gap = time between two consecutive requests as seen by the server (ms)');
    console.log('  client p50 = median page.goto() duration as seen by puppeteer (ms)');

    // ---- headline chart: progress over time, all modes on one plot --------
    console.log('\n');
    console.log('-'.repeat(88));
    console.log('1. SERVER POV -- requests received over time (all modes)');
    console.log('-'.repeat(88));
    console.log('');
    console.log(plot(
        results.map((r) => ({
            label: r.label,
            char: r.char,
            points: r.hits.map((h, i) => [h.t / 1000, i + 1]),
        })),
        { xlabel: 'elapsed (s)', ylabel: 'requests received', height: 18 },
    ));
    console.log('  The flat part in the middle of each line is the pause. A line that bends');
    console.log('  to the right is slowing down; adaptive bends, then starts steep again');
    console.log('  after the pause because its pressure cooled down.');

    // ---- per mode: server side spacing -----------------------------------
    for (const r of results) {
        console.log('\n');
        console.log('-'.repeat(88));
        console.log(`2. SERVER POV -- spacing between requests: ${r.label}`);
        console.log('-'.repeat(88));
        console.log('');

        // gap of each request against the previous one, by request number.
        // The first request of phase 2 is dropped: its gap is the pause.
        const pts = [];
        for (let i = 1; i < r.hits.length; i++) {
            if (r.hits[i].phase === 2 && r.hits[i].i === 0) continue;
            pts.push([i + 1, r.hits[i].t - r.hits[i - 1].t]);
        }
        console.log(plot([{ char: r.char, points: pts }], {
            xlabel: `request number   (":" = the ${PAUSE_MS}ms pause)`,
            ylabel: 'gap since previous request (ms)',
            marker: RUNS + 0.5,
            height: 14,
        }));

        const p1 = r.phases[0], p2 = r.phases[1];
        console.log(`  end of phase 1: ${p1.last_gap.toFixed(0)}ms spacing`);
        console.log(`  start of phase 2 after ${PAUSE_MS}ms idle: ${p2.first_gap.toFixed(0)}ms spacing`);
        if (r.delayed) console.log(`  browser logged "navigation delayed" ${r.delayed} time(s)`);
    }

    // ---- client point of view --------------------------------------------
    console.log('\n');
    console.log('-'.repeat(88));
    console.log('3. CLIENT POV -- page.goto() duration (all modes)');
    console.log('-'.repeat(88));
    console.log('');
    console.log(plot(
        results.map((r) => ({
            label: r.label,
            char: r.char,
            points: r.navs.map((n, i) => [i + 1, n.dur]),
        })),
        {
            xlabel: `navigation number   (":" = the ${PAUSE_MS}ms pause)`,
            ylabel: 'goto() duration (ms)',
            marker: RUNS + 0.5,
            height: 16,
        },
    ));
    console.log('  The client waits inside page.goto(): the rate limiter holds the request');
    console.log('  before it goes on the wire, so the delay shows up as navigation time.');

    if (strays.length) {
        const paths = [...new Set(strays.map((s) => s.path))];
        console.log(`\n  note: the browser also requested ${strays.length} other resource(s): ${paths.join(', ')}`);
    }
}
