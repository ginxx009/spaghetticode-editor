#!/usr/bin/env node
// Build index.html + assets/sfx-events.json for a project from edit.json and the cut.
//   node app/lib/compose.mjs <project-dir>
// Card types: checklist, status, chips, tip, callout. Anchors are source word indices.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const proj = resolve(process.argv[2]);
const read = (p) => JSON.parse(readFileSync(join(proj, p), 'utf8'));
const edit = read('edit.json');
const edl = read('assets/cut-edl.json');
const out = read('assets/words-out.json');
const ft = read('assets/face-track.json');
const DUR = edl.output_duration;
const FR = 1 / 30;
const f3 = (n) => Number(n).toFixed(3);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const { width: W, height: H, orientation } = edit.media;
const portrait = orientation === 'portrait';

// ---------- timeline helpers ----------
const words = out.words;
const byIndex = new Map(words.map((w) => [w.i, w]));
const timeOf = (i) => {
  if (i == null) return null;
  if (byIndex.has(i)) return byIndex.get(i).start;
  const next = words.find((w) => w.i > i);
  return next ? next.start : null;
};
const srcToOut = (ts) => {
  for (const m of edl.segments) if (ts >= m.src_start && ts < m.src_end) return m.out_start + ts - m.src_start;
  return null;
};
const track = ft.track.map((o) => ({ ...o, t: srcToOut(o.t) })).filter((o) => o.t != null);
const face = edit.media.face || ft.face;
const fy = (face.top + face.bottom) / 2;

// ---------- captions ----------
const norm = (t) => t.toLowerCase().replace(/[.,?!"]+$/g, '').replace(/^["]+/, '');
const RED = /^(sira|hindi|walang|wala|kulang|broken|error|errors|hardcoded|exposed|mali|problema|bagsak)$/;
const GREEN = /^(ayusin|maglagay|tanggalin|i-check|i-validate|i-sanitize|i-prompt|i-direct|i-deploy|i-automate|i-enforce|secure|ready|add|gamitin)$/;
const cardWords = new Set();
for (const c of edit.cards || []) {
  const texts = [c.name, c.title, c.name, ...(c.items || []).map((x) => x.title), ...(c.groups || []).flatMap((g) => g.items.map((x) => x.text))];
  texts.filter(Boolean).forEach((t) => t.toLowerCase().split(/[^a-z0-9.+-]+/).filter((x) => x.length > 2).forEach((x) => cardWords.add(x)));
}
const TEAL = /^(ai|seo|aeo|api|production|deployment|testing|security|chatgpt|claude|cursor|code|app|database|docker|playwright|github)$/;
const LEAD = /^(so|pero|para|and|at|kasi|kung|kahit|dapat|ito|okay|ano|you)$/;
const chunks = [];
let cur = null;
const capWords = words.filter((w) => w.text.trim());
for (let k = 0; k < capWords.length; k++) {
  const w = capWords[k], prev = capWords[k - 1];
  const len = cur ? cur.words.map((x) => x.text).join(' ').length : 0;
  const lead = LEAD.test(norm(w.text)) && cur && cur.words.length >= 1;
  if (!cur || lead || cur.words.length >= 3 || len + w.text.length > 18 || (prev && w.start - prev.end > 0.3) || /[.,?!]$/.test(prev?.text || '')) {
    cur = { words: [] }; chunks.push(cur);
  }
  cur.words.push(w);
}
const clen = (c) => c.words.map((x) => x.text).join(' ').length;
const gapTo = (a, b) => b.words[0].start - a.words[a.words.length - 1].end;
for (let k = chunks.length - 1; k > 0; k--) {
  const c = chunks[k], p = chunks[k - 1];
  if (c.words.length === 1 && !LEAD.test(norm(c.words[0].text)) && !/[.?!]$/.test(p.words[p.words.length - 1].text) && clen(p) + clen(c) < 22 && gapTo(p, c) < 0.35) {
    p.words.push(...c.words); chunks.splice(k, 1);
  }
}
for (let k = 0; k < chunks.length - 1; k++) {
  const c = chunks[k], n = chunks[k + 1];
  if (c.words.length === 1 && clen(c) <= 9 && !/[.?!]$/.test(c.words[0].text) && clen(c) + clen(n) < 22 && n.words.length < 4 && gapTo(c, n) < 0.35) {
    n.words.unshift(...c.words); chunks.splice(k, 1); k--;
  }
}
const hl = edit.highlights || {};
chunks.forEach((c, k) => {
  c.start = Math.max(0, c.words[0].start - 2 * FR);
  const next = chunks[k + 1];
  const lastEnd = c.words[c.words.length - 1].end;
  c.end = next ? (next.words[0].start - lastEnd < 0.7 ? next.words[0].start - 2 * FR : lastEnd + 0.2) : DUR;
  c.end = Math.max(c.end, c.start + 0.2);
  if (next) c.end = Math.min(c.end, Math.max(0, next.words[0].start - 2 * FR));
  const tones = c.words.map((w) => hl[w.i] || (RED.test(norm(w.text)) ? 'red' : GREEN.test(norm(w.text)) ? 'green' : (TEAL.test(norm(w.text)) || cardWords.has(norm(w.text))) ? 'teal' : ''));
  c.tone = tones.includes('red') ? 'red' : tones.includes('green') ? 'green' : tones.includes('teal') ? 'teal' : '';
  c.text = c.words.map((w) => w.text).join(' ').replace(/[.,!]+$/g, '').replace(/\.(?= )/g, '');
});

