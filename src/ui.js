// AnisEval UI: hash routing, rendering, and event handling.
import {
  ASSERTION_TYPES, describeAssertion, evaluateRun, compareRuns,
  parseOutputs, validateOutputs, csvTemplate, toCSV, toList, slugify
} from './engine.js';
import { sampleSuite } from './sample-data.js';

const KEY = 'aniseval-v1';
const app = document.getElementById('app');

/* ---------- state ---------- */
let state = load();
let editor = null;          // { suiteId, originalId|null, draft }
let notice = null;          // { type: 'ok'|'warn'|'error', html }
let pendingFile = null;     // { name, text }
const expanded = new Set(); // expanded case rows on the results screen

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.suites)) return d;
  } catch { /* fall through */ }
  return { suites: [sampleSuite()] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { flash('error', 'Could not save: browser storage may be full.'); }
}

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = r => r == null ? '—' : `${Math.round(r * 100)}%`;
const uid = p => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const findSuite = id => state.suites.find(s => s.id === id);
const flash = (type, html) => { notice = { type, html, sticky: true }; };

const STATUS_LABEL = { stable: 'Stable', flaky: 'Flaky', failing: 'Failing', 'no-data': 'No data' };
const CHANGE_LABEL = { improved: '▲ Improved', regressed: '▼ Regressed', same: 'No change', 'n/a': '—' };

function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function highlight(text, ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e, kind] of sorted) {
    if (s < pos) continue; // skip overlaps
    out += esc(text.slice(pos, s)) + `<mark class="${kind}">${esc(text.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + esc(text.slice(pos));
}

/* ---------- routing ---------- */
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
window.addEventListener('hashchange', () => { if (!notice?.sticky) notice = null; render(); window.scrollTo(0, 0); });

/* ---------- render ---------- */
function render() {
  const { parts, q } = route();
  let body;
  if (parts[0] === 'suite') {
    const s = findSuite(parts[1]);
    body = s ? suiteView(s, parts, q) : `<p class="muted">Suite not found. <a href="#/">Back to suites</a></p>`;
  } else body = homeView();

  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#/" data-testid="brand"><span class="logo" aria-hidden="true">{✓}</span>AnisEval</a>
      <span class="tagline">Regression testing for AI outputs</span>
    </header>
    ${notice ? `<div class="notice ${notice.type}" role="status" data-testid="notice">${notice.html}</div>` : ''}
    <main>${body}</main>
    <footer class="foot">AnisEval · runs entirely in your browser, nothing is uploaded</footer>`;
  if (notice) notice.sticky = false;
}


/* ---------- home ---------- */
function homeView() {
  const cards = state.suites.map(s => {
    const last = s.runs[s.runs.length - 1];
    const ev = last ? evaluateRun(s.cases, last.outputs) : null;
    return `
      <a class="card suite-card" href="#/suite/${esc(s.id)}/cases" data-testid="suite-card">
        <h3>${esc(s.name)}</h3>
        <p class="muted small">${esc(s.description || '')}</p>
        <div class="meta">
          <span>${s.cases.length} test cases</span>
          <span>${s.runs.length} runs</span>
          ${ev ? `<span>Latest: <b>${pct(ev.rate)}</b> pass</span>` : ''}
        </div>
      </a>`;
  }).join('');

  const hasSample = state.suites.some(s => s.id === 'shopease');
  return `
    <section class="intro">
      <h1>Test what your AI says, not just whether it runs.</h1>
      <p class="muted">Define test cases with rules every answer must follow, import outputs from any AI model, and see pass rates, flaky cases, and regressions between prompt versions.</p>
    </section>
    <div class="row between">
      <h2>Test suites</h2>
      <div class="row">
        <label class="btn ghost">Import suite<input type="file" accept=".json" hidden data-file="suite" data-testid="import-suite"></label>
        <button class="btn" data-action="new-suite" data-testid="new-suite">New suite</button>
      </div>
    </div>
    <div class="grid">${cards || '<p class="muted">No suites yet. Create one or restore the sample.</p>'}</div>
    ${hasSample ? '' : `<button class="link" data-action="restore-sample">Restore the ShopEase sample suite</button>`}
    <section class="how">
      <h2>How it works</h2>
      <ol>
        <li><b>Write test cases.</b> Each case is an input to your AI plus rules the answer must follow, like "mentions the 30-day policy" or "is valid JSON".</li>
        <li><b>Import outputs.</b> Run your AI several times per case and import the answers as CSV or JSON.</li>
        <li><b>Read the results.</b> AI answers vary, so every case gets a pass rate: stable, flaky, or failing.</li>
        <li><b>Compare versions.</b> Changed the prompt or model? Compare two runs to catch regressions before users do.</li>
      </ol>
    </section>`;
}

