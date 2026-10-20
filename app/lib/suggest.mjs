#!/usr/bin/env node
// Ask a local Ollama model for edit suggestions and store them in edit.json under "suggestions".
//   node app/lib/suggest.mjs <project-dir> [model]
// Nothing is applied automatically; the app shows each suggestion with an Apply button.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const proj = resolve(process.argv[2]);
const model = process.argv[3] || process.env.SC_MODEL || 'qwen3:14b';
const editPath = join(proj, 'edit.json');
const edit = JSON.parse(readFileSync(editPath, 'utf8'));
const words = edit.words;
const transcript = words.map((w) => `[${w.i}]${edit.fixes?.[w.i] ?? w.text}`).join(' ');

const schema = {
  type: 'object',
  properties: {
    titles: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, kicker: { type: 'string' } }, required: ['title', 'kicker'] } },
    cuts: { type: 'array', items: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' }, reason: { type: 'string' } }, required: ['from', 'to', 'reason'] } },
    emphasis: { type: 'array', items: { type: 'integer' } },
    checklist: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { word: { type: 'integer' }, title: { type: 'string' }, sub: { type: 'string' } }, required: ['word', 'title', 'sub'] } },
      },
      required: ['name', 'items'],
    },
    callouts: { type: 'array', items: { type: 'object', properties: { word: { type: 'integer' }, text: { type: 'string' }, tone: { type: 'string', enum: ['teal', 'red', 'green', 'pink'] } }, required: ['word', 'text', 'tone'] } },
  },
  required: ['titles', 'cuts', 'emphasis', 'checklist', 'callouts'],
};

const system = `You are a short-form video editor for spaghettiCode, a Filipino dev creator who talks in Taglish.
You get a word-level transcript where every word has an index in brackets. Return JSON only.
- titles: 5 catchy Taglish titles for the opening card, max 7 words each. Wrap ONE key word in [brackets] to color it pink. kicker: 2-3 word punchy follow-up like "Ayusin natin." or "Check natin." wrapped in {braces}.
- cuts: word index ranges (inclusive) to REMOVE: restarted sentences (the speaker says the same idea twice in a row: cut the first attempt), stuttered repeated words, asides that add nothing, and "So, yun lang" style outros at the very end. Never cut the opening sentence. Never cut a word that carries meaning. Do not bother cutting single filler words like "So".
- emphasis: exactly 3 to 6 word indices where the speaker lands a strong point (camera punch-in): the problem in the hook, the key question, and the final takeaway. Point at the strongest content word, never at so/and/dapat/na.
- checklist: if the speaker lists items (fixes, steps, tips), give a short UPPERCASE name and one item per listed thing: word = index of the word where the item's name is spoken (e.g. the index of "Error" in "Error handling"), include EVERY item they list, title = 2-4 word label in the speaker's language, sub = one short line summarizing what they said about it (max 45 chars). If there is no list, return name "" and no items.
- callouts: 0-3 short punchy on-screen texts (max 4 words) for key moments outside the list, anchored to a word index.
Use only indices that exist. Do not invent facts the speaker did not say.`;

const res = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model, stream: false, think: process.env.SC_THINK === '1', format: schema,
    options: { temperature: 0.3, num_ctx: 16384 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: `Transcript:\n${transcript}` }],
  }),
}).catch((e) => { console.error(`Could not reach Ollama at localhost:11434 (${e.message}). Start it with: ollama serve`); process.exit(2); });
if (!res.ok) { console.error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(3); }
const body = await res.json();
let s;
try { s = JSON.parse(body.message.content); } catch { console.error('Model did not return valid JSON.'); process.exit(4); }

const valid = (i) => Number.isInteger(i) && i >= 0 && i < words.length;
const firstSentenceEnd = words.findIndex((w) => /[.?!]$/.test(w.text));
const STOP = /^(so|and|at|na|ng|dapat|yung|ang|sa|mo|para|pero|then|of|the)$/i;
const plain = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const snap = (i, label) => {
  const keys = label.toLowerCase().split(/[^a-z0-9]+/).filter((k) => k.length > 2);
  for (let d = 0; d <= 10; d++) for (const j of [i + d, i - d]) {
    const w = words[j];
    if (w && keys.some((k) => plain(w.text).startsWith(k.slice(0, 5)) || k.startsWith(plain(w.text).slice(0, 5)) && plain(w.text).length > 3)) return j;
  }
  return i;
};
const sug = {
  model,
  titles: (s.titles || []).slice(0, 6),
  cuts: (s.cuts || []).filter((c) => valid(c.from) && valid(c.to) && c.to >= c.from && c.to - c.from < 40 && c.from > firstSentenceEnd && !words.slice(c.from, c.to + 1).some((w) => /\?$/.test(w.text)))
    .map((c) => ({ ...c, text: words.slice(c.from, c.to + 1).map((w) => w.text).join(' ') })),
  emphasis: [...new Set((s.emphasis || []).filter(valid).map((i) => (STOP.test(plain(words[i].text)) && words[i + 1] ? i + 1 : i)))].slice(0, 6),
  checklist: s.checklist?.items?.length ? { name: s.checklist.name || 'CHECKLIST', items: s.checklist.items.filter((x) => valid(x.word)).map((x) => ({ ...x, word: snap(x.word, x.title) })).sort((a, b) => a.word - b.word) } : null,
  callouts: (s.callouts || []).filter((c) => valid(c.word)).map((c) => ({ ...c, text: c.text.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim() })),
};
const fresh = JSON.parse(readFileSync(editPath, 'utf8'));
fresh.suggestions = sug;
writeFileSync(editPath, JSON.stringify(fresh, null, 1));
console.log(`STAGE: ${model}: ${sug.titles.length} titles, ${sug.cuts.length} cuts, ${sug.emphasis.length} emphasis, ${sug.checklist?.items.length || 0} checklist items, ${sug.callouts.length} callouts`);
