#!/usr/bin/env node
// spaghettiCode Studio: local editor for reels. No AI agent needed.
//   node app/server.mjs        then open http://localhost:5757
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(APP, '..');
const KIT = join(ROOT, 'kit');
const PROJECTS = join(KIT, 'video-projects');
const OUTBOX = join(ROOT, 'outbox');
const PY = join(ROOT, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const HF = join(KIT, 'node_modules/hyperframes/bin/hyperframes.mjs');
const PORT = Number(process.env.PORT || 5757);
const jobs = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); });
const projDir = (slug) => { if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('bad slug'); return join(PROJECTS, slug); };
const editPath = (slug) => join(projDir(slug), 'edit.json');
const loadEdit = (slug) => JSON.parse(readFileSync(editPath(slug), 'utf8'));
const saveEdit = (slug, e) => writeFileSync(editPath(slug), JSON.stringify(e, null, 1));

function serveFile(req, res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

// ---------- jobs ----------
function runJob(slug, name, steps, onDone) {
  const job = { name, running: true, stage: 'Starting…', log: [], error: null, started: Date.now() };
  jobs.set(slug, job);
  const push = (line) => {
    if (!line.trim()) return;
    job.log.push(line);
    if (job.log.length > 400) job.log.shift();
    const m = line.match(/STAGE: (.*)/);
    if (m) job.stage = m[1];
  };
  (async () => {
    for (const st of steps) {
      if (typeof st === 'function') { try { await st(push); } catch (e) { job.error = e.message; break; } continue; }
      push(`STAGE: ${st.label}`);
      const code = await new Promise((ok) => {
        const p = spawn(st.cmd, st.args, { cwd: st.cwd || ROOT, env: { ...process.env, FORCE_COLOR: '0', ...(st.env || {}) } });
        let buf = '';
        const onData = (d) => { buf += d.toString(); const lines = buf.split(/\r?\n|\r/); buf = lines.pop(); lines.forEach(push); };
        p.stdout.on('data', onData); p.stderr.on('data', onData);
        p.on('close', (c) => { if (buf) push(buf); ok(c); });
        p.on('error', (e) => { push(String(e)); ok(1); });
      });
      if (code !== 0) { job.error = `${st.label} failed (exit ${code}). See log.`; break; }
    }
    job.running = false;
    job.ended = Date.now();
    if (!job.error) { job.stage = onDone?.() || job.stage || 'Done'; }
    else job.stage = job.error;
  })();
  return job;
}

function prepareSteps(slug, source) {
  return [{ label: 'Preparing', cmd: PY, args: [join(APP, 'lib/prepare.py'), projDir(slug), source] }];
}

function autoeditSteps(slug, model) {
  return [{ label: `Auto edit with ${model || 'qwen3:14b'} (about 5 min)`, cmd: process.execPath, args: [join(APP, 'lib/autoedit.mjs'), projDir(slug), model || 'qwen3:14b'] }];
}

function renderSteps(slug, quality) {
  const dir = projDir(slug);
  const e = loadEdit(slug);
  const steps = [
    { label: 'Cutting', cmd: PY, args: [join(APP, 'lib/cut.py'), dir] },
    { label: 'Composing', cmd: process.execPath, args: [join(APP, 'lib/compose.mjs'), dir] },
    { label: 'Mixing sound', cmd: PY, args: [join(APP, 'lib/mix.py'), dir] },
    { label: 'Adding outro', cmd: process.execPath, args: [join(ROOT, 'templates/outro/add-outro.mjs'), dir] },
  ];
  if (e.title?.title?.trim()) {
    const args = [join(ROOT, 'templates/opening/add-opening.mjs'), dir, '--title', e.title.title];
    args.push('--kicker', e.title.kicker || '');
    steps.push({ label: 'Adding opening', cmd: process.execPath, args });
  }
  const n = readdirSync(OUTBOX).filter((f) => f.startsWith(`${slug}-v`) && f.endsWith('.mp4')).length + 1;
  const name = `${slug}-v${n}${quality === 'draft' ? '-draft' : ''}.mp4`;
  steps.push({ label: `Rendering (${quality})`, cmd: process.execPath, args: [HF, 'render', '--quality', quality, '--output', `renders/${name}`], cwd: dir });
  steps.push({ label: 'QA check', cmd: PY, args: [join(APP, 'lib/qa.py'), dir, join(dir, 'renders', name)] });
  steps.push(async (push) => {
    copyFileSync(join(dir, 'renders', name), join(OUTBOX, name));
    const fresh = loadEdit(slug);
    fresh.renders = [...(fresh.renders || []), { file: name, quality, at: new Date().toISOString() }];
    saveEdit(slug, fresh);
    push(`STAGE: Saved outbox/${name}`);
  });
  return steps;
}

// ---------- routes ----------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);

    if (p === '/' || p === '/index.html') return serveFile(req, res, join(APP, 'public/index.html'));
    if (p.startsWith('/static/')) return serveFile(req, res, join(APP, 'public', normalize(p.slice(8)).replace(/^(\.\.[/\\])+/, '')));
    if (p.startsWith('/files/')) {
      const [, , slug, ...rest] = p.split('/');
      return serveFile(req, res, join(projDir(slug), normalize(rest.join('/')).replace(/^(\.\.[/\\])+/, '')));
    }
    if (p.startsWith('/outbox/')) return serveFile(req, res, join(OUTBOX, normalize(p.slice(8)).replace(/^(\.\.[/\\])+/, '')));

    if (p === '/api/projects' && req.method === 'GET') {
      const list = readdirSync(PROJECTS).filter((d) => existsSync(join(PROJECTS, d, 'edit.json'))).map((d) => {
        const e = JSON.parse(readFileSync(join(PROJECTS, d, 'edit.json'), 'utf8'));
        if (!e.app) return null;
        return { slug: d, name: e.name, created: e.created, title: e.title?.title, ready: !!e.words, renders: e.renders || [], job: jobs.get(d) ? { running: jobs.get(d).running, stage: jobs.get(d).stage } : null };
      }).filter(Boolean).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      return send(res, 200, list);
    }

    if (p === '/api/models') {
      const r = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`).then((x) => x.json()).catch(() => ({ models: [] }));
      return send(res, 200, (r.models || []).map((m) => m.name).filter((n) => !/embed/.test(n)));
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const filename = url.searchParams.get('filename') || 'video.mov';
      const base = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';
      const date = new Date().toISOString().slice(0, 10);
      let slug = `${base}-${date}`, k = 2;
      while (existsSync(join(PROJECTS, slug))) slug = `${base}-${date}-${k++}`;
      await new Promise((ok, bad) => {
        const p2 = spawn(process.execPath, [join(KIT, 'scripts/new-video.mjs'), slug], { cwd: KIT });
        p2.on('close', (c) => (c === 0 ? ok() : bad(new Error('new-video failed'))));
      });
      const dir = projDir(slug);
      mkdirSync(join(dir, 'assets'), { recursive: true });
      const source = join(dir, 'assets', `source${extname(filename).toLowerCase() || '.mov'}`);
      await new Promise((ok, bad) => { const ws = createWriteStream(source); req.pipe(ws); ws.on('finish', ok); ws.on('error', bad); });
      saveEdit(slug, { app: true, slug, name: filename, created: new Date().toISOString() });
      const auto = url.searchParams.get('auto') === '1';
      runJob(slug, auto ? 'autoedit' : 'prepare', [...prepareSteps(slug, source), ...(auto ? autoeditSteps(slug, url.searchParams.get('model')) : [])]);
      return send(res, 200, { slug });
    }

    const m = p.match(/^\/api\/p\/([a-z0-9-]+)(?:\/(\w+))?$/);
    if (m) {
      const [, slug, action] = m;
      if (!existsSync(editPath(slug))) return send(res, 404, { error: 'no project' });
      const job = jobs.get(slug);
      const jobInfo = job ? { name: job.name, running: job.running, stage: job.stage, error: job.error, log: job.log.slice(-80) } : null;
      if (!action && req.method === 'GET') return send(res, 200, { edit: loadEdit(slug), job: jobInfo });
      if (action === 'job') return send(res, 200, jobInfo);
      if (job?.running && action !== 'save') return send(res, 409, { error: `Busy: ${job.stage}` });
      if (action === 'save' && req.method === 'POST') {
        const patch = JSON.parse(await readBody(req));
        const e = loadEdit(slug);
        for (const k of ['strikes', 'fixes', 'emphasis', 'highlights', 'title', 'cards', 'suggestedCuts', 'suggestions']) if (k in patch) e[k] = patch[k];
        saveEdit(slug, e);
        return send(res, 200, { ok: true });
      }
      if (action === 'suggest' && req.method === 'POST') {
        const { model, think } = JSON.parse((await readBody(req)) || '{}');
        runJob(slug, 'suggest', [{ label: `Asking ${model || 'qwen3:14b'}${think ? ' (thinking, ~3 min)' : ''}`, cmd: process.execPath, args: [join(APP, 'lib/suggest.mjs'), projDir(slug), model || 'qwen3:14b'], env: { SC_THINK: think ? '1' : '0' } }]);
        return send(res, 200, { ok: true });
      }
      if (action === 'render' && req.method === 'POST') {
        const { quality } = JSON.parse((await readBody(req)) || '{}');
        runJob(slug, 'render', renderSteps(slug, quality === 'draft' ? 'draft' : 'standard'));
        return send(res, 200, { ok: true });
      }
      if (action === 'autoedit' && req.method === 'POST') {
        const { model } = JSON.parse((await readBody(req)) || '{}');
        runJob(slug, 'autoedit', autoeditSteps(slug, model));
        return send(res, 200, { ok: true });
      }
      if (action === 'qa' && req.method === 'GET') {
        const f = join(projDir(slug), 'assets/qa.json');
        return send(res, 200, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
      }
      if (action === 'reprepare' && req.method === 'POST') {
        const src = readdirSync(join(projDir(slug), 'assets')).find((f) => f.startsWith('source.'));
        runJob(slug, 'prepare', prepareSteps(slug, join(projDir(slug), 'assets', src)));
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`spaghettiCode Studio running at http://localhost:${PORT}`));
