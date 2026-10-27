// Runs the app's real Overpass query (lifted from index.html) against each endpoint from a machine with
// open internet, and writes what came back. Used from the GitHub Actions workflow; run locally with `node probe/probe.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helpers = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
vm.runInThisContext(helpers);
const H = globalThis.Ippuku;
// Candidates: what the app ships plus the individual overpass-api.de backends and OSM France.
const endpoints = [...new Set([...html.matchAll(/https:\/\/[^'"\s]+\/interpreter/g)].map(m => m[0]).concat([
  'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
]))];

const SPOTS = { umeda: [34.7025, 135.4959], namba: [34.6659, 135.5010], tennoji: [34.6467, 135.5135] };
const RADIUS = +(/const RADIUS = (\d+)/.exec(html)?.[1] || 3000);
// Browsers always send a User-Agent and, for a cross-site fetch, an Origin; mirror that so servers treat us like the app.
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': SAFARI, 'Origin': 'https://stozzy69.github.io', 'Referer': 'https://stozzy69.github.io/ippuku/' };

async function run(ep, q, label) {
  const t0 = Date.now();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: HEADERS, signal: ctrl.signal });
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
// Reachability + CORS of every candidate endpoint with the real Umeda query.
for (const ep of endpoints.slice(1)) {
  const r = await run(ep, H.buildQuery(...SPOTS.umeda, RADIUS), 'umeda');
  if (r.elements) { r.summary = summarize(r.elements); delete r.elements; }
  results.runs.push(r);
  await new Promise(res => setTimeout(res, 2000));
}
// How much of the time is the radius? Same spot at 1.5 km on the primary.
{
  const r = await run(endpoints[0], H.buildQuery(...SPOTS.umeda, 1500), 'umeda-1500m');
  if (r.elements) { r.summary = summarize(r.elements); delete r.elements; }
  results.runs.push(r);
}
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
