// Loads a backend function's entry.ts under Node by swapping the two things Node cannot resolve:
// the `npm:@base44/sdk` import (replaced with a test double) and the relative `../../shared/` imports
// (made absolute). The function's own code is otherwise executed exactly as written.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
let counter = 0;

export async function loadEntry(name) {
  const src = readFileSync(new URL(`base44/functions/${name}/entry.ts`, root), 'utf8');
  const shared = pathToFileURL(fileURLToPath(new URL('base44/shared/', root))).href + '/';
  const patched = src
    .replace(/import \{ createClientFromRequest \} from 'npm:@base44\/sdk@[^']+';/, 'const createClientFromRequest = (req) => globalThis.__b44Client(req);')
    .replaceAll("'../../shared/", `'${shared}`);
  const dir = join(tmpdir(), 'cd-entry-tests');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${process.pid}-${++counter}.ts`);
  writeFileSync(file, patched);
  return (await import(pathToFileURL(file).href)).default;
}

/** A forgiving in-memory database: any entity exists, reads default to empty, writes are recorded. */
export function makeLooseDb(seed = {}) {
  const tables = {}; const writes = []; let n = 0;
  const table = (name) => (tables[name] ||= []);
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) table(name).push({ ...r });
  const entity = (name) => ({
    list: async () => [...table(name)],
    filter: async (q = {}, _s, limit) => table(name).filter((r) => Object.entries(q).every(([k, c]) => (c && typeof c === 'object' && !Array.isArray(c)) ? true : r[k] === c)).slice(0, limit || 1000),
    count: async () => 0,
    get: async (id) => { const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); return r; },
    create: async (d) => { const r = { id: `${name}-${++n}`, created_date: new Date().toISOString(), ...d }; table(name).push(r); writes.push({ entity: name, op: 'create', data: r }); return r; },
    bulkCreate: async (rows) => rows.map((d) => { const r = { id: `${name}-${++n}`, ...d }; table(name).push(r); writes.push({ entity: name, op: 'create', data: r }); return r; }),
    update: async (id, d) => { const r = table(name).find((x) => x.id === id); if (r) Object.assign(r, d); writes.push({ entity: name, op: 'update', id, data: d }); return r; },
    updateMany: async () => ({ modified_count: 0 }),
    delete: async (id) => { const i = table(name).findIndex((x) => x.id === id); if (i >= 0) table(name).splice(i, 1); writes.push({ entity: name, op: 'delete', id }); },
  });
  const entities = new Proxy({}, { get: (_t, name) => entity(name) });
  return { tables, writes, entities, asServiceRole: { entities } };
}