// ---------- cards: timing ----------
const H_ = [], A = [], S = [];
let trackIdx = 30;
const ends = {};
const clip = (id, start, end, cls, inner, top) => {
  ends[id] = end;
  H_.push(`<div id="${id}" class="clip layer" data-start="${f3(start)}" data-duration="${f3(end - start)}" data-track-index="${trackIdx++}" style="top:${top}px"><div id="${id}i" class="${cls}">${inner}</div></div>`);
};
const kill = (id, t) => A.push(`tl.set("#${id}i",{opacity:0},${f3(t ?? ends[id] - 0.001)});`);
const exitCard = (id, t) => { A.push(`tl.to("#${id}i",{y:30,opacity:0,duration:.2,ease:"power2.in"},${f3(t - 0.2)});`); kill(id, t - 0.001); };

const cards = (edit.cards || []).map((c, k) => {
  const anchors = c.type === 'checklist' ? (c.items || []).map((x) => timeOf(x.word)).filter((x) => x != null) : [];
  const start = c.type === 'checklist' ? Math.max(0, (timeOf(c.word) ?? (anchors[0] ?? 0) - 0.8)) : timeOf(c.word);
  const last = c.type === 'checklist' ? (anchors[anchors.length - 1] ?? start) + 2.5
    : c.type === 'tip' || c.type === 'chips' ? Math.max(start + 4, ...[...(c.steps || []), ...(c.groups || []).flatMap((g) => g.items)].map((x) => (timeOf(x.word) ?? 0) + 1.5))
      : start + (c.type === 'callout' ? 3 : 5);
  return { ...c, k, start, end: timeOf(c.endWord) ?? last };
}).filter((c) => c.start != null).sort((a, b) => a.start - b.start || (a.type === 'checklist' ? -1 : 1))
  .filter((c, k, arr) => !arr.slice(0, k).some((p) => p.type === c.type && Math.abs(p.start - c.start) < 0.5));
const lists = cards.filter((c) => c.type === 'checklist');
const overlapsList = (c) => c.type !== 'checklist' && lists.some((l) => c.start < l.end && (c.end ?? c.start + 3) > l.start - 0.3);
const dropped = cards.filter(overlapsList);
const kept = cards.filter((c) => !overlapsList(c));
cards.length = 0; cards.push(...kept);
cards.forEach((c, k) => { const n = cards[k + 1]; if (n) c.end = Math.min(c.end, n.start - 0.05); c.end = Math.min(c.end, DUR); });
for (let k = cards.length - 1; k >= 0; k--) if (cards[k].end - cards[k].start < 0.8) dropped.push(...cards.splice(k, 1));
if (dropped.length) console.log(`STAGE: Skipped ${dropped.length} card(s) that overlapped the list or were too short: ${dropped.map((c) => c.type + (c.text ? ` "${c.text}"` : '')).join(', ')}`);

// ---------- layout + camera ----------
const SEAM = 760;
const segBounds = edl.segments.map((s) => s.out_start);
const layouts = [{ t: 0, l: 'full' }];
if (!portrait) for (const c of cards) { layouts.push({ t: c.start - 0.05, l: 'split' }); layouts.push({ t: c.end, l: 'full' }); }
layouts.sort((a, b) => a.t - b.t);
const lay = layouts.filter((x, k) => k === 0 || x.l !== layouts[k - 1].l || Math.abs(x.t - layouts[k - 1].t) > 0.01)
  .filter((x, k, arr) => !(arr[k + 1] && arr[k + 1].t - x.t < 0.6 && x.l === 'full' && k > 0));
