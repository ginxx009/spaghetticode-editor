const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
};

const S = { slug: null, edit: null, sel: null, job: null, poll: null, saveT: null, ranges: [] };
const video = $('#video');

// ---------- projects ----------
async function loadProjects() {
  const list = await api('/api/projects');
  $('#projects').innerHTML = list.map((p) => `<div class="proj ${p.slug === S.slug ? 'on' : ''}" data-slug="${p.slug}"><b>${esc(p.title?.replace(/[[\]{}|]/g, '') || p.name || p.slug)}</b><small>${p.job?.running ? '⏳ ' + esc(p.job.stage) : p.ready ? `${p.renders.length} render(s)` : 'not prepared'}</small></div>`).join('') || '<p class="muted">No videos yet.</p>';
  $$('.proj').forEach((el) => (el.onclick = () => openProject(el.dataset.slug)));
}

async function upload(file) {
  $('#status').textContent = `Uploading ${file.name}…`;
  const r = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}${$('#autoUpload').checked ? `&auto=1&model=${encodeURIComponent($('#model').value || 'qwen3:14b')}` : ''}`, { method: 'POST', body: file });
  const { slug, error } = await r.json();
  if (error) return ($('#status').textContent = error);
  $('#status').textContent = '';
  await loadProjects();
  openProject(slug);
}
const drop = $('#drop');
$('#file').onchange = (e) => e.target.files[0] && upload(e.target.files[0]);
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); });

// ---------- open ----------
async function openProject(slug) {
  S.slug = slug; S.sel = null;
  const { edit, job } = await api(`/api/p/${slug}`);
  S.edit = edit; S.job = job;
  $('#empty').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  loadProjects();
  showJob(job);
  if (job?.running) startPoll();
  if (!edit.words) { $('#transcript').innerHTML = '<p class="muted">Preparing… color fix, transcription, pauses, face tracking. This takes about a minute.</p>'; video.removeAttribute('src'); return; }
  video.src = `/files/${slug}/assets/raw.mp4`;
  $('#title').value = edit.title?.title || '';
  $('#kicker').value = edit.title?.kicker || '';
  buildTranscript();
  renderCards(); renderAI(); renderRenders(); renderTitleSugs(); renderDecisions(); renderQA();
}

// ---------- transcript ----------
const strikes = () => new Set(S.edit.strikes || []);
function buildTranscript() {
  $('#transcript').innerHTML = S.edit.words.map((w) => `<span class="w" data-i="${w.i}">${esc(S.edit.fixes?.[w.i] ?? w.text)}</span>`).join(' ');
  $$('#transcript .w').forEach((el) => {
    el.onclick = (e) => {
      const i = Number(el.dataset.i);
      if (e.shiftKey && S.sel) S.sel = { a: Math.min(S.sel.a, i), b: Math.max(S.sel.b, i) };
      else { S.sel = { a: i, b: i }; video.currentTime = Math.max(0, S.edit.words[i].start - 0.05); }
      refreshWords();
    };
    el.ondblclick = () => fixWord(Number(el.dataset.i));
  });
  refreshWords();
}
function suggestedSet() {
  const s = new Set();
  for (const c of S.edit.suggestedCuts || []) c.words.forEach((i) => s.add(i));
  for (const c of S.edit.suggestions?.cuts || []) for (let i = c.from; i <= c.to; i++) s.add(i);
  return s;
}
function anchorSet() {
  const s = new Set();
  for (const c of S.edit.cards || []) {
    [c.word, ...(c.items || []).map((x) => x.word), ...(c.steps || []).map((x) => x.word), ...(c.groups || []).flatMap((g) => g.items.map((x) => x.word)), ...(c.rows || []).flatMap((r) => [r.word, ...(r.changes || []).map((x) => x.word)])].forEach((i) => i != null && s.add(i));
  }
  return s;
}
function refreshWords() {
  const st = strikes(), sug = suggestedSet(), em = new Set(S.edit.emphasis || []), anc = anchorSet();
  const reasons = new Map();
  for (const d of S.edit.autoedit?.decisions || []) for (const i of d.words) reasons.set(i, d.kind === 'fix' ? `Fixed: "${d.from}" → "${d.to}"` : d.kind === 'cut' ? `Cut (${d.source}): ${d.reason}` : d.text);
  for (const el of $$('#transcript .w')) {
    const i = Number(el.dataset.i);
    const hl = S.edit.highlights?.[i];
    el.title = reasons.get(i) || '';
    el.className = 'w' + (st.has(i) ? ' cut' : '') + (sug.has(i) && !st.has(i) ? ' sug' : '') + (em.has(i) ? ' emph' : '') + (hl ? ` hl-${hl}` : '') + (S.edit.fixes?.[i] != null ? ' fixed' : '') + (anc.has(i) ? ' anchor' : '') + (S.sel && i >= S.sel.a && i <= S.sel.b ? ' sel' : '');
    el.textContent = S.edit.fixes?.[i] ?? S.edit.words[i].text;
  }
  computeRanges();
}
function computeRanges() {
  const st = strikes(), W = S.edit.words;
  const kept = W.filter((w) => !st.has(w.i));
  const r = [];
  if (kept.length) { r.push([0, Math.max(0, kept[0].start - 0.25)]); r.push([kept[kept.length - 1].end + 0.3, 1e9]); }
  let run = null;
  for (const w of W) {
    if (st.has(w.i)) { run = run || { first: w }; run.last = w; continue; }
    if (run) {
      const prev = [...kept].reverse().find((k) => k.end <= run.first.start + 0.05);
      r.push([prev ? prev.end : 0, w.start]);
      run = null;
    }
  }
  S.ranges = r.filter(([a, b]) => b > a + 0.02).sort((a, b) => a[0] - b[0]);
  const removed = S.ranges.reduce((s, [a, b]) => s + Math.min(b, S.edit.media.duration) - a, 0);
  $('#cutInfo').textContent = `${st.size} words cut · about ${Math.round(S.edit.media.duration - removed)}s before pause tightening`;
}
(function tick() {
  if (S.edit?.words && !video.paused) {
    const t = video.currentTime;
    if ($('#skipCuts').checked) { const r = S.ranges.find(([a, b]) => t >= a && t < b - 0.01); if (r) video.currentTime = Math.min(r[1], video.duration || r[1]); }
    const w = S.edit.words.find((x) => t >= x.start && t < x.end + 0.05);
    $$('#transcript .w.now').forEach((el) => el.classList.remove('now'));
    if (w) { const el = $(`#transcript .w[data-i="${w.i}"]`); el?.classList.add('now'); }
  }
  requestAnimationFrame(tick);
})();

