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

// Listen for new tools
page.webmcp.on('toolsadded', event => {
  for (const tool of event.tools) {
    console.log(`New tool added: ${tool.name}`);
  }
});

// Listen for removed tools
page.webmcp.on('toolsremoved', event => {
  for (const tool of event.tools) {
    console.log(`Tool removed: ${tool.name}`);
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });

const tools = page.webmcp.tools();
for (const tool of tools) {
  console.log(`Tool found: ${tool.name} - ${tool.description}`);
}

let res;

const hello = tools.find(t => t.name === 'hello');
res = await hello.execute({name: 'foo'});
assert.equal("Completed", res.status);

const list_notes = tools.find(t => t.name === 'list_notes');
res = await list_notes.execute();
assert.equal("Completed", res.status);
assert.deepStrictEqual(res.output.notes, [], 'expected an empty list to start');

const add_note = tools.find(t => t.name === 'add_note');
res = await add_note.execute({
    title: 'first note',
    body: 'driven by WebMCP',
});
assert.equal("Completed", res.status);
assert.strictEqual(res.output.id, 1);

res = await list_notes.execute();
assert.equal("Completed", res.status);
assert.strictEqual(res.output.notes.length, 1);

await page.close();
await context.close();
await browser.disconnect();