/* ---------- suite ---------- */
function suiteView(s, parts, q) {
  const tab = parts[2] || 'cases';
  const tabs = [['cases', `Test cases (${s.cases.length})`], ['runs', `Runs (${s.runs.length})`], ['compare', 'Compare']];
  let content;
  if (tab === 'run') {
    const run = s.runs.find(r => r.id === parts[3]);
    content = run ? resultsView(s, run, q) : '<p class="muted">Run not found.</p>';
  } else if (tab === 'runs') content = runsView(s);
  else if (tab === 'compare') content = compareView(s, q);
  else content = casesView(s);

  const activeTab = tab === 'run' ? 'runs' : tab;
  return `
    <nav class="crumbs"><a href="#/">Suites</a> / <span>${esc(s.name)}</span></nav>
    <div class="row between suite-head">
      <div>
        <h1 data-testid="suite-title">${esc(s.name)}</h1>
        ${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}
      </div>
      <div class="row">
        <button class="btn ghost sm" data-action="rename-suite" data-id="${esc(s.id)}">Rename</button>
        <button class="btn ghost sm" data-action="export-suite" data-id="${esc(s.id)}" data-testid="export-suite">Export</button>
        <button class="btn danger sm" data-action="delete-suite" data-id="${esc(s.id)}">Delete</button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<a role="tab" href="#/suite/${esc(s.id)}/${k}" aria-selected="${activeTab === k}" data-testid="tab-${k}">${label}</a>`).join('')}
    </div>
    ${content}`;
}

/* ---------- cases ---------- */
function casesView(s) {
  const isNew = editor && editor.suiteId === s.id && editor.originalId === null;
  const list = s.cases.map(c => {
    if (editor && editor.suiteId === s.id && editor.originalId === c.id) return editorView(s);
    return `
      <article class="card case" data-testid="case-card" data-case-id="${esc(c.id)}">
        <div class="row between">
          <div><h3>${esc(c.name)}</h3><code class="small">${esc(c.id)}</code></div>
          <div class="row">
            <button class="btn ghost sm" data-action="edit-case" data-id="${esc(c.id)}">Edit</button>
            <button class="btn ghost sm" data-action="delete-case" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">Delete</button>
          </div>
        </div>
        ${c.input ? `<blockquote>${esc(c.input)}</blockquote>` : ''}
        <ul class="asserts">${c.assertions.map(a => `<li>${esc(describeAssertion(a))}</li>`).join('') || '<li class="muted">No assertions yet</li>'}</ul>
      </article>`;
  }).join('');

  return `
    <div class="row between">
      <p class="muted small">Each output must pass every assertion in its case to count as a pass. Text checks ignore upper/lower case.</p>
      ${editor ? '' : `<button class="btn" data-action="add-case" data-testid="add-case">Add test case</button>`}
    </div>
    ${isNew ? editorView(s) : ''}
    ${list || (isNew ? '' : '<p class="muted">No test cases yet.</p>')}`;
}

function editorView(s) {
  const d = editor.draft;
  const assertRows = d.assertions.map((a, i) => {
    const def = ASSERTION_TYPES[a.type];
    const params = def.params.map(p => {
      const val = p.type === 'list' ? toList(a[p.key]).join(', ') : (a[p.key] ?? '');
      return `<label class="param"><span>${p.label}</span>
        <input type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(val)}" placeholder="${esc(p.placeholder || '')}"
          data-edit="param" data-idx="${i}" data-key="${p.key}" data-kind="${p.type}"></label>`;
    }).join('');
    return `
      <div class="assert-row" data-testid="assertion-row">
        <label class="param"><span>Check</span>
          <select data-edit="type" data-idx="${i}">
            ${Object.entries(ASSERTION_TYPES).map(([k, t]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select></label>
        ${params}
        <button class="btn ghost sm" data-action="remove-assertion" data-idx="${i}" aria-label="Remove assertion">Remove</button>
      </div>`;
  }).join('');

  return `
    <article class="card editor" data-testid="case-editor">
      <h3>${editor.originalId ? 'Edit test case' : 'New test case'}</h3>
      <label class="field"><span>Name</span><input type="text" value="${esc(d.name)}" data-edit="name" data-testid="case-name"></label>
      <label class="field"><span>Case ID <em class="muted">(used in import files)</em></span>
        <input type="text" value="${esc(d.id)}" data-edit="id" data-testid="case-id" ${editor.originalId ? 'disabled' : ''}></label>
      <label class="field"><span>Input sent to the AI</span><textarea rows="2" data-edit="input" data-testid="case-input">${esc(d.input)}</textarea></label>
      <h4>Assertions</h4>
      ${assertRows || '<p class="muted small">Add at least one rule the answer must follow.</p>'}
      <button class="btn ghost sm" data-action="add-assertion" data-testid="add-assertion">+ Add assertion</button>
      <p class="error small" data-testid="editor-error">${esc(editor.error || '')}</p>
      <div class="row">
        <button class="btn" data-action="save-case" data-testid="save-case">Save</button>
        <button class="btn ghost" data-action="cancel-edit">Cancel</button>
      </div>
    </article>`;
}

/* ---------- runs ---------- */
function runsView(s) {
  const runs = s.runs.slice().reverse().map(r => {
    const ev = evaluateRun(s.cases, r.outputs);
    return `
      <article class="card run-card" data-testid="run-card">
        <div class="row between">
          <div>
            <h3><a href="#/suite/${esc(s.id)}/run/${esc(r.id)}">${esc(r.label)}</a></h3>
            <p class="muted small">${fmtDate(r.createdAt)} · ${r.outputs.length} outputs</p>
          </div>
          <div class="score"><b>${pct(ev.rate)}</b><span class="muted small">${ev.passed}/${ev.total} passed</span></div>
        </div>
        <div class="row pills">
          ${['stable', 'flaky', 'failing'].map(k => `<span class="pill ${k}">${ev.counts[k]} ${STATUS_LABEL[k].toLowerCase()}</span>`).join('')}
        </div>
        <div class="row">
          <a class="btn sm" href="#/suite/${esc(s.id)}/run/${esc(r.id)}">View results</a>
          <button class="btn ghost sm" data-action="export-run" data-id="${esc(r.id)}">Download CSV</button>
          <button class="btn ghost sm" data-action="delete-run" data-id="${esc(r.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');

  return `
    <article class="card import" data-testid="import-panel">
      <h3>Import a run</h3>
      <p class="muted small">CSV with columns <code>caseId,run,output</code>, or JSON: <code>[{"caseId": "...", "run": 1, "output": "..."}]</code>. Run your AI several times per case for meaningful pass rates.</p>
      <label class="field"><span>Run label</span><input type="text" id="run-label" placeholder="e.g. Prompt v3" data-testid="run-label"></label>
      <div class="row">
        <label class="btn ghost">Choose file<input type="file" accept=".csv,.json,.txt" hidden data-file="run" data-testid="run-file"></label>
        <span class="muted small" data-testid="file-name">${pendingFile ? esc(pendingFile.name) : 'or paste below'}</span>
      </div>
      <label class="field"><span>Paste outputs</span><textarea id="run-paste" rows="4" placeholder="caseId,run,output" data-testid="run-paste"></textarea></label>
      <div class="row">
        <button class="btn" data-action="import-run" data-testid="import-run">Import and score</button>
        <button class="link" data-action="download-template">Download CSV template for this suite</button>
      </div>
    </article>
    ${runs || '<p class="muted">No runs yet.</p>'}`;
}

/* ---------- results ---------- */
function resultsView(s, run, q) {
  const ev = evaluateRun(s.cases, run.outputs);
  const filter = q.get('filter') || 'all';
  const rows = ev.results.filter(r => filter === 'all' || r.status === filter).map(r => {
    const open = expanded.has(`${run.id}:${r.caseId}`);
    const caseDef = s.cases.find(c => c.id === r.caseId);
    return `
      <div class="res ${open ? 'open' : ''}" data-testid="result-row" data-case-id="${esc(r.caseId)}" data-status="${r.status}">
        <button class="res-head" data-action="toggle-case" data-key="${esc(run.id)}:${esc(r.caseId)}" aria-expanded="${open}">
          <span class="res-name">${esc(r.name)}</span>
          <span class="bar" aria-hidden="true"><i style="width:${(r.rate ?? 0) * 100}%"></i></span>
          <span class="res-count">${r.passed}/${r.total}</span>
          <span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span>
        </button>
        ${open ? `<div class="res-body">
          ${caseDef?.input ? `<p class="small"><b>Input:</b> ${esc(caseDef.input)}</p>` : ''}
          ${r.runs.map(x => {
            const marks = x.checks.flatMap(c => c.highlights);
            return `<div class="attempt ${x.pass ? 'pass' : 'fail'}" data-testid="attempt">
              <div class="attempt-head">Run ${x.run} <span>${x.pass ? '✓ Pass' : '✗ Fail'}</span></div>
              <pre class="output">${highlight(x.output, marks)}</pre>
              <ul class="checks">${x.checks.map(c => `<li class="${c.pass ? 'pass' : 'fail'}">
                <span>${c.pass ? '✓' : '✗'}</span> ${esc(describeAssertion(c.assertion))} <em>${esc(c.detail)}</em></li>`).join('')}</ul>
            </div>`;
          }).join('') || '<p class="muted small">No outputs for this case in this run.</p>'}
        </div>` : ''}
      </div>`;
  }).join('');

  const f = (k, label) => `<a href="#/suite/${esc(s.id)}/run/${esc(run.id)}?filter=${k}" class="chip" aria-current="${filter === k}">${label}</a>`;
  return `
    <div class="row between">
      <h2 data-testid="run-title">${esc(run.label)}</h2>
      <span class="muted small">${fmtDate(run.createdAt)}</span>
    </div>
    <div class="stats">
      <div class="stat big"><b data-testid="overall-rate">${pct(ev.rate)}</b><span>${ev.passed} of ${ev.total} outputs passed</span></div>
      <div class="stat"><b class="c-stable">${ev.counts.stable}</b><span>Stable cases</span></div>
      <div class="stat"><b class="c-flaky">${ev.counts.flaky}</b><span>Flaky cases</span></div>
      <div class="stat"><b class="c-failing">${ev.counts.failing}</b><span>Failing cases</span></div>
    </div>
    <div class="row chips">${f('all', 'All')}${f('failing', 'Failing')}${f('flaky', 'Flaky')}${f('stable', 'Stable')}</div>
    <div class="card flush">${rows || '<p class="muted pad">No cases match this filter.</p>'}</div>
    <p class="muted small">Tap a case to see every output, which rule failed, and the exact text that triggered it.</p>`;
}

/* ---------- compare ---------- */
function compareView(s, q) {
  if (s.runs.length < 2) return '<p class="muted">Import at least two runs to compare them.</p>';
  const ids = s.runs.map(r => r.id);
  const aId = ids.includes(q.get('a')) ? q.get('a') : ids[ids.length - 2];
  const bId = ids.includes(q.get('b')) ? q.get('b') : ids[ids.length - 1];
  const A = s.runs.find(r => r.id === aId), B = s.runs.find(r => r.id === bId);
  const eA = evaluateRun(s.cases, A.outputs), eB = evaluateRun(s.cases, B.outputs);
  const cmp = compareRuns(eA, eB);
  const sel = (name, cur) => `<select data-compare="${name}" data-testid="compare-${name}">
    ${s.runs.map(r => `<option value="${esc(r.id)}" ${r.id === cur ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`;

  return `
    <div class="row compare-pick">
      <label class="param"><span>Baseline</span>${sel('a', aId)}</label>
      <span class="arrow" aria-hidden="true">→</span>
      <label class="param"><span>Candidate</span>${sel('b', bId)}</label>
    </div>
    <div class="stats">
      <div class="stat"><b>${pct(eA.rate)} → ${pct(eB.rate)}</b><span>Overall pass rate</span></div>
      <div class="stat"><b class="c-stable" data-testid="improved-count">${cmp.summary.improved}</b><span>Improved</span></div>
      <div class="stat"><b class="c-failing" data-testid="regressed-count">${cmp.summary.regressed}</b><span>Regressed</span></div>
      <div class="stat"><b>${cmp.summary.same}</b><span>Unchanged</span></div>
    </div>
    ${cmp.summary.regressed ? `<div class="notice error">⚠ ${cmp.summary.regressed} regression${cmp.summary.regressed > 1 ? 's' : ''}: ${esc(B.label)} does worse than ${esc(A.label)} on ${cmp.rows.filter(r => r.change === 'regressed').map(r => `<b>${esc(r.name)}</b>`).join(', ')}.</div>` : ''}
    <div class="table-wrap card flush">
      <table class="cmp">
        <thead><tr><th>Test case</th><th>${esc(A.label)}</th><th>${esc(B.label)}</th><th>Change</th></tr></thead>
        <tbody>${cmp.rows.map(r => `
          <tr class="${r.change}" data-testid="compare-row" data-case-id="${esc(r.caseId)}" data-change="${r.change}">
            <td>${esc(r.name)}</td>
            <td>${r.a.passed}/${r.a.total}</td>
            <td><a href="#/suite/${esc(s.id)}/run/${esc(B.id)}" data-action="open-case" data-key="${esc(B.id)}:${esc(r.caseId)}">${r.b ? `${r.b.passed}/${r.b.total}` : '—'}</a></td>
            <td><span class="change ${r.change}">${CHANGE_LABEL[r.change]}</span></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/* ---------- actions ---------- */
const actions = {
  'new-suite'() {
    const name = prompt('Name for the new test suite:');
    if (!name || !name.trim()) return;
    const s = { id: uid('suite'), name: name.trim(), description: '', cases: [], runs: [] };
    state.suites.push(s); save(); location.hash = `#/suite/${s.id}/cases`;
  },
  'restore-sample'() {
    state.suites.unshift(sampleSuite()); save(); flash('ok', 'Sample suite restored.'); render();
  },
  'rename-suite'(el) {
    const s = findSuite(el.dataset.id);
    const name = prompt('New name:', s.name);
    if (name && name.trim()) { s.name = name.trim(); save(); render(); }
  },
  'export-suite'(el) {
    const s = findSuite(el.dataset.id);
    download(`${slugify(s.name) || 'suite'}.aniseval.json`, JSON.stringify(s, null, 2), 'application/json');
  },
  'delete-suite'(el) {
    const s = findSuite(el.dataset.id);
    if (!confirm(`Delete "${s.name}" with all its test cases and runs?`)) return;
    state.suites = state.suites.filter(x => x !== s); save(); flash('ok', 'Suite deleted.'); location.hash = '#/';
  },
  'add-case'(el) {
    const { parts } = route();
    editor = { suiteId: parts[1], originalId: null, draft: { id: '', name: '', input: '', assertions: [{ type: 'contains', value: '' }] }, idTouched: false };
    render();
  },
  'edit-case'(el) {
    const { parts } = route();
    const c = findSuite(parts[1]).cases.find(x => x.id === el.dataset.id);
    editor = { suiteId: parts[1], originalId: c.id, draft: JSON.parse(JSON.stringify(c)) };
    render();
  },
  'cancel-edit'() { editor = null; render(); },
  'add-assertion'() { editor.draft.assertions.push({ type: 'contains', value: '' }); render(); },
  'remove-assertion'(el) { editor.draft.assertions.splice(Number(el.dataset.idx), 1); render(); },
  'save-case'() {
    const s = findSuite(editor.suiteId), d = editor.draft;
    d.name = d.name.trim(); d.id = slugify(d.id || d.name);
    const err =
      !d.name ? 'Give the test case a name.' :
      !d.id ? 'The case ID can only contain letters, numbers and dashes.' :
      (!editor.originalId && s.cases.some(c => c.id === d.id)) ? `A case with ID "${d.id}" already exists.` :
      !d.assertions.length ? 'Add at least one assertion.' :
      validateDraftAssertions(d.assertions);
    if (err) { editor.error = err; render(); return; }
    const clean = { id: d.id, name: d.name, input: d.input.trim(), assertions: d.assertions };
    if (editor.originalId) s.cases[s.cases.findIndex(c => c.id === editor.originalId)] = clean;
    else s.cases.push(clean);
    editor = null; save(); flash('ok', `Saved "${esc(clean.name)}".`); render();
  },
  'delete-case'(el) {
    const { parts } = route(); const s = findSuite(parts[1]);
    const c = s.cases.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete test case "${c.name}"?`)) return;
    s.cases = s.cases.filter(x => x !== c); save(); render();
  },
  'import-run'() {
    const { parts } = route(); const s = findSuite(parts[1]);
    const pasted = document.getElementById('run-paste').value;
    const label = document.getElementById('run-label').value.trim() || `Run ${s.runs.length + 1}`;
    const text = pendingFile ? pendingFile.text : pasted;
    if (!s.cases.length) { flash('error', 'Add test cases before importing outputs.'); render(); return; }
    let outputs;
    try { outputs = parseOutputs(text); }
    catch (e) { flash('error', esc(e.message)); render(); return; }
    const { valid, unknown, missing } = validateOutputs(s.cases, outputs);
    if (!valid.length) { flash('error', `None of the case IDs matched this suite. Found: ${unknown.map(esc).join(', ')}`); render(); return; }
    const run = { id: uid('run'), label, createdAt: new Date().toISOString(), outputs: valid };
    s.runs.push(run); save(); pendingFile = null;
    const warn = [];
    if (unknown.length) warn.push(`Skipped unknown case IDs: ${unknown.map(esc).join(', ')}.`);
    if (missing.length) warn.push(`No outputs for: ${missing.map(esc).join(', ')}.`);
    notice = { type: warn.length ? 'warn' : 'ok', html: `Imported ${valid.length} outputs as "${esc(label)}". ${warn.join(' ')}`, sticky: true };
    location.hash = `#/suite/${s.id}/run/${run.id}`;
  },
  'download-template'() {
    const { parts } = route(); const s = findSuite(parts[1]);
    download(`${slugify(s.name)}-template.csv`, csvTemplate(s.cases), 'text/csv');
  },
  'export-run'(el) {
    const { parts } = route(); const s = findSuite(parts[1]);
    const r = s.runs.find(x => x.id === el.dataset.id);
    download(`${slugify(s.name)}-${slugify(r.label)}.csv`, toCSV(r.outputs), 'text/csv');
  },
  'delete-run'(el) {
    const { parts } = route(); const s = findSuite(parts[1]);
    const r = s.runs.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete run "${r.label}"?`)) return;
    s.runs = s.runs.filter(x => x !== r); save(); render();
  },
  'toggle-case'(el) {
    const k = el.dataset.key; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render();
  },
  'open-case'(el) { expanded.add(el.dataset.key); }
};

function validateDraftAssertions(list) {
  for (const a of list) {
    for (const p of ASSERTION_TYPES[a.type].params) {
      if (p.key === 'flags') continue;
      const v = a[p.key];
      const empty = p.type === 'list' ? toList(v).length === 0 : String(v ?? '').trim() === '';
      if (empty) return `Fill in "${p.label}" for the "${ASSERTION_TYPES[a.type].label}" check.`;
      if (p.type === 'number' && !Number.isFinite(Number(v))) return `"${p.label}" must be a number.`;
    }
    if (a.type === 'regex' || a.type === 'not_regex') {
      try { new RegExp(a.pattern); } catch { return `The pattern /${a.pattern}/ is not a valid regex.`; }
    }
  }
  return '';
}

/* ---------- events ---------- */
app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    if (el.tagName === 'BUTTON') e.preventDefault();
    actions[el.dataset.action](el, e);
  }
});

app.addEventListener('input', e => {
  const el = e.target;
  if (!editor || !el.dataset.edit) return;
  const d = editor.draft;
  if (el.dataset.edit === 'name') {
    d.name = el.value;
    if (!editor.originalId && !editor.idTouched) {
      d.id = slugify(el.value);
      const idInput = app.querySelector('[data-edit="id"]');
      if (idInput) idInput.value = d.id;
    }
  } else if (el.dataset.edit === 'id') { d.id = el.value; editor.idTouched = true; }
  else if (el.dataset.edit === 'input') d.input = el.value;
  else if (el.dataset.edit === 'param') {
    const a = d.assertions[Number(el.dataset.idx)];
    const kind = el.dataset.kind;
    a[el.dataset.key] = kind === 'list' ? toList(el.value) : kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  }
});

app.addEventListener('change', async e => {
  const el = e.target;
  if (editor && el.dataset.edit === 'type') {
    const i = Number(el.dataset.idx);
    editor.draft.assertions[i] = { type: el.value };
    render(); return;
  }
  if (el.dataset.compare) {
    const { parts, q } = route();
    q.set(el.dataset.compare, el.value);
    location.hash = `#/suite/${parts[1]}/compare?${q.toString()}`;
    return;
  }
  if (el.dataset.file && el.files && el.files[0]) {
    const file = el.files[0];
    const text = await file.text();
    if (el.dataset.file === 'run') {
      pendingFile = { name: file.name, text };
      const label = app.querySelector('#run-label');
      const keep = label ? label.value : '';
      const pasteEl = app.querySelector('#run-paste');
      const paste = pasteEl ? pasteEl.value : '';
      render();
      app.querySelector('#run-label').value = keep || file.name.replace(/\.[^.]+$/, '');
      app.querySelector('#run-paste').value = paste;
    } else if (el.dataset.file === 'suite') {
      try {
        const s = JSON.parse(text);
        if (!s || !Array.isArray(s.cases) || !s.name) throw new Error('Not an AnisEval suite file.');
        s.runs = Array.isArray(s.runs) ? s.runs : [];
        if (state.suites.some(x => x.id === s.id)) s.id = uid('suite');
        state.suites.push(s); save(); flash('ok', `Imported "${esc(s.name)}".`);
      } catch (err) { flash('error', esc(err.message)); }
      render();
    }
  }
});

render();