// ---------- actions ----------
function act(a) {
  if (!S.edit?.words || !S.sel) return;
  const ids = []; for (let i = S.sel.a; i <= S.sel.b; i++) ids.push(i);
  const e = S.edit;
  if (a === 'cut') e.strikes = [...new Set([...(e.strikes || []), ...ids])];
  if (a === 'keep') e.strikes = (e.strikes || []).filter((i) => !ids.includes(i));
  if (a === 'emph') { const set = new Set(e.emphasis || []); set.has(S.sel.a) ? set.delete(S.sel.a) : set.add(S.sel.a); e.emphasis = [...set]; }
  if (a.startsWith('hl-')) { e.highlights = e.highlights || {}; ids.forEach((i) => { if (a === 'hl-none') delete e.highlights[i]; else e.highlights[i] = a.slice(3); }); }
  if (a === 'fix') return fixWord(S.sel.a);
  refreshWords(); save();
}
function fixWord(i) {
  const cur = S.edit.fixes?.[i] ?? S.edit.words[i].text;
  const v = prompt(`Caption text for "${S.edit.words[i].text}" (empty = original)`, cur);
  if (v == null) return;
  S.edit.fixes = S.edit.fixes || {};
  if (!v.trim() || v === S.edit.words[i].text) delete S.edit.fixes[i]; else S.edit.fixes[i] = v.trim();
  refreshWords(); save();
}
$$('.toolbar button').forEach((b) => (b.onclick = () => act(b.dataset.act)));
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  const map = { x: 'cut', Delete: 'cut', Backspace: 'cut', k: 'keep', e: 'emph', 1: 'hl-teal', 2: 'hl-red', 3: 'hl-green', 0: 'hl-none', f: 'fix' };
  if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); return; }
  if (map[e.key]) { e.preventDefault(); act(map[e.key]); }
});

