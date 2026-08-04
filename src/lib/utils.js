import { addDays, addMonths, format, parseISO, isBefore, isToday } from 'date-fns'

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

export const fmtDate = iso => {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'd MMM yyyy') } catch { return iso }
}

export const fmtDateTime = iso => {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'd MMM HH:mm') } catch { return iso }
}

export const isOverdue = (dueISO, status) =>
  status !== 'Closed' && dueISO && isBefore(parseISO(dueISO), new Date()) && !isToday(parseISO(dueISO))

export const doneCt = wo => (wo.wo_tasks || []).filter(t => t.done).length
export const spentHrs = wo => (wo.wo_tasks || []).reduce((s, t) => s + (parseFloat(t.hrs_spent) || 0), 0)

export function closeBlockers(wo) {
  const tasks = wo.wo_tasks || []
  if (!tasks.length) return { blocked: false, msgs: [] }
  const msgs = []
  const unticked = tasks.filter(t => !t.done).length
  const noHrs = tasks.filter(t => t.done && (t.hrs_spent == null || isNaN(parseFloat(t.hrs_spent)))).length
  if (unticked) msgs.push(unticked + ' task(s) not ticked')
  if (noHrs) msgs.push(noHrs + ' ticked task(s) missing hours')
  return { blocked: msgs.length > 0, msgs }
}

export function assetPath(assetId, assets) {
  const parts = []
  let a = assets.find(x => x.id === assetId)
  let guard = 0
  while (a && guard++ < 10) {
    parts.unshift(a.name)
    a = a.parent_id ? assets.find(x => x.id === a.parent_id) : null
  }
  return parts.join(' › ')
}

export function buildAssetTree(assets, closedIds = {}) {
  const kids = pid => assets.filter(a => (a.parent_id || null) === pid)
  const result = []
  const walk = (pid, depth) => {
    kids(pid).forEach(a => {
      const hasKids = kids(a.id).length > 0
      result.push({ a, depth, hasKids })
      if (!closedIds[a.id]) walk(a.id, depth + 1)
    })
  }
  walk(null, 0)
  return result
}

export const advanceDate = (iso, freq) => {
  const d = parseISO(iso)
  if (freq === 'daily') return format(addDays(d, 1), 'yyyy-MM-dd')
  if (freq === 'weekly') return format(addDays(d, 7), 'yyyy-MM-dd')
  return format(addMonths(d, 1), 'yyyy-MM-dd')
}

export const PRIORITY_COLOR = { High: '#DC2626', Medium: '#D97706', Low: '#16A34A' }
export const KIND_IC = { location: '🏭', line: '🔗', equipment: '🔩', tool: '🧰' }