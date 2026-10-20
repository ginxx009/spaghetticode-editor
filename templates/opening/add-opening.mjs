#!/usr/bin/env node
// Put the spaghettiCode opening (logo animation + title) in front of a HyperFrames project.
//
//   node templates/opening/add-opening.mjs <project-dir> --title "[Invisible] ang vibe-coded website mo?" --kicker "{Ayusin natin.}"
//
// Title markup: [word] = pink, {word} = cyan, a lone | forces a line break. Brackets may span words.
// Everything already in the project moves later by `offset` seconds (media, captions, overlays, GSAP
// timeline, outro). Safe to re-run: the previous opening and its shift are undone first.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const logoDir = join(here, '../outro/assets');
const { values: opt, positionals: [projArg] } = parseArgs({
  allowPositionals: true,
  options: { title: { type: 'string' }, kicker: { type: 'string' } },
});
if (!projArg) { console.error('Usage: node templates/opening/add-opening.mjs <project-dir> [--title "..."] [--kicker "..."]'); process.exit(1); }
const proj = resolve(projArg);
const cfg = JSON.parse(readFileSync(join(here, 'opening.config.json'), 'utf8'));
const title = opt.title ?? cfg.title;
const kicker = opt.kicker ?? cfg.kicker;
const T = cfg.timing;
const layout = JSON.parse(readFileSync(join(logoDir, 'layout.json'), 'utf8'));

const indexPath = join(proj, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const rootRe = /<div\b[^>]*\bdata-composition-id="[^"]+"[^>]*>/;
let rootTag = html.match(rootRe)?.[0];
if (!rootTag) { console.error('No root composition found in index.html'); process.exit(3); }
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const rootId = attr(rootTag, 'data-composition-id');
const W = Number(attr(rootTag, 'data-width')), H = Number(attr(rootTag, 'data-height'));
const r3 = (n) => +n.toFixed(3);

// ---- undo a previous opening ----
const BLOCK_RE = /\n?<!-- spaghetticode-opening:start -->[\s\S]*?<!-- spaghetticode-opening:end -->/;
const SHIFT_RE = /\n?\s*\w+\.shiftChildren\([^)]*\);\s*\/\*sc-opening-shift\*\//;
const shiftAll = (src, by) => {
  const tag = src.match(rootRe)[0];
  const head = src.slice(0, src.indexOf(tag) + tag.length);
  const body = src.slice(head.length).replace(/(<(?:div|video|audio|img)\b[^>]*?\bdata-start=")(-?\d+(?:\.\d+)?)(")/g,
    (m, a, v, b) => `${a}${r3(Number(v) + by)}${b}`);
  let newTag = tag.replace(/\bdata-duration="([^"]*)"/, (m, v) => `data-duration="${r3(Number(v) + by)}"`);
  newTag = newTag.replace(/\bdata-outro-base="([^"]*)"/, (m, v) => `data-outro-base="${r3(Number(v) + by)}"`);
  return head.replace(tag, newTag) + body;
};
const prevOffset = Number(attr(rootTag, 'data-opening-offset') ?? 0);
html = html.replace(BLOCK_RE, '').replace(SHIFT_RE, '');
if (prevOffset) html = shiftAll(html, -prevOffset);

// ---- apply the new shift ----
const OFF = cfg.offset;
html = shiftAll(html, OFF);
rootTag = html.match(rootRe)[0];
const tagged = /\bdata-opening-offset=/.test(rootTag)
  ? rootTag.replace(/\bdata-opening-offset="[^"]*"/, `data-opening-offset="${OFF}"`)
  : rootTag.replace(/>$/, ` data-opening-offset="${OFF}">`);
html = html.replace(rootTag, tagged);
const regRe = new RegExp(`(\\n?\\s*)window\\.__timelines\\[\\s*["']${rootId}["']\\s*\\]\\s*=\\s*(\\w+)\\s*;`);
const reg = html.match(regRe);
if (!reg) { console.error(`Could not find window.__timelines["${rootId}"] registration.`); process.exit(4); }
html = html.replace(regRe, `${reg[1]}${reg[2]}.shiftChildren(${OFF}, true); /*sc-opening-shift*/${reg[0]}`);