function save() {
  clearTimeout(S.saveT);
  S.saveT = setTimeout(async () => {
    const e = S.edit;
    await api(`/api/p/${S.slug}/save`, { method: 'POST', body: JSON.stringify({ strikes: e.strikes, fixes: e.fixes, emphasis: e.emphasis, highlights: e.highlights, title: e.title, cards: e.cards, suggestedCuts: e.suggestedCuts, suggestions: e.suggestions }) });
    $('#status').textContent = 'Saved ' + new Date().toLocaleTimeString();
  }, 500);
}

// ---------- tabs ----------
$$('.tabs button').forEach((b) => (b.onclick = () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
}));

// ---------- title ----------
['title', 'kicker'].forEach((id) => ($('#' + id).oninput = () => { S.edit.title = { title: $('#title').value, kicker: $('#kicker').value }; save(); }));
function renderTitleSugs() {
  const t = S.edit.suggestions?.titles || [];
  $('#titleSugs').innerHTML = t.length ? '<label>AI title ideas</label>' + t.map((x, k) => `<div class="sug" data-k="${k}">${esc(x.title)} <small>— ${esc(x.kicker)}</small></div>`).join('') : '<p class="muted">Run AI suggest for title ideas.</p>';
  $$('#titleSugs .sug').forEach((el) => (el.onclick = () => { const x = t[el.dataset.k]; $('#title').value = x.title; $('#kicker').value = x.kicker; S.edit.title = { ...x }; save(); }));
}

