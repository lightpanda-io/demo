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

import http from 'node:http';

// Shared clock for the server and the client. Both live in the same node
// process, so the two points of view are directly comparable.
export function now() {
    return Number(process.hrtime.bigint() / 1000n) / 1000;
}

// The page is deliberately empty: no image, no script, no stylesheet. One
// navigation is exactly one HTTP request, so the server-side gap between two
// requests is the spacing the rate limiter applied.
const PAGE = '<!DOCTYPE html><html><head><title>rate limit</title></head>' +
    '<body><h1 id="ok">ok</h1></body></html>';

export function startServer({ host = '0.0.0.0', port = 0 } = {}) {
    // every request that reached the server, in arrival order
    const hits = [];
    // requests we did not ask for (favicon, robots.txt, ...)
    const strays = [];

    const server = http.createServer((req, res) => {
        const t = now();
        const url = new URL(req.url, 'http://placeholder');

        if (url.pathname === '/page') {
            hits.push({
                t,
                mode: url.searchParams.get('m'),
                phase: parseInt(url.searchParams.get('p'), 10),
                i: parseInt(url.searchParams.get('i'), 10),
                host: req.headers.host,
            });
        } else if (url.pathname !== '/warmup') {
            strays.push({ t, path: url.pathname });
        }

        res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            // never let the browser cache serve a navigation: we want every
            // run to reach the network.
            'cache-control': 'no-store, no-cache, must-revalidate',
        });
        res.end(PAGE);
    });

    // A navigation held by the rate limiter keeps its connection idle for up
    // to a second. Don't let node close it underneath us.
    server.keepAliveTimeout = 120_000;
    server.headersTimeout = 125_000;

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            resolve({
                server,
                port: server.address().port,
                hits,
                strays,
                close: () => new Promise((r) => server.close(r)),
            });
        });
    });
}
