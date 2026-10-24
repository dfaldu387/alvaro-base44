// An in-memory database with Mongo-style matching, for the correctness tests.
// Reads return copies (as the real SDK does), updateMany is a single synchronous step (so it is
// atomic, like the real conditional write), and every write is recorded.
export function makeMemDb(seed = {}, { tick = 0 } = {}) {
  const tables = {}; const writes = []; let n = 0;
  const table = (name) => (tables[name] ||= (seed[name] || []).map((r) => ({ ...r })));
  const pause = () => (tick ? new Promise((r) => setTimeout(r, tick)) : Promise.resolve());

  const cond = (v, c) => {
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      return Object.entries(c).every(([op, arg]) => {
        if (op === '$in') return arg.some((a) => (a === null ? v == null : v === a));
        if (op === '$nin') return !arg.includes(v);
        if (op === '$ne') return v !== arg;
        if (op === '$exists') return arg ? v !== undefined : v === undefined;
        if (op === '$lt') return v < arg;
        if (op === '$gte') return v >= arg;
        return true;
      });
    }
    return c === null ? v == null : v === c;
  };
  const match = (r, q = {}) => Object.entries(q).every(([k, c]) => cond(r[k], c));
  const apply = (r, u) => {
    for (const [k, v] of Object.entries(u.$set || {})) r[k] = v;
    for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v;
    for (const [k, v] of Object.entries(u.$push || {})) r[k] = [...(r[k] || []), v];
  };

  const entity = (name) => ({
    list: async () => { await pause(); return table(name).map((r) => ({ ...r })); },
    filter: async (q = {}, _s, limit) => { await pause(); return table(name).filter((r) => match(r, q)).slice(0, limit || 1000).map((r) => ({ ...r })); },
    get: async (id) => { await pause(); const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); return { ...r }; },
    count: async (q = {}) => table(name).filter((r) => match(r, q)).length,
    create: async (d) => { await pause(); const r = { id: `${name}-${++n}`, created_date: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...d }; table(name).push(r); writes.push({ entity: name, op: 'create', id: r.id, data: { ...r } }); return { ...r }; },
    bulkCreate: async (rows) => { await pause(); const out = rows.map((d) => { const r = { id: `${name}-${++n}`, created_date: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...d }; table(name).push(r); return { ...r }; }); writes.push({ entity: name, op: 'bulkCreate', count: out.length }); return out; },
    update: async (id, d) => { await pause(); const r = table(name).find((x) => x.id === id); if (r) Object.assign(r, d); writes.push({ entity: name, op: 'update', id, data: d }); return r ? { ...r } : r; },
    bulkUpdate: async (rows) => { await pause(); for (const d of rows) { const r = table(name).find((x) => x.id === d.id); if (r) { const { id, ...rest } = d; Object.assign(r, rest); } writes.push({ entity: name, op: 'update', id: d.id, data: d }); } return rows; },
    updateMany: async (q, u) => {
      await pause();
      const hit = table(name).filter((r) => match(r, q));
      for (const r of hit) apply(r, u);
      writes.push({ entity: name, op: 'updateMany', query: q, modified: hit.length, data: u });
      return { modified_count: hit.length };
    },
    delete: async (id) => { const i = table(name).findIndex((x) => x.id === id); if (i >= 0) table(name).splice(i, 1); writes.push({ entity: name, op: 'delete', id }); },
  });
  const entities = new Proxy({}, { get: (_t, name) => entity(name) });
  return { tables, writes, entities, asServiceRole: { entities }, table, writesTo: (e) => writes.filter((w) => w.entity === e) };
}