// ---------- cards ----------
const wordLabel = (i) => (i == null ? 'not set' : `#${i} “${esc(S.edit.fixes?.[i] ?? S.edit.words[i]?.text ?? '?')}”`);
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], obj)[last] = v; };
function newCard(type, word) {
  if (type === 'checklist') return { type, name: 'CHECKLIST', word, items: [] };
  if (type === 'status') return { type, word, rows: [{ label: 'localhost:3000', state: 'ok', text: 'Works', word }, { label: 'production', state: 'wait', text: 'deploying…', word: null, changes: [] }] };
  if (type === 'chips') return { type, word, groups: [{ label: 'ALAM NG AI', tone: 'good', items: [] }, { label: 'HINDI ALAM', tone: 'bad', items: [] }] };
  if (type === 'tip') return { type, word, badge: 'EXTRA TIP', name: '', sub: '', steps: [] };
  return { type: 'callout', word, text: '', tone: 'teal' };
}
$('#addCard').onclick = () => {
  if (!S.sel) return alert('Click the word where the card should appear first.');
  S.edit.cards = [...(S.edit.cards || []), newCard($('#newCard').value, S.sel.a)];
  S.edit.cards.sort((a, b) => (a.word ?? 0) - (b.word ?? 0));
  renderCards(); refreshWords(); save();
};
function field(path, label, value, opts = {}) {
  if (opts.select) return `<label>${label}<select data-path="${path}">${opts.select.map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  return `<label>${label}<input data-path="${path}" value="${esc(value)}" placeholder="${esc(opts.ph || '')}"></label>`;
}
const anchor = (path, label = 'Appears at') => `<div class="row"><span class="muted">${label}: ${wordLabel(getPath(S.edit, path))}</span><button class="anchor-btn" data-anchor="${path}">◎ use selected word</button></div>`;
function renderCards() {
  const cards = S.edit.cards || [];
  $('#cards').innerHTML = cards.length ? cards.map((c, k) => {
    const P = `cards.${k}`;
    let body = '';
    if (c.type === 'checklist') {
      body = field(`${P}.name`, 'Counter label', c.name) + anchor(`${P}.word`, 'Counter appears') + (c.items || []).map((x, n) => `<div class="item"><span class="muted">${n + 1}</span><span class="muted">${wordLabel(x.word)}</span><button class="x" data-del="${P}.items.${n}">✕</button><div class="full">${field(`${P}.items.${n}.title`, '', x.title, { ph: 'Title' })}</div><div class="full">${field(`${P}.items.${n}.sub`, '', x.sub, { ph: 'One-line summary' })}</div><div class="full"><button class="anchor-btn" data-anchor="${P}.items.${n}.word">◎ move to selected word</button></div></div>`).join('') + `<button data-add="${P}.items">+ Item at selected word</button>`;
    } else if (c.type === 'status') {
      body = anchor(`${P}.word`) + (c.rows || []).map((r, j) => `<div class="item"><span class="muted">row</span>${field(`${P}.rows.${j}.label`, '', r.label, { ph: 'label' })}<button class="x" data-del="${P}.rows.${j}">✕</button><div class="full row">${field(`${P}.rows.${j}.state`, '', r.state, { select: ['ok', 'wait', 'bad'] })}${field(`${P}.rows.${j}.text`, '', r.text, { ph: 'text' })}</div><div class="full">${anchor(`${P}.rows.${j}.word`, 'Row appears')}</div>${(r.changes || []).map((ch, n) => `<div class="full row"><span class="muted">→ at ${wordLabel(ch.word)}</span>${field(`${P}.rows.${j}.changes.${n}.state`, '', ch.state, { select: ['ok', 'wait', 'bad'] })}${field(`${P}.rows.${j}.changes.${n}.text`, '', ch.text)}<button class="x" data-del="${P}.rows.${j}.changes.${n}">✕</button></div>`).join('')}<div class="full"><button data-add="${P}.rows.${j}.changes">+ Change state at selected word</button></div></div>`).join('') + `<button data-add="${P}.rows">+ Row</button>`;
    } else if (c.type === 'chips') {
      body = anchor(`${P}.word`) + (c.groups || []).map((g, j) => `<div class="item"><span class="muted">group</span>${field(`${P}.groups.${j}.label`, '', g.label)}<button class="x" data-del="${P}.groups.${j}">✕</button><div class="full">${field(`${P}.groups.${j}.tone`, 'Tone', g.tone, { select: ['good', 'bad'] })}</div>${g.items.map((x, n) => `<div class="full row"><span class="muted">${wordLabel(x.word)}</span>${field(`${P}.groups.${j}.items.${n}.text`, '', x.text)}<button class="x" data-del="${P}.groups.${j}.items.${n}">✕</button></div>`).join('')}<div class="full"><button data-add="${P}.groups.${j}.items">+ Chip at selected word</button></div></div>`).join('') + `<button data-add="${P}.groups">+ Group</button>`;
    } else if (c.type === 'tip') {
      body = anchor(`${P}.word`) + field(`${P}.badge`, 'Badge', c.badge) + field(`${P}.name`, 'Name', c.name, { ph: 'Playwright' }) + field(`${P}.sub`, 'Subtitle', c.sub) + (c.steps || []).map((s, n) => `<div class="row"><span class="muted">${wordLabel(s.word)}</span>${field(`${P}.steps.${n}.text`, '', s.text)}<button class="x" data-del="${P}.steps.${n}">✕</button></div>`).join('') + `<button data-add="${P}.steps">+ Step at selected word</button>`;
    } else {
      body = anchor(`${P}.word`) + field(`${P}.text`, 'Text', c.text) + field(`${P}.tone`, 'Color', c.tone, { select: ['teal', 'red', 'green', 'pink'] });
    }
    return `<div class="card"><h4>${c.type}<button class="x" data-del="cards.${k}">Delete</button></h4>${anchor(`${P}.endWord`, 'Ends at (optional)')}${body}</div>`;
  }).join('') : '<p class="muted">No cards yet. Select a word in the transcript, pick a card type, and click Add. Or use AI suggest.</p>';
  $$('#cards [data-path]').forEach((el) => (el.oninput = el.onchange = () => { setPath(S.edit, el.dataset.path, el.value); save(); }));
  $$('#cards [data-anchor]').forEach((el) => (el.onclick = () => { if (!S.sel) return alert('Select a word first.'); setPath(S.edit, el.dataset.anchor, S.sel.a); renderCards(); refreshWords(); save(); }));
  $$('#cards [data-del]').forEach((el) => (el.onclick = () => { const ks = el.dataset.del.split('.'); const idx = Number(ks.pop()); getPath(S.edit, ks.join('.')).splice(idx, 1); renderCards(); refreshWords(); save(); }));
  $$('#cards [data-add]').forEach((el) => (el.onclick = () => {
    const path = el.dataset.add, arr = getPath(S.edit, path) || [], w = S.sel?.a ?? null, txt = w != null ? (S.edit.fixes?.[w] ?? S.edit.words[w].text).replace(/[.,?!]+$/, '') : '';
    const kind = path.split('.').pop();
    const needWord = ['items', 'changes', 'steps'].includes(kind) || /groups\.\d+\.items$/.test(path);
    if (needWord && w == null) return alert('Select a word first.');
    const item = kind === 'items' && !/groups/.test(path) ? { word: w, title: txt, sub: '' } : kind === 'changes' ? { word: w, state: 'bad', text: '' } : kind === 'steps' ? { word: w, text: txt } : kind === 'rows' ? { label: '', state: 'ok', text: '', word: w, changes: [] } : kind === 'groups' ? { label: '', tone: 'good', items: [] } : { word: w, text: txt };
    arr.push(item);
    if (['items', 'steps'].includes(kind)) arr.sort((a, b) => (a.word ?? 0) - (b.word ?? 0));
    setPath(S.edit, path, arr); renderCards(); refreshWords(); save();
  }));
}

// ---------- AI ----------
async function loadModels() {
  const models = await api('/api/models').catch(() => []);
  $('#model').innerHTML = models.length ? models.map((m) => `<option ${m === 'qwen3:14b' ? 'selected' : ''}>${m}</option>`).join('') : '<option value="">Ollama not running</option>';
}
$('#suggest').onclick = async () => {
  try { await api(`/api/p/${S.slug}/suggest`, { method: 'POST', body: JSON.stringify({ model: $('#model').value, think: $('#think').checked }) }); startPoll(); } catch (e) { alert(e.message); }
};
function renderAI() {
  const s = S.edit.suggestions;
  if (!s) { $('#aiOut').innerHTML = (S.edit.suggestedCuts || []).length ? aiRepeats() : ''; bindAI(); return; }
  const w = (i) => esc(S.edit.words[i]?.text);
  $('#aiOut').innerHTML = `
  <div class="ai-block"><h4>Cuts (${s.cuts.length})<button data-ai="cuts">Apply all</button></h4>${s.cuts.map((c, k) => `<div class="ai-line"><span><s>${esc(c.text)}</s><br><small class="muted">${esc(c.reason)}</small></span><button data-ai="cut" data-k="${k}">Apply</button></div>`).join('')}</div>
  ${aiRepeats()}
  <div class="ai-block"><h4>Punch-ins (${s.emphasis.length})<button data-ai="emph">Apply</button></h4><div class="muted">${s.emphasis.map(w).join(' · ')}</div></div>
  ${s.checklist ? `<div class="ai-block"><h4>Checklist: ${esc(s.checklist.name)}<button data-ai="checklist">Add card</button></h4>${s.checklist.items.map((x) => `<div class="ai-line"><span><b>${esc(x.title)}</b> <small class="muted">@ ${w(x.word)}</small><br><small class="muted">${esc(x.sub)}</small></span></div>`).join('')}</div>` : ''}
  <div class="ai-block"><h4>Callouts (${s.callouts.length})</h4>${s.callouts.map((c, k) => `<div class="ai-line"><span>${esc(c.text)} <small class="muted">@ ${w(c.word)}</small></span><button data-ai="callout" data-k="${k}">Add</button></div>`).join('')}</div>
  <p class="muted">Titles are in the Title tab. Model: ${esc(s.model)}</p>`;
  bindAI();
}
function aiRepeats() {
  const r = S.edit.suggestedCuts || [];
  return r.length ? `<div class="ai-block"><h4>Repeated words (${r.length})<button data-ai="repeats">Cut all</button></h4>${r.map((c) => `<div class="ai-line"><span>${esc(c.reason)}</span></div>`).join('')}</div>` : '';
}
function bindAI() {
  $$('#aiOut [data-ai]').forEach((b) => (b.onclick = () => {
    const s = S.edit.suggestions, e = S.edit, k = Number(b.dataset.k);
    const addCut = (c) => { for (let i = c.from; i <= c.to; i++) e.strikes = [...new Set([...(e.strikes || []), i])]; };
    if (b.dataset.ai === 'cuts') s.cuts.forEach(addCut);
    if (b.dataset.ai === 'cut') addCut(s.cuts[k]);
    if (b.dataset.ai === 'repeats') (e.suggestedCuts || []).forEach((c) => c.words.forEach((i) => addCut({ from: i, to: i })));
    if (b.dataset.ai === 'emph') e.emphasis = [...new Set([...(e.emphasis || []), ...s.emphasis])];
    if (b.dataset.ai === 'checklist') { e.cards = [...(e.cards || []), { type: 'checklist', name: s.checklist.name, word: null, items: s.checklist.items }]; renderCards(); }
    if (b.dataset.ai === 'callout') { const c = s.callouts[k]; e.cards = [...(e.cards || []), { type: 'callout', word: c.word, text: c.text, tone: c.tone }]; renderCards(); }
    b.disabled = true; b.textContent = '✓';
    refreshWords(); save();
  }));
}

// ---------- auto edit ----------
$('#autoedit').onclick = async () => {
  if ((S.edit.strikes || []).length > 3 && !confirm('Auto edit replaces earlier automatic cuts, fixes and AI cards. Your own cuts and cards stay. Continue?')) return;
  try { await api(`/api/p/${S.slug}/autoedit`, { method: 'POST', body: JSON.stringify({ model: $('#model').value }) }); startPoll(); } catch (e) { alert(e.message); }
};
function renderDecisions() {
  const a = S.edit.autoedit;
  if (!a) { $('#decisions').innerHTML = ''; return; }
  const ds = a.decisions;
  const icon = { cut: '✂', fix: '✎', card: '▣' };
  const live = (d) => d.kind === 'cut' ? d.words.some((i) => (S.edit.strikes || []).includes(i)) : d.kind === 'fix' ? d.words.some((i) => S.edit.fixes?.[i] != null) : true;
  $('#decisions').innerHTML = `<div class="dec-h"><b>${ds.filter((d) => d.kind === 'cut').length} cuts · ${ds.filter((d) => d.kind === 'fix').length} fixes · ${ds.filter((d) => d.kind === 'card').length} cards</b><small class="muted">${esc(a.model)} · ${new Date(a.at).toLocaleTimeString()}</small></div>` +
    ds.map((d, k) => `<div class="dec ${live(d) ? '' : 'undone'}" data-k="${k}"><span class="k">${icon[d.kind]}</span><span>${d.kind === 'cut' ? `<s>${esc(d.text)}</s>` : d.kind === 'fix' ? `${esc(d.from)} → <b>${esc(d.to)}</b>` : esc(d.text)}<br><small>${esc(d.reason || '')}${d.source ? ' · ' + d.source : ''}</small></span>${d.kind !== 'card' ? `<button class="x" data-undo="${k}">${live(d) ? 'Undo' : 'Redo'}</button>` : ''}</div>`).join('');
  $$('#decisions .dec').forEach((el) => (el.onclick = (ev) => {
    const d = ds[el.dataset.k];
    if (ev.target.dataset.undo != null) {
      const e = S.edit;
      if (d.kind === 'cut') e.strikes = live(d) ? (e.strikes || []).filter((i) => !d.words.includes(i)) : [...new Set([...(e.strikes || []), ...d.words])];
      if (d.kind === 'fix') { e.fixes = e.fixes || {}; d.words.forEach((i) => { if (live(d)) delete e.fixes[i]; else e.fixes[i] = d.to === '(merged)' ? '' : d.to; }); }
      refreshWords(); renderDecisions(); save(); return;
    }
    const w = S.edit.words[d.words[0]];
    S.sel = { a: d.words[0], b: d.words[d.words.length - 1] }; refreshWords();
    video.currentTime = Math.max(0, w.start - 1); $(`#transcript .w[data-i="${d.words[0]}"]`)?.scrollIntoView({ block: 'center' });
  }));
}
async function renderQA() {
  const qa = await api(`/api/p/${S.slug}/qa`).catch(() => null);
  if (!qa) { $('#qa').innerHTML = ''; return; }
  $('#qa').innerHTML = `<div class="qa"><b>QA for ${esc(qa.file)}</b>${qa.checks.map((c) => `<div class="${c.level}" ${c.t != null ? `data-t="${c.t}"` : ''}>${c.level === 'ok' ? '✓' : '⚠'} ${esc(c.text)}</div>`).join('')}</div>`;
}

