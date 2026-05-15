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
'use strict';

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/webmcp/';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
// Reuse the page's existing CDP session — creating a second one trips up
// Lightpanda's session bookkeeping for navigation events.
const client = page._client();

// === Collect WebMCP events ===

// Tools published by the page, keyed by name. Populated by `toolsAdded`,
// pruned by `toolsRemoved`. An agent would use this catalogue to decide
// what to call.
const tools = new Map();

client.on('WebMCP.toolsAdded', (msg) => {
    for (const t of msg.tools) {
        tools.set(t.name, t);
        console.log(
            `[toolsAdded]  ${t.name}  (frame ${t.frameId})  — ${t.description}, ${JSON.stringify(t.inputSchema)} `,
        );
    }
});

client.on('WebMCP.toolsRemoved', (msg) => {
    for (const t of msg.tools) {
        tools.delete(t.name);
        console.log(`[toolsRemoved] ${t.name}  (frame ${t.frameId})`);
    }
});

// Promises waiting for each in-flight invocation's `toolResponded` event,
// keyed by invocationId. invokeTool() below resolves them.
const pending = new Map();

client.on('WebMCP.toolInvoked', (msg) => {
    console.log(`[toolInvoked]  ${msg.invocationId} ${msg.toolName}(${msg.input})`);
});

client.on('WebMCP.toolResponded', (msg) => {
    console.log(
        `[toolResponded] ${msg.invocationId} ${msg.status}` +
            (msg.output ? `  output=${JSON.stringify(msg.output)}` : '') +
            (msg.errorText ? `  error=${msg.errorText}` : ''),
    );
    const resolver = pending.get(msg.invocationId);
    if (resolver) {
        pending.delete(msg.invocationId);
        resolver(msg);
    }
});

// Helper: invoke a tool by name and wait for its `toolResponded` event.
// Returns the parsed `output` (or throws on Error / Canceled).
async function invokeTool(name, input) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no such tool: ${name}`);

    const { invocationId } = await client.send('WebMCP.invokeTool', {
        frameId: tool.frameId,
        toolName: name,
        input,
    });

    const responded = await new Promise((resolve) => {
        pending.set(invocationId, resolve);
    });

    if (responded.status === 'Error') {
        throw new Error(`tool ${name} errored: ${responded.errorText}`);
    }
    if (responded.status === 'Canceled') {
        throw new Error(`tool ${name} canceled`);
    }
    return responded.output;
}

// === Drive the page ===

console.log('navigating to', url);
await page.goto(url, { waitUntil: 'domcontentloaded' });

console.log('\nenabling WebMCP...');
await client.send('WebMCP.enable');
// `WebMCP.enable` replays a `toolsAdded` for every tool that was already
// registered before we enabled — drain it before we issue the first call.
await new Promise((r) => setTimeout(r, 50));

console.log(`\nagent sees ${tools.size} tools: ${[...tools.keys()].join(', ')}\n`);

await invokeTool('hello', { name: 'foo' });

const initial = await invokeTool('list_notes', {});
assert.deepStrictEqual(initial.notes, [], 'expected an empty list to start');

const created = await invokeTool('add_note', {
    title: 'first note',
    body: 'driven by WebMCP',
});
assert.strictEqual(created.id, 1);

await invokeTool('add_note', { title: 'second note' });
await invokeTool('add_note', { title: 'doomed note', body: 'about to be deleted' });

const afterAdds = await invokeTool('list_notes', {});
assert.strictEqual(afterAdds.notes.length, 3);

const del = await invokeTool('delete_note', { id: 3 });
assert.strictEqual(del.deleted, true);

const missing = await invokeTool('delete_note', { id: 999 });
assert.strictEqual(missing.deleted, false);

const finalList = await invokeTool('list_notes', {});
assert.strictEqual(finalList.notes.length, 2);
assert.strictEqual(finalList.notes[0].title, 'first note');
assert.strictEqual(finalList.notes[1].title, 'second note');

console.log('\nfinal notes:');
for (const n of finalList.notes) {
    console.log(`  #${n.id}  ${n.title}` + (n.body ? `  —  ${n.body}` : ''));
}

console.log('\nall assertions passed.');

await page.close();
await context.close();
await browser.disconnect();
