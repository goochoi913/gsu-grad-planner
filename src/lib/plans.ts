/**
 * The plan list — several named plans to build, switch between and compare. Pure helpers;
 * the state and the Firebase sync are in src/lib/store.ts.
 *
 * planner/planIndex = { order: [ids], names: { id: name } }. `names` says which plans exist;
 * `order` only sorts them, so a plan made on one device while the other reorders the list is
 * never lost — it just goes last.
 */
export interface PlanMeta {
  id: string
  name: string
}

export const MAIN_PLAN_ID = 'main'
export const MAIN_PLAN_NAME = 'Eunbee’s plan'
export const DEFAULT_PLANS: PlanMeta[] = [{ id: MAIN_PLAN_ID, name: MAIN_PLAN_NAME }]
export const PLAN_NAME_MAX = 60

export function validPlanId(id: unknown): id is string {
  return typeof id === 'string' && (id === MAIN_PLAN_ID || /^[a-z0-9]{4,40}$/.test(id))
}

/** Lower-case letters and digits only, so it is a safe document id and map key. */
export function newPlanId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.replace(/[^a-z0-9]/g, '')
}

export function cleanPlanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, PLAN_NAME_MAX) : ''
}

/** The ordered list from a planner/planIndex document (or the single first plan when there isn't one). */
export function planListFrom(raw: unknown): PlanMeta[] {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; names?: unknown }
  const names = (doc.names && typeof doc.names === 'object' && !Array.isArray(doc.names) ? doc.names : {}) as Record<string, unknown>
  const ids = Object.keys(names).filter((id) => validPlanId(id) && typeof names[id] === 'string')
  const ordered = Array.isArray(doc.order) ? (doc.order as unknown[]).filter((id): id is string => typeof id === 'string' && ids.includes(id)) : []
  const list = [...new Set([...ordered, ...ids.filter((id) => !ordered.includes(id)).sort()])]
  return list.length ? list.map((id) => ({ id, name: cleanPlanName(names[id]) || 'Untitled plan' })) : DEFAULT_PLANS
}

/** "Plan 2", "Plan 3", … — the first number not taken. */
export function nextPlanName(plans: PlanMeta[]): string {
  const taken = new Set(plans.map((p) => p.name.toLowerCase()))
  for (let n = plans.length + 1; ; n++) if (!taken.has(`plan ${n}`)) return `Plan ${n}`
}

/** "Plan 2 (copy)", then "Plan 2 (copy 2)", … */
export function copyName(name: string, plans: PlanMeta[]): string {
  const taken = new Set(plans.map((p) => p.name.toLowerCase()))
  const base = cleanPlanName(`${name} (copy)`)
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const next = cleanPlanName(`${name} (copy ${n})`)
    if (!taken.has(next.toLowerCase())) return next
  }
}
