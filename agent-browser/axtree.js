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

// agent-browser snapshot: every heading must show its level, e.g.
//   - heading "Product Details" [level=3, ref=e8]
// agent-browser reads the "level" AX property with serde_json's as_i64(), so
// it drops the level when the browser sends it as a string
// ({"type":"integer","value":"3"}) instead of a number like Chrome does.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/campfire-commerce/';

// The agent-browser CLI from the demo's npm dependencies.
const bin = createRequire(import.meta.url).resolve('agent-browser/bin/agent-browser.js');

// A dedicated session, so the user's default agent-browser session is left alone.
const session = `lightpanda-heading-level-${process.pid}`;
const ab = (...args) => execFileSync(process.execPath, [bin, '--session', session, '--cdp', browserAddress, ...args], {
    encoding: 'utf8',
    timeout: 60000,
});

let snapshot;
try {
    ab('open', url);
    snapshot = ab('snapshot');
} finally {
    try {
        execFileSync(process.execPath, [bin, '--session', session, 'close'], { timeout: 20000 });
    } catch {
        // the session is already gone
    }
}

const headings = snapshot.split('\n').filter((line) => line.trim().startsWith('- heading '));
if (headings.length === 0) {
    console.log(`no heading in the snapshot of ${url}`);
    process.exit(1);
}

const missing = headings.filter((line) => !/\blevel=\d+/.test(line));
if (missing.length > 0) {
    console.log(`${missing.length}/${headings.length} headings have no level:`);
    for (const line of missing) {
        console.log(line.trim());
    }
    process.exit(1);
}
