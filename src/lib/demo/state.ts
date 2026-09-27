/** The mock stores live on globalThis (see lib/mock/*). In the static demo they are mirrored to localStorage. */
export const DEMO_STATE_KEY = "rbs-vat-demo-state-v1"
export const STORE_KEYS = ["__rbsDb2", "__rbsUsers3", "__rbsAudit", "__rbsCompany"] as const

type G = Record<string, unknown>

/** Must run before any lib/mock module is evaluated (they adopt an existing global instead of re-seeding). */
export function restoreState() {
  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as G
    for (const k of STORE_KEYS) if (s[k] && !(globalThis as G)[k]) (globalThis as G)[k] = s[k]
  } catch { localStorage.removeItem(DEMO_STATE_KEY) }
}

export function persistState() {
  const s: G = {}
  for (const k of STORE_KEYS) if ((globalThis as G)[k]) s[k] = (globalThis as G)[k]
  try { localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(s)) } catch { /* quota: keep working in memory */ }
}
