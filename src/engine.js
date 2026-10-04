// AnisEval engine
// Pure functions only: no DOM, no storage. Everything here is unit-testable.

/** Assertion catalogue: drives both scoring and the editor UI. */
export const ASSERTION_TYPES = {
  contains:          { label: 'Contains text',              params: [{ key: 'value',  label: 'Text', type: 'text' }] },
  not_contains:      { label: 'Does not contain text',      params: [{ key: 'value',  label: 'Text', type: 'text' }] },
  contains_any:      { label: 'Contains any of',            params: [{ key: 'values', label: 'Phrases (comma-separated)', type: 'list' }] },
  not_contains_any:  { label: 'Contains none of',           params: [{ key: 'values', label: 'Phrases (comma-separated)', type: 'list' }] },
  regex:             { label: 'Matches pattern (regex)',    params: [{ key: 'pattern', label: 'Pattern', type: 'text' }, { key: 'flags', label: 'Flags', type: 'text', placeholder: 'i' }] },
  not_regex:         { label: 'Does not match pattern',     params: [{ key: 'pattern', label: 'Pattern', type: 'text' }, { key: 'flags', label: 'Flags', type: 'text', placeholder: 'i' }] },
  word_count_max:    { label: 'Maximum words',              params: [{ key: 'value',  label: 'Words', type: 'number' }] },
  word_count_min:    { label: 'Minimum words',              params: [{ key: 'value',  label: 'Words', type: 'number' }] },
  valid_json:        { label: 'Is valid JSON',              params: [] },
  json_has_fields:   { label: 'JSON has fields',            params: [{ key: 'fields', label: 'Fields (comma-separated)', type: 'list' }] },
  json_field_equals: { label: 'JSON field equals',          params: [{ key: 'field',  label: 'Field', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }] }
};

export const toList = v => Array.isArray(v) ? v : String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);
export const countWords = s => (String(s).trim().match(/\S+/g) || []).length;

const ok   = (detail, highlights = []) => ({ pass: true,  detail, highlights });
const fail = (detail, highlights = []) => ({ pass: false, detail, highlights });

function safeRegex(pattern, flags) {
  try { return new RegExp(String(pattern ?? ''), String(flags ?? '').replace(/[^imsu]/g, '')); }
  catch { return null; }
}

