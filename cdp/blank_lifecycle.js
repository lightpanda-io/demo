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

// Raw CDP: create an about:blank target, then enable lifecycle events on it.
// Chrome reports the initial about:blank as loaded ("load" lifecycle event).
// chromiumoxide's new_page waits for this event.

// Node 22+ has a built-in WebSocket; older versions use ws (from puppeteer-core).
const WebSocket = globalThis.WebSocket ?? (await import('ws')).default;

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

const timeoutMs = process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 2000;

// Chrome's browser endpoint has a /devtools/browser/<id> path: resolve it.
let wsURL = browserAddress;
if (browserAddress.startsWith('http')) {
    wsURL = (await (await fetch(`${browserAddress}/json/version`)).json()).webSocketDebuggerUrl;
}

const ws = new WebSocket(wsURL);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
    } else if (m.method) {
        events.push(m);
    }
};
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const m = { id: ++nextId, method, params };
    if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, resolve);
    ws.send(JSON.stringify(m));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);

const deadline = Date.now() + timeoutMs;
const isLoad = (e) => e.method === 'Page.lifecycleEvent' && e.sessionId === sessionId && e.params.name === 'load';
while (!events.some(isLoad) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
}
const loaded = events.some(isLoad);

await send('Target.closeTarget', { targetId });
ws.close();

if (!loaded) {
    console.log(`no "load" lifecycle event for the initial about:blank after ${timeoutMs}ms`);
    process.exit(1);
}
console.log('ok: "load" lifecycle event received for the initial about:blank');
