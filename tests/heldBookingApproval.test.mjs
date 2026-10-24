// Booking Protection holds a request off the schedule until a person approves it. The approval has
// to be reachable from a screen, or held requests strand silently and the customer never hears back.
//
// On 21 Oct the Needs Review page was deleted and /admin/review-queue became a redirect to the
// Calendar's Booking Requests drawer. The drawer has a Needs Review *filter* but no Approve action,
// and the only caller of approveHeld() — ReviewCard.jsx — was left orphaned. So the loop is:
//   held request -> dashboard banner -> redirect -> drawer -> no way to approve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]));

const sources = () => walk('src/').filter((f) => /\.(js|jsx)$/.test(f));
/** Every module reachable by import from App.jsx. A file nothing imports cannot run. */
function reachable() {
  const files = new Set(sources());
  // Resolve the way Vite does: '@/x' is src/x, './x' and '../x' are relative to the importer.
  const resolve = (from, spec) => {
    let path;
    if (spec.startsWith('@/')) path = `src/${spec.slice(2)}`;
    else {
      const parts = from.split('/').slice(0, -1);
      for (const seg of spec.split('/')) {
        if (seg === '.') continue;
        else if (seg === '..') parts.pop();
        else parts.push(seg);
      }
      path = parts.join('/');
    }
    for (const c of [path, `${path}.js`, `${path}.jsx`, `${path}/index.js`, `${path}/index.jsx`]) {
      if (files.has(c)) return c;
    }
    return null;
  };
  const seen = new Set();
  const visit = (f) => {
    if (!f || seen.has(f)) return;
    seen.add(f);
    // Static `from '...'` and lazy `import('...')` alike: App.jsx routes every page lazily.
    for (const m of read(f).matchAll(/(?:from\s+|import\()\s*'([^']+)'/g)) {
      if (/^[@.]/.test(m[1])) visit(resolve(f, m[1]));
    }
  };
  visit('src/App.jsx');
  return seen;
}

test('the server still has an approve action for held requests', () => {
  assert.match(read('src/lib/reviewQueue.js'), /action: 'approve'/);
  assert.ok(readdirSync(new URL('base44/functions/', root)).includes('reviewQueueAction'));
});

test('the dashboard banner sends a person somewhere that can act on a held request', () => {
  const banner = read('src/components/review/HeldBanner.jsx');
  const target = banner.match(/to="([^"]+)"/)?.[1];
  assert.ok(target, 'the banner links somewhere');
  const app = read('src/App.jsx');
  // If that address only redirects, the destination has to offer the approval itself.
  const redirects = new RegExp(`path="${target}"[^>]*Navigate`).test(app);
  if (redirects) {
    const live = reachable();
    const approvers = [...live].filter((f) => /approveHeld\s*\(/.test(read(f)));
    assert.ok(
      approvers.length > 0,
      `${target} redirects, and no screen reachable from App.jsx calls approveHeld(). `
      + 'A held request cannot be approved: it is off the schedule and the customer is never told.',
    );
  }
});

test('no component that calls approveHeld is left orphaned', () => {
  const live = reachable();
  for (const f of sources()) {
    if (!/approveHeld\s*\(/.test(read(f))) continue;
    assert.ok(live.has(f), `${f} calls approveHeld but nothing imports it — delete it or wire it up`);
  }
});

test('the refusals name a screen that exists', () => {
  // Both of these are shown to an admin who tries to act on a held request, so they have to point
  // at somewhere that can actually approve it. They named the deleted Needs Review page.
  for (const f of ['base44/functions/confirmBooking/entry.ts', 'base44/functions/applyManualPlacement/entry.ts']) {
    const src = read(f);
    assert.match(src, /held for review/, f);
    assert.doesNotMatch(src, /in Needs Review first/, `${f} points at the deleted page`);
  }
});