// ---- layout ----
const u = Math.min(W, H) / 1080;
const vertical = H >= W;
const logoH = H * (vertical ? 0.17 : 0.17), S = logoH / layout.box.h, logoW = layout.box.w * S;
const brandTop = H * 0.17;
const brandH = logoH + 16 * u + 46 * u;
const textTop = brandTop + brandH + 70 * u;
const brandDY = H / 2 - (brandTop + brandH / 2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parts = ['brace-left', 'fork', 'brace-right'].map((n) => {
  const p = layout.parts[n];
  return `<div class="scp-part p-${n}" style="left:${(p.x * S).toFixed(1)}px;top:${(p.y * S).toFixed(1)}px;width:${(p.w * S).toFixed(1)}px;height:${(p.h * S).toFixed(1)}px"><img class="scp-halo" src="assets/opening/${n}.png" alt=""><img src="assets/opening/${n}.png" alt=""></div>`;
}).join('');
const wordmark = [...'spaghetti'].map((c) => `<span class="p">${c}</span>`).join('') + [...'Code'].map((c) => `<span class="c">${c}</span>`).join('');
const markup = (text, wordClass) => {
  let mode = '';
  const out = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (raw === '|') { out.push('<span class="br"></span>'); continue; }
    let w = raw;
    if (w.startsWith('[')) { mode = 'pk'; w = w.slice(1); }
    if (w.startsWith('{')) { mode = 'cy'; w = w.slice(1); }
    let close = false;
    if (/[\]}]$/.test(w) || /[\]}][?!.,]+$/.test(w)) { close = true; w = w.replace(/[\]}](?=[?!.,]*$)/, ''); }
    const cls = [wordClass, mode].filter(Boolean).join(' ');
    out.push(cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w));
    if (close) mode = '';
  }
  return out.join(wordClass ? '' : ' ');
};
const titleHtml = markup(title, 'w');
const kickerHtml = kicker ? markup(kicker, '') : '';
const nWords = title.trim().split(/\s+/).filter((w) => w !== '|').length;
const titleMax = Math.min(W - 140 * u, vertical ? 940 * u : 1500 * u);
const longest = Math.max(...title.replace(/[[\]{}|]/g, ' ').trim().split(/\s+/).map((w) => w.length));
const titleSize = Math.min(vertical ? 96 : 84, Math.floor(titleMax / u / (longest * 0.72)));

let comp = readFileSync(join(here, 'sc-opening.html'), 'utf8');
const fill = {
  DUR: cfg.duration, W, H, U: u.toFixed(4), PARTS: parts, WORDMARK: wordmark, TITLE: titleHtml, KICKER: kickerHtml,
  BRAND_TOP: brandTop.toFixed(1), TEXT_TOP: textTop.toFixed(1), LOGO_W: logoW.toFixed(1), LOGO_H: logoH.toFixed(1),
  BRAND_DY: brandDY.toFixed(1), TITLE_MAX: titleMax.toFixed(0), TITLE_SIZE: titleSize, TIMING: JSON.stringify(T),
};
comp = comp.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? String(fill[k]) : m));
const left = comp.match(/\{\{\w+\}\}/);
if (left) { console.error(`Unfilled placeholder ${left[0]}`); process.exit(5); }

mkdirSync(join(proj, 'compositions'), { recursive: true });
mkdirSync(join(proj, 'assets/opening'), { recursive: true });
writeFileSync(join(proj, 'compositions/sc-opening.html'), comp);
for (const f of ['brace-left.png', 'fork.png', 'brace-right.png']) copyFileSync(join(logoDir, f), join(proj, 'assets/opening', f));

