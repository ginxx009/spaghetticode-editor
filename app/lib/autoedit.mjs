#!/usr/bin/env node
// Auto edit: the agent's editing passes, run on a local Ollama model plus deterministic rules.
//   node app/lib/autoedit.mjs <project-dir> [model]
// 1 fix misheard words  2 find the structure (list, hook, punch-ins, titles)  3 decide cuts
// Applies everything to edit.json and records each decision so the app can show and undo it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proj = resolve(process.argv[2]);
const MODEL = process.argv[3] || process.env.SC_MODEL || 'qwen3:14b';
const editPath = join(proj, 'edit.json');
const edit = JSON.parse(readFileSync(editPath, 'utf8'));
const W = edit.words;
const VOCAB = JSON.parse(readFileSync(join(APP, 'vocab.json'), 'utf8')).terms;
const stage = (m) => console.log(`STAGE: ${m}`);
const decisions = [];

// ---------- helpers ----------
const plain = (t) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
const punct = (t) => (t.match(/[.,?!:;]+$/) || [''])[0];
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const fuzzyContains = (hay, needle) => {
  if (needle.length < 4 || hay.length < needle.length) return false;
  for (let k = 0; k + needle.length <= hay.length; k++) if (sim(hay.slice(k, k + needle.length), needle) >= 0.6) return true;
  return false;
};
const STOP = new Set(['so', 'and', 'at', 'na', 'ng', 'yung', 'ang', 'sa', 'mo', 'ko', 'ka', 'para', 'pero', 'then', 'of', 'the', 'or', 'o', 'yun', 'ito', 'nga', 'lang', 'din', 'rin', 'naman', 'kasi', 'dapat', 'pag', 'kung', 'mga', 'is', 'a', 'to', 'okay', 'ano', 'eh', 'ba', 'po']);
const NEGATION = new Set(['hindi', 'di', 'wala', 'walang', 'huwag', 'wag', 'not', 'no', 'never', 'dont', 'cant', 'wont', 'isnt']);
const CONNECT = new Set(['i', 'and', 'then', 'of', 'course', 'so', 'pero', 'tapos']);
const SAFE = new Set(['so', 'and', 'then', 'okay', 'ano', 'yun', 'ba', 'eh', 'parang', 'like', 'basically', 'actually', 'ayun', 'ito', 'um', 'uh']);
const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'ah', 'eh', 'er', 'erm', 'hmm', 'mm', 'uhh']);
const text = (i) => fixes[i] ?? W[i].text;

