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

import assert from 'assert';
import { connectBrowser } from './helpers.js'

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.goto(baseURL + '/ax_aria_states.html', {waitUntil: 'load'});

const client = page._client();
const { nodes } = await client.send('Accessibility.getFullAXTree', {});

const prop = (node, name) => node.properties?.find(p => p.name === name)?.value?.value;
const states = {};
for (const node of nodes) {
  const name = node.name?.value;
  if (!name || node.role?.value === 'StaticText' || node.role?.value === 'InlineTextBox') continue;
  const state = {};
  const checked = prop(node, 'checked');
  const expanded = prop(node, 'expanded');
  if (checked !== undefined) state.checked = checked;
  if (expanded !== undefined) state.expanded = expanded;
  states[name] = state;
}

// Chrome 156 Accessibility.getFullAXTree. Any token other than "false"
// reads as true, and an empty aria-checked as false.
const expected = {
  'Expanded details': {expanded: true},
  'Collapsed details': {expanded: false},
  'Uppercase expanded': {expanded: true},
  'Invalid expanded': {expanded: true},
  'Spaced expanded': {expanded: true},
  'Empty expanded': {},
  'Generic expanded': {},
  'Custom anchor': {expanded: true},
  'Listitem expanded': {expanded: true},
  'Checkbox mixed': {checked: 'mixed'},
  'Uppercase mixed': {checked: 'mixed'},
  'Absent checked': {checked: 'false'},
  'Invalid checked': {checked: 'true'},
  'Empty checked': {checked: 'false'},
  'Spaced checked': {checked: 'true'},
  'Switch mixed': {checked: 'false'},
  'Radio absent': {checked: 'false'},
  'Menu checkbox mixed': {checked: 'mixed'},
  'Option checked': {checked: 'true'},
  'Option mixed': {checked: 'mixed'},
  'Treeitem checked': {checked: 'true', expanded: false},
  'Native checked': {checked: 'true'},
};

const actual = Object.fromEntries(Object.keys(expected).map(name => [name, states[name]]));
assert.deepStrictEqual(actual, expected);

await page.close();
await context.close();
await browser.disconnect();
