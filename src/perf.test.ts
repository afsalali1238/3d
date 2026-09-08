/**
 * Performance budget — enforced, not aspirational.
 *
 * The critical path is what a patient must download before they can find a
 * body region. The 3D stack is explicitly NOT on it (see BodyViewerLazy).
 *
 * Run against a production build: `npm run build && npm test`.
 * Skips itself (loudly) if dist/ is absent, so `npm test` alone still works.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist/assets';

/** gzipped KB of every dist asset matching a predicate */
function gzipKb(pred: (f: string) => boolean): number {
  const files = readdirSync(DIST).filter(pred);
  const total = files.reduce(
    (sum, f) => sum + gzipSync(new Uint8Array(readFileSync(join(DIST, f)))).byteLength,
    0,
  );
  return total / 1024;
}

const hasBuild = existsSync(DIST);
const d = hasBuild ? describe : describe.skip;

if (!hasBuild) {
  console.warn('\n[perf] dist/ not found — run `npm run build` to enforce budgets.\n');
}

d('bundle budgets', () => {
  it('critical path (entry JS + CSS) stays under 100 KB gzip', () => {
    const entry = gzipKb((f) => /^index-.*\.(js|css)$/.test(f));
    expect(entry, `critical path is ${entry.toFixed(1)} KB gzip`).toBeLessThan(100);
  });

  it('the 3D stack is code-split out of the entry chunk', () => {
    const files = readdirSync(DIST);
    const lazy = files.filter((f) => /^BodyViewer-.*\.js$/.test(f));
    expect(lazy.length, 'BodyViewer must be its own lazy chunk').toBe(1);

    // the heavy chunk should genuinely be the heavy one
    const entryBytes = statSync(join(DIST, files.find((f) => /^index-.*\.js$/.test(f))!)).size;
    const lazyBytes = statSync(join(DIST, lazy[0])).size;
    expect(lazyBytes).toBeGreaterThan(entryBytes);
  });

  it('total 3D payload stays under the 6 MB asset-spec ceiling', () => {
    const js = gzipKb((f) => f.endsWith('.js'));
    const models = ['public/models/body-male.glb', 'public/models/body-female.glb']
      .filter(existsSync)
      .reduce((s, p) => s + statSync(p).size, 0) / 1024;
    expect(js + models).toBeLessThan(6 * 1024);
  });
});

describe('model assets', () => {
  it('both body GLBs exist and stay within the realistic-asset budget', () => {
    for (const p of ['public/models/body-male.glb', 'public/models/body-female.glb']) {
      expect(existsSync(p), `${p} missing`).toBe(true);
      // Realism pass deliberately spends more geometry/vertex-channel budget
      // than the original 80 KB locator mesh. The asset spec ceiling remains
      // the user-facing constraint: one body must be comfortably below 6 MB.
      expect(statSync(p).size / 1024, `${p} too large`).toBeLessThan(3 * 1024);
    }
  });

  it('self-hosted decoders are present (no CDN dependency at runtime)', () => {
    for (const p of ['public/decoders/draco_decoder.wasm', 'public/decoders/draco_decoder.js']) {
      expect(existsSync(p), `${p} missing`).toBe(true);
    }
  });
});