const layoutAt = (t) => lay.filter((x) => x.t <= t + 1e-6).pop()?.l || 'full';
const s0full = Math.max(1080 / W, 1920 / H);
const sSplit = 0.95 * 1080 / H;
const anchorY = portrait ? face.top : fy;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let FX = face.x;
const camFor = (l, z) => {
  if (l === 'split') {
    const s = sSplit * z;
    return { s, x: clamp(540 - FX * s, 1080 - W * s, 0), y: anchorY * sSplit - anchorY * s };
  }
  const s = s0full * z;
  const y1 = clamp((portrait ? 700 : 1000) - anchorY * s0full, 1920 - H * s0full, 0);
  const AY = anchorY * s0full + y1;
  return { s, x: clamp(540 - FX * s, 1080 - W * s, 0), y: clamp(AY - anchorY * s, 1920 - H * s, 0) };
};
const zoomSet = portrait ? { alt: 1.1, punch: 1.22 } : { alt: 1.05, punch: 1.12, altSplit: 1.08, punchSplit: 1.08 };
const emph = (edit.emphasis || []).map(timeOf).filter((t) => t != null);
if (!emph.length) { const q = words.find((w) => /\?$/.test(w.text)); if (q) emph.push(q.start); }
const bounds = [...new Set([...segBounds, ...lay.map((x) => x.t)].filter((t) => t >= 0 && t < DUR).map((t) => +t.toFixed(3)))].sort((a, b) => a - b);
const cam = [];
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : face.x; };
const camSet = (t, l, z) => { const c = camFor(l, z); cam.push(`tl.set("#cam",{x:${c.x.toFixed(1)},y:${c.y.toFixed(1)},scale:${c.s.toFixed(4)}},${f3(t)});`); };
const camTo = (t, d, l, z, ease = 'none') => { if (d < 0.03) return; const c = camFor(l, z); cam.push(`tl.to("#cam",{x:${c.x.toFixed(1)},y:${c.y.toFixed(1)},scale:${c.s.toFixed(4)},duration:${f3(d - 0.004)},ease:"${ease}"},${f3(t)});`); };
let alt = 0;
for (let k = 0; k < bounds.length; k++) {
  const s = bounds[k], e = bounds[k + 1] ?? DUR;
  const l = layoutAt(s);
  FX = median(track.filter((o) => o.t >= s - 0.25 && o.t < e + 0.25).map((o) => o.x));
  const base = alt++ % 2 ? (l === 'split' ? zoomSet.altSplit : zoomSet.alt) : 1.0;
  camSet(s, l, base);
  let t = s, z = base;
  for (const p of emph.filter((x) => x >= s && x < e)) {
    camTo(t, p - t, l, z + 0.015 * (p - t) / (e - s));
    z = l === 'split' ? zoomSet.punchSplit : zoomSet.punch;
    camTo(p, 0.16, l, z, 'power4.out');
    S.push({ t: p, kind: 'thump', gain: 0.35 });
    t = p + 0.16;
  }
  camTo(t, e - t, l, z + 0.02);
  const samples = l === 'full' ? track.filter((o) => o.t >= s && o.t < e) : [];
  const smooth = samples.map((o, i) => 0.5 * o.x + 0.25 * (samples[i - 1] ?? o).x + 0.25 * (samples[i + 1] ?? o).x);
  const c0 = camFor(l, base);
  const off = (x) => clamp((FX - x) * c0.s, 1080 - W * c0.s - c0.x, -c0.x);
  cam.push(`tl.set("#pan",{x:${(samples.length ? off(smooth[0]) : 0).toFixed(1)}},${f3(s)});`);
  samples.slice(1).forEach((o, i) => { if (o.t + 0.5 <= e) cam.push(`tl.to("#pan",{x:${off(smooth[i + 1]).toFixed(1)},duration:.496,ease:"sine.inOut"},${f3(o.t)});`); });
}
const layoutSets = lay.map((x) => `tl.set("#panel",{y:${x.l === 'split' ? SEAM : 0}},${f3(x.t)});tl.set("#seam",{opacity:${x.l === 'split' ? 1 : 0}},${f3(x.t)});tl.set("#caps",{y:${x.l === 'split' ? 500 : 0}},${f3(x.t)});`);

