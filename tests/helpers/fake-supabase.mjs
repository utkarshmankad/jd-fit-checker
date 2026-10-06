// In-memory stand-in for the Supabase clients used by route handlers in
// endpoint tests. Loaded in place of '@/lib/supabase/server' and
// '@/lib/supabase/service' by tests/helpers/route-test-hooks.mjs.
//
// Every query-builder call is recorded; awaiting a builder resolves it against
// the in-memory tables below. Only the operations the routes use are modelled.

export function createFakeDb({ user, profile }) {
  const db = {
    user,
    tables: { profiles: [profile], screening_results: [], role_profiles: [], candidate_profiles: [], candidate_evidence: [], recommendation_corrections: [] },
    log: [],
    rpcs: [],
  }

  function resolve(q) {
    const rows = db.tables[q.table] ?? (db.tables[q.table] = [])
    const filters = q.calls.filter(([m]) => m === 'eq' || m === 'in')
    const match = (row) => filters.every(([m, [col, val]]) => (m === 'eq' ? row[col] === val : val.includes(row[col])))
    const single = q.calls.some(([m]) => m === 'single' || m === 'maybeSingle')
    if (q.op === 'insert') {
      const inserted = [].concat(q.payload).map((row, i) => ({ id: `${q.table}-${rows.length + i + 1}`, created_at: new Date(0).toISOString(), ...structuredClone(row) }))
      rows.push(...inserted)
      return { data: single ? inserted[0] : inserted, error: null }
    }
    if (q.op === 'upsert') {
      const key = q.options?.onConflict
      for (const row of [].concat(q.payload)) {
        const index = rows.findIndex((existing) => existing[key] === row[key])
        if (index >= 0) rows[index] = structuredClone(row); else rows.push(structuredClone(row))
      }
      return { data: null, error: null }
    }
    if (q.op === 'update' || q.op === 'delete') return { data: null, error: null }
    const found = rows.filter(match).map((row) => structuredClone(row))
    return { data: single ? found[0] ?? null : found, error: null }
  }

  function from(table) {
    const q = { table, op: 'select', calls: [], payload: null, options: null }
    db.log.push(q)
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') return (onFulfilled, onRejected) => Promise.resolve(resolve(q)).then(onFulfilled, onRejected)
        return (...args) => {
          q.calls.push([prop, args])
          if (prop === 'insert' || prop === 'upsert' || prop === 'update' || prop === 'delete') { q.op = prop; q.payload = args[0]; q.options = args[1] ?? null }
          return proxy
        }
      },
    })
    return proxy
  }

  db.client = {
    auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
    from,
    rpc: async (name, args) => {
      db.rpcs.push([name, args])
      return { data: name === 'reserve_screens' ? true : null, error: null }
    },
  }
  return db
}

/** Module stand-in: both clients resolve to the db installed by the test. */
export async function createClient() {
  return globalThis.__routeTestDb.client
}
export function createServiceClient() {
  return globalThis.__routeTestDb.client
}