// ---------- render ----------
$('#render').onclick = async () => {
  try { await api(`/api/p/${S.slug}/render`, { method: 'POST', body: JSON.stringify({ quality: $('#quality').value }) }); startPoll(); } catch (e) { alert(e.message); }
};
function renderRenders() {
  const r = [...(S.edit.renders || [])].reverse();
  $('#renders').innerHTML = r.map((x, k) => `<div class="render"><div class="row"><b>${esc(x.file)}</b><a href="/outbox/${encodeURIComponent(x.file)}" download>Download</a></div>${k === 0 ? `<video src="/outbox/${encodeURIComponent(x.file)}" controls></video>` : ''}<small class="muted">${new Date(x.at).toLocaleString()} · in outbox/</small></div>`).join('') || '<p class="muted">Renders appear here and in the outbox folder.</p>';
}

// ---------- jobs ----------
function showJob(job) {
  $('#job').classList.toggle('hidden', !job);
  if (!job) return;
  $('#jobStage').textContent = (job.running ? '⏳ ' : job.error ? '⚠️ ' : '✓ ') + job.stage;
  $('#jobLog').textContent = job.log.filter((l) => !/^\s*[█░]|\[INFO\]|Render:trace|"phase"|^\s*[{}\]]|Fetching \d+ files/.test(l)).slice(-30).join('\n');
  $('#jobLog').scrollTop = 1e9;
  $$('#render, #suggest').forEach((b) => (b.disabled = !!job.running));
}
function startPoll() {
  clearInterval(S.poll);
  const slug = S.slug;
  S.poll = setInterval(async () => {
    if (S.slug !== slug) return clearInterval(S.poll);
    const job = await api(`/api/p/${slug}/job`).catch(() => null);
    showJob(job);
    if (job && !job.running) {
      clearInterval(S.poll);
      const keepSel = S.sel;
      await openProject(slug);
      S.sel = keepSel;
      if (job.name === 'suggest' || job.name === 'autoedit') $$('.tabs button').find((b) => b.dataset.tab === 'ai').click();
      if (job.name === 'render') $$('.tabs button').find((b) => b.dataset.tab === 'render').click();
    }
  }, 1000);
}

loadProjects();
loadModels();