// Card zone: split layout uses the top 200-690; portrait uses the wall above the head or the chest below it.
const headTopOut = (() => { const c = camFor('full', 1); return face.top * c.s + c.y; })();
const chinOut = (() => { const c = camFor('full', 1); return face.bottom * c.s + c.y; })();
const zone = !portrait ? { top: 210, height: 470 }
  : headTopOut - 360 >= 300 ? { top: 350, height: Math.min(480, headTopOut - 380) }
    : { top: Math.max(chinOut + 40, 1150), height: 1580 - Math.max(chinOut + 40, 1150) };

// ---------- card builders ----------
const status = (c) => {
  const id = `c${c.k}`;
  const rows = (c.rows || []).map((r, j) => {
    const states = [{ t: c.start, state: r.state || 'ok', text: r.text || '' }, ...(r.changes || []).map((ch) => ({ t: timeOf(ch.word), state: ch.state, text: ch.text })).filter((x) => x.t != null)];
    const spans = states.map((st, n) => `<span class="st-res ${st.state}" id="${id}r${j}s${n}">${st.state === 'ok' ? '✓ ' : st.state === 'bad' ? '✗ ' : ''}${esc(st.text)}</span>`).join('');
    states.forEach((st, n) => {
      if (n === 0) return;
      A.push(`tl.set("#${id}r${j}s${n - 1}",{opacity:0},${f3(st.t)});tl.fromTo("#${id}r${j}s${n}",{opacity:0,scale:1.6},{opacity:1,scale:1,duration:.25,ease:"power4.out"},${f3(st.t)});tl.set("#${id}d${j}",{backgroundColor:"${st.state === 'ok' ? '#8CF27A' : st.state === 'bad' ? '#FF5B5B' : '#C9CCD3'}"},${f3(st.t)});`);
      S.push({ t: st.t, kind: st.state === 'bad' ? 'deny' : 'tick', gain: 0.35 });
      if (st.state === 'bad') { A.push(`tl.set("#flash",{opacity:.4},${f3(st.t)});tl.to("#flash",{opacity:0,duration:.35,ease:"power2.out"},${f3(st.t + 0.01)});tl.set("#flash",{opacity:0},${f3(st.t + 0.361)});`); S.push({ t: st.t, kind: 'thump', gain: 0.5 }); }
    });
    states.slice(1).forEach((st, n) => A.push(`tl.set("#${id}r${j}s${n + 1}",{opacity:0},${f3(c.start - 0.1)});`));
    const appear = timeOf(r.word);
    if (appear != null && appear > c.start) A.push(`tl.from("#${id}row${j}",{opacity:0,x:-40,duration:.3,ease:"power3.out"},${f3(appear - 0.05)});`);
    return `<div class="st-row" id="${id}row${j}"><span class="st-dot ${r.state || 'ok'}" id="${id}d${j}"></span><span class="st-env">${esc(r.label)}</span>${spans}</div>`;
  }).join('');
  clip(id, c.start - 0.1, c.end, 'card status', rows, zone.top);
  A.push(`tl.from("#${id}i",{y:-40,opacity:0,duration:.35,ease:"back.out(1.6)"},${f3(c.start - 0.1)});`);
  S.push({ t: c.start - 0.1, kind: 'pop', gain: 0.3, v: 1 });
  exitCard(id, c.end);
};
const chips = (c) => {
  const id = `c${c.k}`;
  const groups = (c.groups || []).map((g, j) => `<div class="why-row"><span class="why-k ${g.tone === 'bad' ? 'bad-k' : ''}">${esc(g.label)}</span><div class="why-chips">${g.items.map((x, n) => `<span class="chip ${g.tone === 'bad' ? 'bad' : 'good'}" id="${id}g${j}x${n}">${g.tone === 'bad' ? '✗' : '✓'} ${esc(x.text)}</span>`).join('')}</div></div>`).join('');
  clip(id, c.start - 0.05, c.end, 'why', groups, zone.top + 20);
  A.push(`tl.from("#${id}i .why-k",{opacity:0,x:-30,duration:.3,ease:"power3.out",stagger:.1},${f3(c.start)});`);
  (c.groups || []).forEach((g, j) => g.items.forEach((x, n) => {
    const t = timeOf(x.word) ?? c.start + 0.3 * (n + 1);
    A.push(`tl.from("#${id}g${j}x${n}",{y:-30,scale:.5,opacity:0,duration:.3,ease:"back.out(2)"},${f3(Math.max(c.start, t - 0.05))});`);
    S.push({ t, kind: 'click', gain: 0.3, v: n % 3 });
  }));
  exitCard(id, c.end);
};
const tip = (c) => {
  const id = `c${c.k}`;
  const steps = c.steps || [];
  clip(id, c.start - 0.1, c.end, 'card bonus', `<div class="bn-top"><span class="bn-badge">${esc(c.badge || 'TIP')}</span><span class="bn-name">${esc(c.name)}</span></div>${c.sub ? `<div class="bn-sub">${esc(c.sub)}</div>` : ''}<div class="bn-steps">${steps.map((s, n) => `<div class="bn-step" id="${id}s${n}"><span class="bn-ck" id="${id}k${n}">✓</span><span class="bn-run" id="${id}r${n}"></span>${esc(s.text)}</div>`).join('')}</div>`, zone.top + 10);
  A.push(`tl.from("#${id}i",{y:60,opacity:0,scale:.92,duration:.45,ease:"back.out(1.5)"},${f3(c.start - 0.1)});`);
  S.push({ t: c.start - 0.1, kind: 'whoosh', gain: 0.25 });
  steps.forEach((s, n) => {
    const t = timeOf(s.word) ?? c.start + 1 + n;
    A.push(`tl.from("#${id}s${n}",{opacity:0,x:-20,duration:.25,ease:"power3.out"},${f3(Math.max(c.start, t - 0.6))});`);
    A.push(`tl.set("#${id}r${n}",{opacity:0},${f3(t)});tl.from("#${id}k${n}",{scale:0,duration:.3,ease:"back.out(3)"},${f3(t)});`);
    S.push({ t, kind: 'tick', gain: 0.35 });
  });
  exitCard(id, c.end);
};
const callout = (c) => {
  const id = `c${c.k}`;
  clip(id, c.start - 0.05, c.end, `callout ${c.tone || 'teal'}`, esc(c.text), zone.top + 40);
  A.push(`tl.from("#${id}i",{scale:.5,opacity:0,duration:.35,ease:"back.out(2.2)"},${f3(c.start - 0.05)});`);
  S.push({ t: c.start, kind: 'pop', gain: 0.3, v: 2 });
  exitCard(id, c.end);
};
const checklist = (c) => {
  const id = `c${c.k}`;
  const items = (c.items || []).map((x) => ({ ...x, t: timeOf(x.word) })).filter((x) => x.t != null).sort((a, b) => a.t - b.t);
  const N = items.length;
  const visible = Math.max(1, Math.min(3, Math.floor((zone.height - 96) / 116)));
  clip(`${id}cnt`, c.start, c.end, 'counter', `<div class="cnt-l">${esc(c.name || 'CHECKLIST')}</div><div class="cnt-r"><span class="cnt-num">${Array.from({ length: N + 1 }, (_, n) => `<span class="cn" id="${id}cn${n}">${n}</span>`).join('')}</span><span class="cnt-of">/${N}</span></div><div class="bar"><div class="bar-f" id="${id}bar"></div></div>`, zone.top);
  A.push(`tl.set("#${id}cn0",{opacity:1},${f3(c.start)});`);
  A.push(`tl.from("#${id}cnti",{y:-30,opacity:0,duration:.4,ease:"power3.out"},${f3(c.start)});`);
  S.push({ t: c.start, kind: 'whoosh', gain: 0.22 });
  items.forEach((x, n) => {
    A.push(`tl.set("#${id}cn${n}",{opacity:0},${f3(x.t)});tl.set("#${id}cn${n + 1}",{opacity:1},${f3(x.t)});tl.to("#${id}bar",{scaleX:${((n + 1) / N).toFixed(4)},duration:.3,ease:"power2.out"},${f3(x.t)});`);
    const nid = `${id}n${n}`;
    const leave = items[n + visible];
    const end = leave ? leave.t + 0.3 : c.end;
    clip(nid, x.t - 0.05, end, 'notif', `<div class="nt-in" id="${nid}c"><div class="nt-ic">${String(n + 1).padStart(2, '0')}</div><div class="nt-tx"><div class="nt-top"><span>${n + 1} OF ${N}</span><span>now</span></div><div class="nt-t">${esc(x.title)}</div>${x.sub ? `<div class="nt-s">${esc(x.sub)}</div>` : ''}</div></div>`, zone.top + 100);
    A.push(`tl.from("#${nid}c",{y:-60,opacity:0,scale:.9,duration:.32,ease:"back.out(1.7)"},${f3(x.t - 0.05)});`);
    for (let step = 1; step < visible; step++) {
      const nx = items[n + step];
      if (nx) A.push(`tl.to("#${nid}c",{y:${116 * step},scale:${(1 - 0.03 * step).toFixed(2)},opacity:${(1 - 0.2 * step).toFixed(2)},duration:.28,ease:"power3.out"},${f3(nx.t - 0.05)});`);
    }
    if (leave) A.push(`tl.to("#${nid}c",{y:${116 * (visible - 1) + 50},opacity:0,scale:.9,duration:.25,ease:"power2.in"},${f3(leave.t - 0.05)});tl.set("#${nid}c",{opacity:0},${f3(leave.t + 0.201)});`);
    else { A.push(`tl.to("#${nid}c",{y:"-=50",opacity:0,duration:.2,ease:"power2.in"},${f3(c.end - 0.25)});tl.set("#${nid}c",{opacity:0},${f3(c.end - 0.049)});`); }
    S.push({ t: x.t - 0.02, kind: 'ding', gain: 0.32, v: n % 3 });
  });
  if (items.length) {
    A.push(`tl.fromTo("#${id}cnti",{boxShadow:"0 0 0 0 rgba(140,242,122,.8)"},{boxShadow:"0 0 0 30px rgba(140,242,122,0)",duration:.9,ease:"power2.out"},${f3(items[N - 1].t + 0.3)});`);
    S.push({ t: items[N - 1].t + 0.35, kind: 'chime', gain: 0.3 });
  }
  A.push(`tl.to("#${id}cnti",{y:-20,opacity:0,duration:.2,ease:"power2.in"},${f3(c.end - 0.2)});`);
  kill(`${id}cnt`, c.end - 0.001);
};
const builders = { status, chips, tip, callout, checklist };
for (const c of cards) builders[c.type]?.(c);

