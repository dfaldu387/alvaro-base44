// The Messages page is where someone checks what has gone out. Its subtitle was the hardcoded
// string "Test mode — not delivered", which stays on screen even when the gate is live and real
// customers are receiving texts. A page that claims nothing is delivered while it is delivering is
// worse than one that says nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('the Messages page does not hardcode a delivery claim', () => {
  const src = read('src/pages/admin/Messages.jsx');
  assert.doesNotMatch(src, /subtitle="[^"]*not delivered/, 'the subtitle is not a fixed claim');
  assert.match(src, /MessagingSettings/, 'it reads the real gate');
  for (const m of ['live', 'allowlist', 'off']) {
    assert.match(src, new RegExp(`\\b${m}\\b`), `it can report '${m}'`);
  }
});

test('the page mirrors the server fail-safe: unknown means allowlist, never live', () => {
  const src = read('src/pages/admin/Messages.jsx');
  // shared/messagingMode.ts: anything that is not 'off' or 'live' is treated as allowlist.
  assert.match(src, /v === 'off' \|\| v === 'live' \? v : 'allowlist'/);
  const shared = read('base44/shared/messagingMode.ts');
  assert.match(shared, /v === 'off' \|\| v === 'live' \|\| v === 'allowlist' \? v : 'allowlist'/);
});

test('a live gate is described as live, in words that cannot be misread', () => {
  const src = read('src/pages/admin/Messages.jsx');
  const liveLine = src.match(/live:\s*'([^']+)'/)?.[1] || '';
  assert.match(liveLine, /LIVE/, 'the live case says so plainly');
  assert.match(liveLine, /real customers/i);
});