async function ask({ system, user, schema, think = false, label }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error('timed out after 6 min')), 360000);
      const res = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model: MODEL, stream: true, think, format: schema, options: { temperature: 0, seed: 7, num_ctx: 16384, num_predict: 8000, repeat_penalty: 1.1 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      let content = '', buf = '';
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const l of lines) if (l.trim()) content += JSON.parse(l).message?.content || '';
      }
      if (buf.trim()) content += JSON.parse(buf).message?.content || '';
      clearTimeout(timer);
      console.log(`  ${label}: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      try { return JSON.parse(content); } catch { console.log(`  ${label}: model returned invalid JSON, skipped`); return null; }
    } catch (e) {
      console.log(`  ${label}: ${e.message}${attempt === 1 ? ', retrying' : ', skipped'}`);
      if (attempt === 2) { if (/ECONNREFUSED|fetch failed/.test(e.message + (e.cause?.code || ''))) throw new Error('Ollama not reachable. Start it with: ollama serve'); return null; }
    }
  }
}

// ---------- sentences ----------
function sentences() {
  const out = [];
  let cur = [];
  for (let k = 0; k < W.length; k++) {
    cur.push(W[k].i);
    const gap = W[k + 1] ? W[k + 1].start - W[k].end : 9;
    if (/[.?!]$/.test(text(W[k].i)) || gap > 0.65 || cur.length >= 22) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.map((ids, n) => ({ id: n, ids, text: ids.map(text).join(' '), start: W[ids[0]].start, end: W[ids[ids.length - 1]].end }));
}

// ---------- 1. misheard words ----------
const fixes = {};
const prevAuto = new Set(edit.autoFixes || []);
for (const [k, v] of Object.entries(edit.fixes || {})) if (!prevAuto.has(Number(k))) fixes[k] = v;
const manualFixes = new Set(Object.keys(fixes).map(Number));
const autoFixed = [];
const setFix = (i, v, reason, source) => {
  if (manualFixes.has(i) || v === W[i].text) return;
  fixes[i] = v; autoFixed.push(i);
  decisions.push({ kind: 'fix', words: [i], from: W[i].text, to: v || '(merged)', reason, source });
};
stage('Fixing misheard words');
const proper = (t) => /[A-Z]/.test(t) || /[./]/.test(t);
const single = VOCAB.filter((t) => !/\s/.test(t) && proper(t));
const multi = VOCAB.filter((t) => !/\s/.test(t) && /[A-Z].*[A-Z]/.test(t));
for (let k = 0; k < W.length; k++) {
  const i = W[k].i, p = plain(W[k].text);
  if (p.length < 3) continue;
  const p2 = W[k + 1] ? p + plain(W[k + 1].text) : '';
  const two = multi.find((t) => plain(t) === p2 && plain(t) !== p);
  if (two) { setFix(i, two + punct(W[k + 1].text), 'known term', 'rule'); setFix(W[k + 1].i, '', 'merged into previous word', 'rule'); k++; continue; }
  const exact = single.find((t) => plain(t) === p);
  if (exact && exact !== W[k].text.replace(/[.,?!:;]+$/, '')) { setFix(i, exact + punct(W[k].text), 'term spelling', 'rule'); continue; }
  if (p.length >= 5) {
    const best = single.map((t) => [t, sim(plain(t), p)]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 0.8 && plain(best[0]) !== p) setFix(i, best[0] + punct(W[k].text), `sounds like "${best[0]}"`, 'rule');
  }
}
{
  const S = sentences();
  const r = await ask({
    label: 'misheard words',
    system: `You proofread an automatic transcript of a Filipino developer speaking Taglish (Tagalog + English).
Speech-to-text often mishears English tech words and some Tagalog words. Find ONLY clear mishearings and give the corrected text.
Known terms the speaker uses: ${VOCAB.join(', ')}.
Examples of mishearings you should fix:
- "wide-coded" -> "vibe-coded" (vibe coding is building apps with AI)
- "insider-versal," -> "either Vercel," and "natlify" -> "Netlify"
- "mapagal" -> "mabagal" (Tagalog for slow)
- "CICD" -> "CI/CD"; "APR rate limiting" -> "API rate limiting"
- "cloud watch" -> "CloudWatch" (give the merged term on the first word and "" for the second word)
- "ititik" -> "i-tick"
Do not change correct words, do not translate, do not fix grammar or style. Keep Tagalog as Tagalog.
Return {"fixes":[{"i": word index, "text": corrected word or "" to merge into previous}]}.`,
    user: S.map((s) => s.ids.map((i) => `[${i}]${text(i)}`).join(' ')).join('\n'),
    schema: { type: 'object', properties: { fixes: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' } }, required: ['i', 'text'] } } }, required: ['fixes'] },
  });
  const ruleFixed = new Set(Object.keys(fixes).map(Number));
  for (const f of r?.fixes || []) {
    if (!Number.isInteger(f.i) || !W[f.i] || f.text.split(/\s+/).length > 3 || ruleFixed.has(f.i)) continue;
    if (f.text === '') {
      const prevText = plain(fixes[f.i - 1] ?? '');
      if (!prevText || !fuzzyContains(prevText, plain(W[f.i].text))) continue;
    }
    const o = plain(W[f.i].text), n = plain(f.text);
    const soundsLike = sim(o, n) >= 0.55 || fuzzyContains(o, n) || fuzzyContains(n, o);
    if (f.text === '' ? !W[f.i - 1] || fixes[f.i - 1] == null : (n === o || !soundsLike)) continue;
    setFix(f.i, f.text, 'misheard (AI)', 'ai');
  }
}

// ---------- 2. structure ----------
stage('Finding the list, hook and punch-ins');
const S = sentences();
const numbered = S.map((s) => s.ids.map((i) => `[${i}]${text(i)}`).join(' ')).join('\n');
const struct = await ask({
  label: 'structure', think: true,
  system: `You edit short Taglish talking-head videos for spaghettiCode (Filipino dev creator). Every word has an index in brackets.
Return JSON:
- checklist: if the speaker walks through a list (fixes, steps, setup parts), name = what the whole list is, 2-3 UPPERCASE words like "DEPLOYMENT CHECKLIST" or "PRODUCTION CHECKLIST" (never just one item's name). items = EVERY category they announce, in order, usually right after "So," (e.g. "So, hosting.", "So, database,", "So CI/CD", "environment separation", "monitoring", "backups", "CDN and caching", "cost control"). word = index of the word where that category is named. title = the category itself in 1-3 words (Hosting, Database, CI/CD), NOT the tools. sub = the tools/advice they give for it, max 45 chars, e.g. "Vercel / Netlify, o AWS / GCP". No list -> name "" and items [].
- hookQuestion: index of the word ending the main question/problem in the first 15 seconds (e.g. "Saan mo siya ilalagay?"), or -1.
- emphasis: 3 to 5 word indices for camera punch-ins: the problem in the hook, the key question, the strongest takeaway near the end. Point at a strong content word, never a filler.
- callouts: 0 to 2 punchy on-screen texts (2-4 words, Taglish) for strong moments that are NOT inside the list.
- titles: 5 catchy opening titles about THIS video's topic, max 7 words, Taglish, hook-style. For style only (these are other videos, never reuse them): "Invisible ang vibe-coded website mo?", "Vibe-coded app mo, production-ready na ba?". Wrap ONE key word in [brackets]. kicker: 2-3 words in {braces} like "{Ayusin natin.}", "{Setup natin.}", "{Check natin.}".
Never invent things the speaker did not say.`,
  user: numbered,
  schema: {
    type: 'object',
    properties: {
      checklist: { type: 'object', properties: { name: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { word: { type: 'integer' }, title: { type: 'string' }, sub: { type: 'string' } }, required: ['word', 'title', 'sub'] } } }, required: ['name', 'items'] },
      hookQuestion: { type: 'integer' },
      emphasis: { type: 'array', items: { type: 'integer' } },
      callouts: { type: 'array', items: { type: 'object', properties: { word: { type: 'integer' }, text: { type: 'string' } }, required: ['word', 'text'] } },
      titles: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, kicker: { type: 'string' } }, required: ['title', 'kicker'] } },
    },
    required: ['checklist', 'hookQuestion', 'emphasis', 'callouts', 'titles'],
  },
}) || {};
const valid = (i) => Number.isInteger(i) && i >= 0 && i < W.length;
const snap = (i, label) => {
  const keys = label.toLowerCase().split(/[^a-z0-9]+/).filter((k) => k.length > 2 && !STOP.has(k));
  for (let d = 0; d <= 10; d++) for (const j of [i + d, i - d]) {
    const w = W[j];
    if (!w || STOP.has(plain(text(j)))) continue;
    const p = plain(text(j));
    if (p.length > 2 && keys.some((k) => p.startsWith(k.slice(0, 5)) || k.startsWith(p.slice(0, 5)))) return j;
  }
  return i;
};
const items = (struct.checklist?.items || []).filter((x) => valid(x.word)).map((x) => ({ word: snap(x.word, x.title), title: x.title.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bCicd\b/i, 'CI/CD').replace(/\bApi\b/, 'API').replace(/\bCdn\b/, 'CDN'), sub: x.sub }))
  .sort((a, b) => a.word - b.word).filter((x, n, a) => !n || x.word !== a[n - 1].word);
const listRange = items.length ? [W[items[0].word].start - 1.5, W[items[items.length - 1].word].end + 4] : null;
const inList = (i) => listRange && W[i].start >= listRange[0] && W[i].start <= listRange[1];

// ---------- 3. cuts ----------
stage('Deciding cuts');
const protect = new Set(items.map((x) => x.word));
for (const s of S) if (/follow|subscribe|i-like|like and|comment|i-share|share/i.test(s.text)) s.ids.forEach((i) => protect.add(i));
if (valid(struct.hookQuestion)) protect.add(struct.hookQuestion);
const cut = new Map();
const keep = new Set();
const addCut = (ids, reason, source) => {
  ids = ids.filter((i) => !protect.has(i) && !keep.has(i));
  if (!ids.length) return;
  ids.forEach((i) => cut.set(i, reason));
  decisions.push({ kind: 'cut', words: ids, text: ids.map(text).join(' '), reason, source });
};
// fillers
const fill = W.filter((w) => FILLERS.has(plain(w.text))).map((w) => w.i);
if (fill.length) addCut(fill, 'filler', 'rule');
// immediate repeats of 1-4 words: keep the second take
const toks = W.map((w) => plain(text(w.i)));
for (let n = 4; n >= 1; n--) {
  for (let k = 0; k + 2 * n <= W.length; k++) {
    const a = toks.slice(k, k + n), b = toks.slice(k + n, k + 2 * n);
    if (a.join(' ') !== b.join(' ') || a.every((t) => STOP.has(t) || !t) || (n === 1 && /agad|isa/.test(a[0]))) continue;
    if (a.some((_, m) => cut.has(W[k + m].i))) continue;
    b.forEach((_, m) => keep.add(W[k + n + m].i));
    addCut(a.map((_, m) => W[k + m].i), `repeated "${a.join(' ')}"`, 'rule');
  }
}
// sentence restarts: a short sentence whose opening the next sentence repeats
for (let n = 0; n + 1 < S.length; n++) {
  const A = S[n].ids.map((i) => plain(text(i))).filter((t) => t && !STOP.has(t));
  const B = S[n + 1].ids.map((i) => plain(text(i))).filter((t) => t && !STOP.has(t));
  if (A.length >= 1 && A.length <= 6 && B.length > A.length && A.slice(0, 2).every((t, m) => B[m] === t) && !/\?$/.test(S[n].text)) {
    S[n + 1].ids.forEach((i) => keep.add(i));
    addCut(S[n].ids, 'restart: said again right after', 'rule');
  }
}
// sign-off ramble at the end
const last = S[S.length - 1];
if (/\byun lang\b/i.test(last.text) && !/follow|subscribe|like/i.test(last.text) && last.ids.length <= 8) addCut(last.ids, 'sign-off ("yun lang")', 'rule');
// AI review, sentence by sentence
const CUT_SYSTEM = `You are a strict short-form video editor. The speaker talks Taglish. Decide what to CUT so the reel is tight but every point survives.
Cut:
- restarts: the speaker starts a sentence, stops, and says it again. Cut the FIRST attempt only.
  e.g. "Alam niya gumawa ng code. Magaling, magaling siya gumawa ng code" -> cut "Alam niya gumawa ng code. Magaling,"
- repeats: a line that repeats what was just said. e.g. after "pumunta sa Google Search Console." cut "So, type mo lang sa Google, so Google Search Console."
- asides that add nothing: e.g. "So, tulad nga nung earlier kanina."
- hesitation rambles: e.g. "I think yun lang yung sa ano na yun, sa" or "lagi nyo itong naririnig, no?"
- sign-offs like "So, yun lang." at the very end (keep a follow / next-video call to action).
Never cut: the opening sentence, questions, the first time a list item is named, the explanation of each item, tool names, the final takeaway.
Only cut exact word ranges you are sure about. Most sentences should stay.
Return {"cuts":[{"from": first word index, "to": last word index, "reason": short reason}]}.`;
const CUT_SCHEMA = { type: 'object', properties: { cuts: { type: 'array', items: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' }, reason: { type: 'string' } }, required: ['from', 'to', 'reason'] } } }, required: ['cuts'] };
const fmt = (s) => `S${s.id}: ${s.ids.map((i) => `[${i}]${text(i)}`).join(' ')}`;
const ai = { cuts: [] };
for (let k = 0; k < S.length; k += 10) {
  const part = S.slice(Math.max(0, k - 2), k + 12);
  const r2 = await ask({ label: `cuts ${Math.floor(k / 10) + 1}/${Math.ceil(S.length / 10)}`, think: true, system: CUT_SYSTEM, user: part.map(fmt).join('\n'), schema: CUT_SCHEMA });
  ai.cuts.push(...(r2?.cuts || []));
}
const firstSentence = new Set(S[0].ids);
const inQuestion = new Set();
{ let clause = []; for (const w of W) { clause.push(w.i); if (/[.!?]$/.test(text(w.i))) { if (/\?$/.test(text(w.i))) clause.forEach((i) => inQuestion.add(i)); clause = []; } } }
const islands = JSON.parse(readFileSync(join(proj, 'assets/islands.json'), 'utf8'));
const pauseNear = (t) => islands.some(([a, b], k) => Math.abs(b - t) < 0.15 || Math.abs(a - t) < 0.15 || (islands[k + 1] && t > b && t < islands[k + 1][0]));
const cleanEdges = (ids) => {
  const first = W[ids[0]], last = W[ids[ids.length - 1]], prev = W[ids[0] - 1], next = W[ids[ids.length - 1] + 1];
  const startOk = !prev || pauseNear(prev.end) || pauseNear(first.start) || /[.,?!]$/.test(text(prev.i));
  const endOk = !next || pauseNear(last.end) || pauseNear(next.start) || /[.,?!]$/.test(text(last.i));
  return startOk || endOk;
};
const VOCAB_PLAIN = new Set(VOCAB.map(plain).filter((t) => t.length > 2));
const isRepeat = (ids) => {
  const mine = ids.map((i) => plain(text(i))).filter((t) => t.length > 2 && !STOP.has(t) && !SAFE.has(t));
  if (!mine.length) return true;
  if (mine.length < 2) return false;
  const lo = ids[0], hi = ids[ids.length - 1];
  const around = W.filter((w) => (w.i > hi && w.i <= hi + 40) || (w.i < lo && w.i >= lo - 25)).map((w) => plain(text(w.i))).filter((t) => t.length > 2 && !STOP.has(t) && !SAFE.has(t));
  let best = 0;
  for (let k = 0; k < around.length; k++) {
    let m = 0, j = k;
    for (const t of mine) { while (j < around.length && j - k < mine.length * 2 && around[j] !== t) j++; if (around[j] === t) { m++; j++; } }
    best = Math.max(best, m);
  }
  return best >= 2 && best / mine.length >= 0.6;
};
let budget = Math.floor(W.length * 0.25) - cut.size;
for (const c of (ai.cuts || []).sort((a, b) => (a.to - a.from) - (b.to - b.from))) {
  if (!valid(c.from) || !valid(c.to) || c.to < c.from || c.to - c.from > 35) continue;
  let from = c.from;
  while (from > 0 && CONNECT.has(plain(text(from - 1))) && !/[.?!,]$/.test(text(from - 1)) && !cut.has(from - 1)) from--;
  const ids = []; for (let i = from; i <= c.to; i++) if (!cut.has(i)) ids.push(i);
  if (!ids.length || ids.some((i) => firstSentence.has(i) || keep.has(i) || inQuestion.has(i)) || ids.length > budget) continue;
  const content = ids.map((i) => plain(text(i))).filter((t) => t.length > 2 && !STOP.has(t) && !SAFE.has(t));
  if (ids.some((i) => VOCAB_PLAIN.has(plain(text(i))) || NEGATION.has(plain(text(i)))) && !isRepeat(ids)) { console.log(`  rejected AI cut (would drop a tool name or a negation): ${ids.map(text).join(' ')}`); continue; }
  if (ids.length >= 5 && !isRepeat(ids) && content.length / ids.length > 0.4) { console.log(`  rejected AI cut (not a repeat, too much content): ${ids.map(text).join(' ')}`); continue; }
  if (!isRepeat(ids) && !cleanEdges(ids)) { console.log(`  rejected AI cut (mid-phrase, no pause to cut on): ${ids.map(text).join(' ')}`); continue; }
  if (ids.length <= 2) {
    if (!ids.every((i) => SAFE.has(plain(text(i))))) continue;
    const prev = W[ids[0] - 1], next = W[ids[ids.length - 1] + 1];
    const gapAfter = next ? next.start - W[ids[ids.length - 1]].end : 1, gapBefore = prev ? W[ids[0]].start - prev.end : 1;
    if (gapAfter < 0.15 && gapBefore < 0.15) continue;
  }
  budget -= ids.length;
  addCut(ids, c.reason, 'ai');
}

// leftovers: a short run of filler stranded inside a sentence after a cut goes too
for (const sen of S) {
  let run = [];
  const flush = () => {
    const touching = run.length && (cut.has(run[0] - 1) || cut.has(run[run.length - 1] + 1));
    const content = run.map((i) => plain(text(i))).filter((t) => t.length > 2 && !STOP.has(t) && !SAFE.has(t) && !CONNECT.has(t));
    if (touching && run.length <= 7 && content.length === 0 && !run.some((i) => protect.has(i) || keep.has(i) || inQuestion.has(i) || NEGATION.has(plain(text(i))))) addCut([...run], 'leftover filler next to a cut', 'rule');
    run = [];
  };
  for (const i of sen.ids) { if (cut.has(i)) flush(); else run.push(i); }
  flush();
}

// ---------- apply ----------
stage('Applying');
const prevAutoStrikes = new Set(edit.autoStrikes || []);
const manualStrikes = (edit.strikes || []).filter((i) => !prevAutoStrikes.has(i));
const autoStrikes = [...cut.keys()].filter((i) => !manualStrikes.includes(i));
edit.strikes = [...new Set([...manualStrikes, ...autoStrikes])].sort((a, b) => a - b);
edit.autoStrikes = autoStrikes;
edit.fixes = fixes;
edit.autoFixes = autoFixed;
const keptFirst = (i) => { while (valid(i) && edit.strikes.includes(i)) i++; return i; };
const strong = (i) => { let j = i; while (valid(j + 1) && j - i < 3 && (STOP.has(plain(text(j))) || edit.strikes.includes(j))) j++; return j; };
const emph = [...new Set((struct.emphasis || []).filter(valid).map(strong))].filter((i) => !STOP.has(plain(text(i)))).slice(0, 5);
if (!edit.emphasisManual) edit.emphasis = emph;
const manualCards = (edit.cards || []).filter((c) => !c.auto);
const cards = [...manualCards];
if (items.length >= 3 && !manualCards.some((c) => c.type === 'checklist')) {
  const cname = (struct.checklist.name || '').toUpperCase();
  cards.push({ type: 'checklist', auto: true, name: !cname || cname.split(/\s+/).length < 2 || items.some((x) => x.title.toUpperCase() === cname) ? 'CHECKLIST' : cname, word: null, items });
  decisions.push({ kind: 'card', words: items.map((x) => x.word), text: `Checklist "${struct.checklist.name}" with ${items.length} items`, source: 'ai' });
}
if (!valid(struct.hookQuestion) || W[struct.hookQuestion].start >= 20) {
  const q = S.find((x) => x.start < 15 && /\?$/.test(x.text) && x.ids.length <= 8 && x.ids.length >= 3);
  if (q) struct.hookQuestion = q.ids[q.ids.length - 1];
}
if (valid(struct.hookQuestion) && !inList(struct.hookQuestion) && W[struct.hookQuestion].start < 20) {
  const q = S.find((s) => s.ids.includes(struct.hookQuestion));
  const qi = q.ids.filter((i) => !cut.has(i) && i <= struct.hookQuestion);
  let from = 0;
  qi.forEach((i, n) => { if (n < qi.length - 2 && (/,$/.test(text(i)) || /^(pero|and|so|kasi|tapos)$/i.test(plain(text(i))))) from = n + 1; });
  const qt = qi.slice(from).map(text).join(' ').replace(/^(so|and|pero),?\s+/i, '');
  if (qt.split(/\s+/).length <= 6) {
    cards.push({ type: 'callout', auto: true, word: keptFirst(qi[from]), text: qt.toUpperCase(), tone: 'pink' });
    decisions.push({ kind: 'card', words: [q.ids[0]], text: `Hook callout "${qt}"`, source: 'ai' });
  }
}
for (const c of (struct.callouts || []).slice(0, 2)) {
  if (!valid(c.word) || c.text.split(/\s+/).length > 5 || inList(c.word) || cards.some((x) => x.type === 'callout' && Math.abs(W[x.word].start - W[c.word].start) < 6)) continue;
  cards.push({ type: 'callout', auto: true, word: keptFirst(c.word), text: c.text.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim().toUpperCase(), tone: 'teal' });
  decisions.push({ kind: 'card', words: [c.word], text: `Callout "${c.text}"`, source: 'ai' });
}
edit.cards = cards.sort((a, b) => (a.word ?? a.items?.[0]?.word ?? 0) - (b.word ?? b.items?.[0]?.word ?? 0));
const EXAMPLES = ['invisible ang vibe-coded website mo', 'vibe-coded app mo, production-ready na ba'];
const fixTitle = (t) => {
  let title = t.title.trim(), kicker = (t.kicker || '').replace(/[{}]/g, '').trim();
  if (title === title.toUpperCase()) title = title.charAt(0) + title.slice(1).toLowerCase();
  if (!/\[.+\]/.test(title)) {
    const w = title.replace(/[^\p{L}0-9 -]/gu, '').split(/\s+/).filter((x) => x.length > 4 && !STOP.has(plain(x))).sort((a, b) => b.length - a.length)[0];
    if (w) title = title.replace(w, `[${w}]`);
  }
  return { title, kicker: kicker ? `{${kicker}}` : '' };
};
const titles = (struct.titles || []).map(fixTitle).filter((t) => t.title.split(/\s+/).length <= 9 && !EXAMPLES.some((x) => plain(t.title.replace(/[[\]{}]/g, '')).startsWith(plain(x).slice(0, 18)))).slice(0, 5);
edit.suggestions = { ...(edit.suggestions || {}), model: MODEL, titles };
if (!edit.title?.title?.trim() && titles[0]) edit.title = { ...titles[0], auto: true };
edit.autoedit = { at: new Date().toISOString(), model: MODEL, decisions, raw: struct };
writeFileSync(editPath, JSON.stringify(edit, null, 1));
const nc = decisions.filter((d) => d.kind === 'cut');
stage(`Auto edit done: ${nc.reduce((s, d) => s + d.words.length, 0)} words cut in ${nc.length} places, ${autoFixed.length} words fixed, ${cards.length - manualCards.length} cards, ${emph.length} punch-ins`);
