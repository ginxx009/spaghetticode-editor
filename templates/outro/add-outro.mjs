#!/usr/bin/env node
// Append the spaghettiCode outro (animated logo + like/follow) to a HyperFrames project.
//
//   node templates/outro/add-outro.mjs <project-dir> [--cta "text"] [--handle "@name"]
//
// Safe to re-run: the previous outro block is replaced, and the original length is kept in
// data-outro-base on the root composition. Re-run it every time index.html is regenerated.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values: opt, positionals: [projArg] } = parseArgs({
  allowPositionals: true,
  options: { cta: { type: 'string' }, handle: { type: 'string' } },
});
if (!projArg) { console.error('Usage: node templates/outro/add-outro.mjs <project-dir> [--cta "..."] [--handle "@..."]'); process.exit(1); }
const proj = resolve(projArg);
const cfg = JSON.parse(readFileSync(join(here, 'outro.config.json'), 'utf8'));
const cta = opt.cta ?? cfg.cta;
const handle = opt.handle ?? cfg.handle;
const layout = JSON.parse(readFileSync(join(here, 'assets/layout.json'), 'utf8'));
const files = ['brace-left.png', 'fork.png', 'brace-right.png', 'logo.png', 'outro-sfx.wav'];
for (const f of files) if (!existsSync(join(here, 'assets', f))) { console.error(`Missing assets/${f}. Run make-assets.py first.`); process.exit(2); }

const indexPath = join(proj, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const rootRe = /<div\b[^>]*\bdata-composition-id="[^"]+"[^>]*>/;
const rootTag = html.match(rootRe)?.[0];
if (!rootTag) { console.error('No root composition found in index.html'); process.exit(3); }
const attr = (name) => rootTag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const W = Number(attr('data-width')), H = Number(attr('data-height'));
const base = Number(attr('data-outro-base') ?? attr('data-duration'));
const start = +(base - cfg.overlap).toFixed(3);
const total = +(start + cfg.duration).toFixed(3);

// ---- layout numbers (must match the CSS in sc-outro.html) ----
const u = Math.min(W, H) / 1080;
const S = 1.1;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const logoW = layout.box.w * S, logoH = layout.box.h * S;
const parts = ['brace-left', 'fork', 'brace-right'].map((n) => {
  const p = layout.parts[n];
  const st = `left:calc(${(p.x * S).toFixed(1)} * var(--u));top:calc(${(p.y * S).toFixed(1)} * var(--u));width:calc(${(p.w * S).toFixed(1)} * var(--u));height:calc(${(p.h * S).toFixed(1)} * var(--u))`;
  return `<div class="sco-part p-${n}" style="${st}"><img class="sco-halo" src="assets/outro/${n}.png" alt=""><img src="assets/outro/${n}.png" alt=""></div>`;
}).join('');
const wordA = cfg.wordmarkA ?? 'spaghetti', wordB = cfg.wordmarkB ?? 'Code';
const wordmark = [...wordA].map((c) => `<span class="p">${esc(c)}</span>`).join('') + [...wordB].map((c) => `<span class="c">${esc(c)}</span>`).join('');
const burst = Array.from({ length: 10 }, (_, i) => `<i style="background:${i % 2 ? '#2DF0FF' : '#FA0487'}"></i>`).join('');
const ctaLines = cta.length * 0.62 * 46 > 900 ? 2 : 1;
const ctaH = ctaLines * 46 * 1.2;
const brandH = logoH + 26 + 84 + (handle ? 26 + 44 : 0);
const ctaBlock = ctaH + 36 + 150;
const totalH = brandH + 70 + ctaBlock;
const top = (H / u - totalH) / 2;
const rowY = (top + brandH + 70 + ctaH + 36 + 75) * u;
const rowX0 = W / 2 - (150 + 44 + 400) / 2 * u;
const likeXY = { x: rowX0 + 75 * u, y: rowY };
const followXY = { x: rowX0 + (150 + 44 + 200) * u, y: rowY };

let comp = readFileSync(join(here, 'sc-outro.html'), 'utf8');
const fill = {
  DUR: cfg.duration, W, H, U: u.toFixed(4), PARTS: parts, WORDMARK: wordmark, BURST: burst,
  HANDLE: handle ? `<div class="sco-handle">${esc(handle)}</div>` : '',
  CTA: esc(cta), LIKE: esc(cfg.likeLabel), FOLLOW: esc(cfg.followLabel), FOLLOWING: esc(cfg.followingLabel),
  LOGO_W: logoW.toFixed(1), LOGO_H: logoH.toFixed(1), BRAND_Y: ((70 + ctaBlock) / 2 * u).toFixed(1),
  TIMING: JSON.stringify(cfg.timing), LIKE_XY: JSON.stringify(likeXY), FOLLOW_XY: JSON.stringify(followXY),
};
comp = comp.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? String(fill[k]) : m));
const left = comp.match(/\{\{\w+\}\}/);
if (left) { console.error(`Unfilled placeholder ${left[0]}`); process.exit(4); }

mkdirSync(join(proj, 'compositions'), { recursive: true });
mkdirSync(join(proj, 'assets/outro'), { recursive: true });
writeFileSync(join(proj, 'compositions/sc-outro.html'), comp);
for (const f of files) copyFileSync(join(here, 'assets', f), join(proj, 'assets/outro', f));

// ---- patch index.html ----
html = html.replace(/\n?<!-- spaghetticode-outro:start -->[\s\S]*?<!-- spaghetticode-outro:end -->/, '');
let newRoot = rootTag.replace(/\bdata-duration="[^"]*"/, `data-duration="${total}"`);
newRoot = /\bdata-outro-base=/.test(newRoot)
  ? newRoot.replace(/\bdata-outro-base="[^"]*"/, `data-outro-base="${base}"`)
  : newRoot.replace(/>$/, ` data-outro-base="${base}">`);
const block = `
<!-- spaghetticode-outro:start -->
<style>.sc-outro-layer{position:absolute;inset:0;z-index:1000}</style>
<div id="sc-outro-mount" class="sc-outro-layer" data-composition-id="sc-outro" data-composition-src="compositions/sc-outro.html" data-start="${start}" data-duration="${cfg.duration}" data-track-index="900" data-width="${W}" data-height="${H}"></div>
<audio id="sc-outro-sfx" data-start="${start}" data-duration="${cfg.duration}" data-track-index="901" src="assets/outro/outro-sfx.wav" data-volume="1"></audio>
<!-- spaghetticode-outro:end -->`;
html = html.replace(rootTag, newRoot + block);
writeFileSync(indexPath, html);
console.log(`Outro added to ${proj}: starts ${start}s, video now ${total}s (${W}x${H}).`);