// ---- sound: synthesized cues on the same timing ----
const SR = 48000;
let seed = 0x5c0de;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
const gen = (d, f) => Float32Array.from({ length: Math.round(d * SR) }, (_, i) => f(i / SR));
const lowpass = (x, a) => { let acc = 0; return x.map((v) => (acc += a * (v - acc))); };
const band = (d, lo, hi) => { const n = gen(d, rand); const a = lowpass(n, hi), b = lowpass(n, lo); return a.map((v, i) => v - b[i]); };
const whoosh = (d) => band(d, 0.01, 0.12).map((v, i) => v * Math.sin(Math.PI * i / SR / d) ** 2);
const pop = (f) => gen(0.14, (t) => Math.sin(2 * Math.PI * f * t * (1 + 1.6 * t)) * Math.exp(-t * 32) * Math.min(1, t / 0.002));
const click = (f) => gen(0.05, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 150) * Math.min(1, t / 0.0005));
const thump = () => gen(0.35, (t) => Math.sin(2 * Math.PI * (90 - 45 * t) * t) * Math.exp(-t * 11) * Math.min(1, t / 0.001));
const buzz = () => gen(0.26, (t) => { const s = 2 * ((t * 120) % 1) - 1; const g = (t > 0.05 && t < 0.09) || (t > 0.13 && t < 0.16) ? 0.15 : 1; return s * g * Math.exp(-t * 5); });
const sparkle = () => { const out = new Float32Array(Math.round(0.8 * SR)); [2093, 2637, 3136, 4186].forEach((f, k) => { const o = Math.round(k * 0.06 * SR); for (let i = 0; i < 0.35 * SR && o + i < out.length; i++) { const t = i / SR; out[o + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 0.5; } }); return out; };
const cues = [
  [T.braces, whoosh(0.45), 0.45], [T.flicker, lowpass(buzz(), 0.08), 0.2], [T.fork - 0.05, whoosh(0.3), 0.22],
  [T.forkLand, pop(620), 0.5], [T.rise, whoosh(0.4), 0.22],
  ...Array.from({ length: nWords }, (_, i) => [T.title + i * T.wordStep + 0.04, click([2200, 1900, 2500][i % 3]), 0.28]),
  [T.kicker + 0.04, thump(), 0.6], [T.kicker + 0.06, sparkle(), 0.25],
];
const mix = new Float32Array(Math.round(cfg.duration * SR));
for (const [t0, s, g] of cues) {
  const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6), o = Math.round(t0 * SR);
  for (let i = 0; i < s.length && o + i < mix.length; i++) mix[o + i] += (s[i] / peak) * g;
}
const fadeN = Math.round((cfg.duration - T.fadeOut) * SR);
for (let i = 0; i < fadeN; i++) mix[mix.length - fadeN + i] *= 1 - i / fadeN;
const peak = mix.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6), gain = 10 ** (-6 / 20) / peak;
const wav = Buffer.alloc(44 + mix.length * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + mix.length * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(mix.length * 4, 40);
mix.forEach((v, i) => { const s = Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767))); wav.writeInt16LE(s, 44 + i * 4); wav.writeInt16LE(s, 46 + i * 4); });
writeFileSync(join(proj, 'assets/opening/opening-sfx.wav'), wav);

// ---- mount ----
rootTag = html.match(rootRe)[0];
const block = `
<!-- spaghetticode-opening:start -->
<style>.sc-opening-layer{position:absolute;inset:0;z-index:1001}</style>
<div id="sc-opening-mount" class="sc-opening-layer" data-composition-id="sc-opening" data-composition-src="compositions/sc-opening.html" data-start="0" data-duration="${cfg.duration}" data-track-index="902" data-width="${W}" data-height="${H}"></div>
<audio id="sc-opening-sfx" data-start="0" data-duration="${cfg.duration}" data-track-index="903" src="assets/opening/opening-sfx.wav" data-volume="1"></audio>
<!-- spaghetticode-opening:end -->`;
html = html.replace(rootTag, rootTag + block);
writeFileSync(indexPath, html);
console.log(`Opening added to ${proj}: "${title}" / "${kicker}". Edit shifted ${OFF}s; total ${attr(html.match(rootRe)[0], 'data-duration')}s.`);