// ---------- html ----------
const capHtml = chunks.map((c, k) => `<div id="cap${k}" class="clip cap" data-start="${f3(c.start)}" data-duration="${f3(c.end - c.start)}" data-track-index="2"><span class="cbox${c.tone ? ' ' + c.tone : ''}">${esc(c.text)}</span></div>`).join('\n');
const css = readFileSync(new URL('./compose.css', import.meta.url), 'utf8');
const html = `<!doctype html>
<html lang="tl">
<head>
<meta charset="utf-8">
<title>${esc(edit.title?.title || 'spaghettiCode reel')}</title>
<script src="assets/gsap.min.js"></script>
<style>
${css}
#cam{width:${W}px;height:${H}px}
#cam video{width:${W}px;height:${H}px}
#seam{top:${SEAM - 3}px}
</style>
</head>
<body>
<div id="reel" data-composition-id="reel" data-start="0" data-duration="${f3(DUR)}" data-width="1080" data-height="1920">
<div id="bg"></div>
<div id="panel"><div id="pan"><div id="shake"><div id="cam"><video id="talk" data-start="0" data-duration="${f3(DUR)}" data-track-index="0" src="assets/clean.mp4" muted playsinline></video></div></div></div></div>
<div id="seam"></div>
<div id="flash"></div>
<audio id="mix" data-start="0" data-duration="${f3(DUR)}" data-track-index="1" src="assets/mix.wav" data-volume="1"></audio>
<div id="caps">
${capHtml}
</div>
${H_.join('\n')}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${layoutSets.join('\n')}
${cam.join('\n')}
${A.join('\n')}
window.__timelines = window.__timelines || {};
window.__timelines["reel"] = tl;
</script>
</body>
</html>
`;
writeFileSync(join(proj, 'index.html'), html);
writeFileSync(join(proj, 'assets/cards.json'), JSON.stringify(cards.map((c) => ({ type: c.type, start: +c.start.toFixed(3), end: +c.end.toFixed(3), text: c.text || c.name || c.title || '' })), null, 1));
writeFileSync(join(proj, 'assets/sfx-events.json'), JSON.stringify(S.sort((a, b) => a.t - b.t), null, 1));
writeFileSync(join(proj, 'meta.json'), JSON.stringify({ id: 'reel', name: proj.split('/').pop(), width: 1080, height: 1920, fps: 30 }, null, 2));
console.log(`STAGE: Composed ${chunks.length} captions, ${cards.length} cards, ${lay.length} layout changes (${portrait ? 'portrait' : 'landscape'}, card zone ${Math.round(zone.top)}+${Math.round(zone.height)})`);