function parseJson(text) {
  try { return { ok: true, value: JSON.parse(String(text).trim()) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Human-readable description of an assertion, e.g. `contains "30 days"`. */
export function describeAssertion(a) {
  const q = v => `"${v}"`;
  switch (a.type) {
    case 'contains':          return `contains ${q(a.value)}`;
    case 'not_contains':      return `does not contain ${q(a.value)}`;
    case 'contains_any':      return `contains any of ${toList(a.values).map(q).join(', ')}`;
    case 'not_contains_any':  return `contains none of ${toList(a.values).map(q).join(', ')}`;
    case 'regex':             return `matches /${a.pattern}/${a.flags || ''}`;
    case 'not_regex':         return `does not match /${a.pattern}/${a.flags || ''}`;
    case 'word_count_max':    return `at most ${a.value} words`;
    case 'word_count_min':    return `at least ${a.value} words`;
    case 'valid_json':        return 'is valid JSON';
    case 'json_has_fields':   return `JSON has fields ${toList(a.fields).join(', ')}`;
    case 'json_field_equals': return `JSON field ${a.field} equals ${q(a.value)}`;
    default:                  return `unknown assertion "${a.type}"`;
  }
}

/**
 * Run one assertion against one output.
 * Text checks are case-insensitive. Returns { pass, detail, highlights: [[start, end, 'ok'|'bad']] }.
 */
export function runAssertion(a, output) {
  const out = String(output ?? '');
  const low = out.toLowerCase();

  switch (a.type) {
    case 'contains': {
      const v = String(a.value ?? ''); const i = low.indexOf(v.toLowerCase());
      return i >= 0 ? ok(`Found "${v}"`, [[i, i + v.length, 'ok']]) : fail(`Missing "${v}"`);
    }
    case 'not_contains': {
      const v = String(a.value ?? ''); const i = low.indexOf(v.toLowerCase());
      return i >= 0 ? fail(`Found forbidden text "${v}"`, [[i, i + v.length, 'bad']]) : ok(`"${v}" not present`);
    }
    case 'contains_any': {
      const vals = toList(a.values);
      for (const v of vals) {
        const i = low.indexOf(v.toLowerCase());
        if (i >= 0) return ok(`Found "${v}"`, [[i, i + v.length, 'ok']]);
      }
      return fail(`None found: ${vals.map(v => `"${v}"`).join(', ')}`);
    }
    case 'not_contains_any': {
      const hits = [];
      for (const v of toList(a.values)) {
        const i = low.indexOf(v.toLowerCase());
        if (i >= 0) hits.push([v, i]);
      }
      return hits.length
        ? fail(`Found forbidden ${hits.map(([v]) => `"${v}"`).join(', ')}`, hits.map(([v, i]) => [i, i + v.length, 'bad']))
        : ok('No forbidden phrases present');
    }
    case 'regex':
    case 'not_regex': {
      const re = safeRegex(a.pattern, a.flags);
      if (!re) return fail(`Invalid pattern /${a.pattern}/`);
      const m = re.exec(out);
      const span = m ? [[m.index, m.index + m[0].length, a.type === 'regex' ? 'ok' : 'bad']] : [];
      if (a.type === 'regex') return m ? ok(`Matched "${m[0]}"`, span) : fail(`No match for /${a.pattern}/`);
      return m ? fail(`Matched forbidden pattern: "${m[0]}"`, span) : ok('Forbidden pattern not found');
    }
    case 'word_count_max': {
      const n = countWords(out), max = Number(a.value);
      return n <= max ? ok(`${n} words (max ${max})`) : fail(`${n} words, over the max of ${max}`);
    }
    case 'word_count_min': {
      const n = countWords(out), min = Number(a.value);
      return n >= min ? ok(`${n} words (min ${min})`) : fail(`${n} words, under the min of ${min}`);
    }
    case 'valid_json': {
      const p = parseJson(out);
      return p.ok ? ok('Valid JSON') : fail(`Not valid JSON (${p.error})`);
    }
    case 'json_has_fields': {
      const p = parseJson(out);
      if (!p.ok || !isObject(p.value)) return fail('Output is not a JSON object');
      const missing = toList(a.fields).filter(f => !(f in p.value));
      return missing.length ? fail(`Missing field(s): ${missing.join(', ')}`) : ok('All fields present');
    }
    case 'json_field_equals': {
      const p = parseJson(out);
      if (!p.ok || !isObject(p.value)) return fail('Output is not a JSON object');
      if (!(a.field in p.value)) return fail(`Field "${a.field}" is missing`);
      const actual = p.value[a.field];
      return String(actual) === String(a.value)
        ? ok(`${a.field} = "${actual}"`)
        : fail(`${a.field} is "${actual}", expected "${a.value}"`);
    }
    default:
      return fail(`Unknown assertion type "${a.type}"`);
  }
}

/** Status from pass counts. */
export function statusOf(passed, total) {
  if (total === 0) return 'no-data';
  if (passed === total) return 'stable';
  if (passed === 0) return 'failing';
  return 'flaky';
}

/** Score a whole run (many outputs, possibly several per case) against a suite's cases. */
export function evaluateRun(cases, outputs) {
  const byCase = new Map();
  for (const o of outputs) {
    if (!byCase.has(o.caseId)) byCase.set(o.caseId, []);
    byCase.get(o.caseId).push(o);
  }
  const results = cases.map(c => {
    const runs = (byCase.get(c.id) || []).slice().sort((x, y) => x.run - y.run).map(o => {
      const checks = c.assertions.map(a => ({ assertion: a, ...runAssertion(a, o.output) }));
      return { run: o.run, output: o.output, checks, pass: checks.every(x => x.pass) };
    });
    const passed = runs.filter(r => r.pass).length;
    const total = runs.length;
    return { caseId: c.id, name: c.name, passed, total, rate: total ? passed / total : null, status: statusOf(passed, total), runs };
  });
  const passed = results.reduce((n, r) => n + r.passed, 0);
  const total = results.reduce((n, r) => n + r.total, 0);
  const counts = { stable: 0, flaky: 0, failing: 0, 'no-data': 0 };
  results.forEach(r => counts[r.status]++);
  return { results, passed, total, rate: total ? passed / total : null, counts };
}

/** Compare two evaluated runs case by case. */
export function compareRuns(evalA, evalB) {
  const bById = new Map(evalB.results.map(r => [r.caseId, r]));
  const rows = evalA.results.map(a => {
    const b = bById.get(a.caseId);
    let change = 'n/a';
    if (b && a.rate !== null && b.rate !== null) {
      change = b.rate > a.rate ? 'improved' : b.rate < a.rate ? 'regressed' : 'same';
    }
    return { caseId: a.caseId, name: a.name, a, b, change };
  });
  const summary = { improved: 0, regressed: 0, same: 0, 'n/a': 0 };
  rows.forEach(r => summary[r.change]++);
  return { rows, summary };
}

/** Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCSV(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parse imported outputs from CSV (columns: caseId, run, output) or JSON
 * (array of {caseId, run, output} or {outputs: [...]}). `run` is optional.
 */
export function parseOutputs(text) {
  const t = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!t) throw new Error('The file is empty.');
  let rows;

  if (t[0] === '[' || t[0] === '{') {
    let data;
    try { data = JSON.parse(t); } catch (e) { throw new Error(`Could not read JSON: ${e.message}`); }
    if (!Array.isArray(data)) data = data && data.outputs;
    if (!Array.isArray(data)) throw new Error('JSON must be an array of {caseId, run, output} objects.');
    rows = data;
  } else {
    const table = parseCSV(t);
    const header = (table[0] || []).map(h => h.trim().toLowerCase());
    const ci = header.indexOf('caseid'), ri = header.indexOf('run'), oi = header.indexOf('output');
    if (ci < 0 || oi < 0) throw new Error('CSV needs a header row with at least "caseId" and "output" columns.');
    rows = table.slice(1)
      .filter(r => r.some(cell => cell.trim() !== ''))
      .map(r => ({ caseId: r[ci], run: ri >= 0 ? r[ri] : undefined, output: r[oi] }));
  }

  const counters = {};
  return rows.map((r, idx) => {
    const caseId = String(r.caseId ?? '').trim();
    if (!caseId) throw new Error(`Row ${idx + 1} is missing a caseId.`);
    counters[caseId] = (counters[caseId] || 0) + 1;
    const n = parseInt(r.run, 10);
    return { caseId, run: Number.isFinite(n) ? n : counters[caseId], output: String(r.output ?? '') };
  });
}

/** Split outputs into ones matching the suite and report unknown/missing case IDs. */
export function validateOutputs(cases, outputs) {
  const ids = new Set(cases.map(c => c.id));
  const valid = outputs.filter(o => ids.has(o.caseId));
  const unknown = [...new Set(outputs.filter(o => !ids.has(o.caseId)).map(o => o.caseId))];
  const covered = new Set(valid.map(o => o.caseId));
  const missing = cases.filter(c => !covered.has(c.id)).map(c => c.id);
  return { valid, unknown, missing };
}

const csvCell = v => /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

/** CSV text for a list of outputs. */
export function toCSV(outputs) {
  return ['caseId,run,output', ...outputs.map(o => [o.caseId, o.run, o.output].map(csvCell).join(','))].join('\n');
}

/** Empty CSV template for a suite: one row per case per run, output left blank. */
export function csvTemplate(cases, runsPerCase = 3) {
  const rows = [];
  for (const c of cases) for (let r = 1; r <= runsPerCase; r++) rows.push({ caseId: c.id, run: r, output: '' });
  return toCSV(rows);
}

/** Turn a name into a case ID slug. */
export const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
