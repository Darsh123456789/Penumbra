// Browser engine vs Python pipeline for one site (same logic as the Trust tab, run in Node).
// Usage (from web/):  npx tsx scripts/verify_site.ts haworth [shackleton ...]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
(globalThis as any).fetch = async (url: string) => {
  const name = url.split('/').pop()!;
  let buf: Buffer;
  try { buf = readFileSync(join(DATA, name)); } catch { return { ok: false } as any; }
  return { ok: true, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as any;
};


const E = await import('../src/engine.ts');
const YEAR0 = Date.UTC(2027, 0, 1);
const dayIso = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 19);

for (const site of process.argv.slice(2)) {
  const [e, d, g] = await Promise.all([E.loadEphem(), E.loadDsn(), E.loadHorizons(site)]);
  const sl = JSON.parse(readFileSync(join(DATA, `slip_${site}.json`), 'utf8'));
  const pt = sl.points.best, k = E.nearestIndex(g, pt.lat, pt.lon), H = E.horizonAtIndex(g, k);
  for (const preset of Object.keys(E.PRESETS)) {
    const py = pt.by_preset[preset]; if (!py) continue;
    let match = 0, maxd = 0;
    for (let day = 0; day < 365; day++) {
      const r = E.simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, E.PRESETS[preset]);
      if (r.survives === py.survives[day]) match++;
      maxd = Math.max(maxd, Math.abs(r.sunlit_pct - py.sunlit_pct[day]));
    }
    console.log(`${site} best point, ${preset}: survives agree ${match}/365, max sunlit diff ${maxd.toFixed(2)} pts`);
  }
}
