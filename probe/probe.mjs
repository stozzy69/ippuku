// Runs the app's real Overpass query (lifted from index.html) against each endpoint from a machine with
// open internet, and writes what came back. Used from the GitHub Actions workflow; run locally with `node probe/probe.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helpers = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
vm.runInThisContext(helpers);
const H = globalThis.Ippuku;
const endpoints = [...html.matchAll(/https:\/\/[^'"\s]+\/interpreter/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);

const SPOTS = { umeda: [34.7025, 135.4959], namba: [34.6659, 135.5010], tennoji: [34.6467, 135.5135] };
const RADIUS = +(/const RADIUS = (\d+)/.exec(html)?.[1] || 3000);

async function run(ep, q, label) {
  const t0 = Date.now();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
    const ms = Date.now() - t0;
    const cors = res.headers.get('access-control-allow-origin');
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    return { label, endpoint: ep, status: res.status, ms, cors, bytes: text.length, remark: data?.remark || null, elements: data?.elements || null, snippet: data ? null : text.slice(0, 200) };
  } catch (e) { return { label, endpoint: ep, error: String(e), ms: Date.now() - t0 }; }
  finally { clearTimeout(timer); }
}

function summarize(elements) {
  const out = { total: elements.length, byKind: {}, smokingValues: {}, konbini: 0, samples: [] };
  for (const el of elements) {
    const t = el.tags || {};
    if (t.shop === 'convenience') { out.konbini++; continue; }
    if (t.smoking) out.smokingValues[t.smoking] = (out.smokingValues[t.smoking] || 0) + 1;
    const c = H.classify(t);
    if (!c) { out.byKind.dropped = (out.byKind.dropped || 0) + 1; continue; }
    out.byKind[c.kind] = (out.byKind[c.kind] || 0) + 1;
    if (out.samples.length < 40 && c.kind !== 'spot') out.samples.push([c.kind, H.displayName(t), t.smoking || '', t.opening_hours || '']);
  }
  return out;
}

const results = { ranAt: new Date().toISOString(), radius: RADIUS, endpoints, runs: [] };
// Full query, each spot, on the primary endpoint (sequential, polite pauses).
for (const [label, [lat, lon]] of Object.entries(SPOTS)) {
  const r = await run(endpoints[0], H.buildQuery(lat, lon, RADIUS), label);
  if (r.elements) { r.summary = summarize(r.elements); delete r.elements; }
  results.runs.push(r);
  await new Promise(res => setTimeout(res, 3000));
}
// Reachability + CORS of every endpoint with the real Umeda query.
for (const ep of endpoints.slice(1)) {
  const r = await run(ep, H.buildQuery(...SPOTS.umeda, RADIUS), 'umeda');
  if (r.elements) { r.summary = summarize(r.elements); delete r.elements; }
  results.runs.push(r);
  await new Promise(res => setTimeout(res, 2000));
}
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
