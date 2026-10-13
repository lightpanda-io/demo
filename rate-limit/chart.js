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

// Plain ASCII charts, so the output survives a copy paste into an issue.

'use strict'

const PAD = 9;

function fmt(v) {
    const a = Math.abs(v);
    if (Number.isInteger(v)) return String(v);
    if (a >= 1000) return String(Math.round(v));
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
}

// series: [{ label, char, points: [[x, y], ...] }]
// opts:   { width, height, xlabel, ylabel, ymax, marker }
// `marker` draws a dotted vertical line at that x, to separate the phases.
export function plot(series, opts = {}) {
    const width = opts.width ?? 74;
    const height = opts.height ?? 16;

    const pts = series.flatMap((s) => s.points);
    if (pts.length === 0) return '  (no data)\n';

    const xmin = opts.xmin ?? Math.min(...pts.map((p) => p[0]));
    let xmax = opts.xmax ?? Math.max(...pts.map((p) => p[0]));
    const ymin = opts.ymin ?? 0;
    let ymax = opts.ymax ?? Math.max(...pts.map((p) => p[1]));
    if (xmax <= xmin) xmax = xmin + 1;
    if (ymax <= ymin) ymax = ymin + 1;

    const col = (x) => Math.round(((x - xmin) / (xmax - xmin)) * (width - 1));
    const row = (y) => height - 1 -
        Math.round(((Math.min(Math.max(y, ymin), ymax) - ymin) / (ymax - ymin)) * (height - 1));

    const grid = Array.from({ length: height }, () => new Array(width).fill(' '));

    if (opts.marker !== undefined) {
        const c = col(opts.marker);
        if (c >= 0 && c < width) {
            for (let r = 0; r < height; r++) grid[r][c] = ':';
        }
    }

    for (const s of series) {
        for (const [x, y] of s.points) {
            const c = col(x);
            const r = row(y);
            if (c >= 0 && c < width && r >= 0 && r < height) grid[r][c] = s.char;
        }
    }

    const out = [];
    if (opts.ylabel) out.push(' '.repeat(PAD + 2) + opts.ylabel);
    for (let r = 0; r < height; r++) {
        // label the top row, the bottom row and every fourth row between
        const show = r === 0 || r === height - 1 || r % 4 === 0;
        const y = ymax - (r / (height - 1)) * (ymax - ymin);
        const label = show ? fmt(y).padStart(PAD) : ' '.repeat(PAD);
        out.push(`${label} |${grid[r].join('')}`);
    }
    out.push(' '.repeat(PAD) + ' +' + '-'.repeat(width));

    // x ticks: 5 evenly spaced labels
    const ticks = 5;
    let axis = '';
    for (let i = 0; i < ticks; i++) {
        const x = xmin + ((xmax - xmin) * i) / (ticks - 1);
        const at = Math.round(((width - 1) * i) / (ticks - 1));
        const text = fmt(x);
        const start = Math.min(Math.max(at - (i === 0 ? 0 : Math.floor(text.length / 2)), 0), width - text.length);
        while (axis.length < start) axis += ' ';
        axis = axis.slice(0, start) + text;
    }
    out.push(' '.repeat(PAD) + '  ' + axis);
    if (opts.xlabel) out.push(' '.repeat(PAD) + '  ' + opts.xlabel);

    const legend = series.filter((s) => s.label).map((s) => `${s.char} ${s.label}`);
    if (legend.length) out.push('\n' + ' '.repeat(PAD + 2) + legend.join('   '));

    return out.join('\n') + '\n';
}

export function table(headers, rows) {
    const all = [headers, ...rows].map((r) => r.map((c) => String(c)));
    const w = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
    const line = (r) => '  ' + r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
    const sep = '  ' + w.map((n) => '-'.repeat(n)).join('  ');
    return [line(all[0]), sep, ...all.slice(1).map(line)].join('\n') + '\n';
}

export function quantile(sorted, q) {
    if (sorted.length === 0) return 0;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
