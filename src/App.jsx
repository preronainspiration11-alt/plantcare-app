import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { MASTER } from './masterData'

/* ══════════════════════════════════════════════════════════════════════════
   SUPABASE  — the one place credentials live
   ══════════════════════════════════════════════════════════════════════════ */
const supabase = createClient(
  'https://itzkbcwyxrvldvkgxcfa.supabase.co',
  'sb_publishable_mEymDkUn9Pgl3KVahDqiiw_qssAnB-F'
)



const TODAY = () => new Date().toISOString().slice(0, 10)

/* ══════════════════════════════════════════════════════════════════════════
   PURE HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtDateTime = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }
const doneCt = wo => (wo.wo_tasks || []).filter(t => t.done).length
const spentHrs = wo => (wo.wo_tasks || []).reduce((s, t) => s + (parseFloat(t.hrs_spent) || 0), 0)
const estHrs = wo => (wo.wo_tasks || []).reduce((s, t) => s + (parseFloat(t.est_hrs) || 0), 0)
const PRIORITY_COLOR = { High: '#DC2626', Medium: '#D97706', Low: '#16A34A' }
const KIND_IC = { location: '🏭', line: '🔗', equipment: '🔩', tool: '🧰' }

// PM vs Breakdown terminology. Preventive => "PM Ticket"; Corrective => "Breakdown Work Order".
const isPM = wo => wo.type === 'Preventive'
const ticketKind = wo => isPM(wo) ? 'PM Ticket' : 'Breakdown Work Order'
const ticketKindShort = wo => isPM(wo) ? 'PM Ticket' : 'Breakdown'
// actual worked duration in hours from started_at/completed_at timestamps
const durationHrs = wo => {
  if (!wo.started_at || !wo.completed_at) return null
  const h = (Date.parse(wo.completed_at) - Date.parse(wo.started_at)) / 3600000
  return (isNaN(h) || h < 0) ? null : h
}
// new close rule: every task ticked AND both start & completion times filled
function closeBlockers(wo) {
  const tasks = wo.wo_tasks || []
  const msgs = []
  const un = tasks.filter(t => !t.done).length
  if (un) msgs.push(`${un} task(s) not ticked`)
  if (!wo.started_at) msgs.push('Start Time not set')
  if (!wo.completed_at) msgs.push('Completion Time not set')
  return { blocked: msgs.length > 0, msgs }
}
function assetPath(id, assets) {
  const parts = []; let a = assets.find(x => x.id === id); let g = 0
  while (a && g++ < 10) { parts.unshift(a.name); a = a.parent_id ? assets.find(x => x.id === a.parent_id) : null }
  return parts.join(' › ')
}
function buildTree(assets, closed = {}) {
  const kids = pid => assets.filter(a => (a.parent_id || null) === pid)
  const out = []
  const walk = (pid, depth) => kids(pid).forEach(a => { const hk = kids(a.id).length > 0; out.push({ a, depth, hasKids: hk }); if (!closed[a.id]) walk(a.id, depth + 1) })
  walk(null, 0); return out
}
function advanceDate(iso, freq) {
  const d = new Date(iso)
  if (freq === 'daily') d.setDate(d.getDate() + 1)
  else if (freq === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

/* ══════════════════════════════════════════════════════════════════════════
   DATA LAYER  — every DB call
   ══════════════════════════════════════════════════════════════════════════ */
async function qWorkOrders() {
  const { data, error } = await supabase.from('work_orders').select('*, wo_tasks(*), wo_parts(*), wo_log(*)').order('due_date', { ascending: true })
  if (error) throw error
  return (data || []).map(w => ({ ...w, wo_tasks: (w.wo_tasks || []).sort((a, b) => a.position - b.position), wo_log: (w.wo_log || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) }))
}
async function qAssets() { const { data, error } = await supabase.from('assets').select('*').order('name'); if (error) throw error; return data || [] }
async function qUsers() { const { data, error } = await supabase.from('profiles').select('*').order('name'); if (error) throw error; return data || [] }
async function qTaskGroups() { const { data, error } = await supabase.from('task_groups').select('*, task_group_items(*)').order('name'); if (error) throw error; return (data || []).map(g => ({ ...g, task_group_items: (g.task_group_items || []).sort((a, b) => a.position - b.position) })) }
async function qProjects() { const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || [] }
async function qSchedules() { const { data, error } = await supabase.from('schedules').select('*').order('next_due'); if (error) throw error; return data || [] }
async function qWorkReqs() { const { data, error } = await supabase.from('work_requests').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || [] }
async function qPurchReqs() { const { data, error } = await supabase.from('purchase_requests').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || [] }

async function createWO(wo) {
  const { tasks, log, ...fields } = wo
  const { data, error } = await supabase.from('work_orders').insert(fields).select().single()
  if (error) throw error
  const id = data.id
  if (tasks?.length) await supabase.from('wo_tasks').insert(tasks.map((t, i) => ({ wo_id: id, position: i, description: t.description, est_hrs: parseFloat(t.est_hrs) || null })))
  if (log?.length) await supabase.from('wo_log').insert(log.map(l => ({ wo_id: id, author_name: l.author_name, body: l.body })))
  return id
}
const updWO = (id, f) => supabase.from('work_orders').update(f).eq('id', id)
const updTask = (id, f) => supabase.from('wo_tasks').update(f).eq('id', id)
const addLog = (woId, name, body) => supabase.from('wo_log').insert({ wo_id: woId, author_name: name, body })
const addPartRow = (woId, name, qty) => supabase.from('wo_parts').insert({ wo_id: woId, name, qty })
const upsertAsset = a => supabase.from('assets').upsert(a)
async function saveTG(tg, items) {
  const { data, error } = await supabase.from('task_groups').upsert(tg).select().single()
  if (error) throw error
  await supabase.from('task_group_items').delete().eq('task_group_id', data.id)
  if (items.length) await supabase.from('task_group_items').insert(items.map((it, i) => ({ task_group_id: data.id, position: i, description: it.description, est_hrs: parseFloat(it.est_hrs) || null })))
}
const delTG = id => supabase.from('task_groups').delete().eq('id', id)
const saveSched = s => supabase.from('schedules').upsert(s)
const updSched = (id, f) => supabase.from('schedules').update(f).eq('id', id)
const delSched = id => supabase.from('schedules').delete().eq('id', id)
const saveWReq = r => supabase.from('work_requests').upsert(r)
const savePReq = r => supabase.from('purchase_requests').upsert(r)

/* ══════════════════════════════════════════════════════════════════════════
   ROLES, PERMISSIONS & CREWS  — one source of truth
   The rows below drive BOTH what the app actually allows (permsFor) AND the
   on-screen "Role permission matrix" in Settings, so the two can never drift.
   ══════════════════════════════════════════════════════════════════════════ */
const ROLES = { admin: 'Administrator', manager: 'Maintenance Manager', technician: 'Technician' }
const ROLE_ORDER = ['admin', 'manager', 'technician']
// each capability = one enforced perm key + its human label
const PERM_ROWS = [
  { key: 'viewAll', label: 'See all work orders' },
  { key: 'edit', label: 'Edit / assign work orders' },
  { key: 'create', label: 'Create work orders' },
  { key: 'approve', label: 'Approve requests' },
  { key: 'manageAssets', label: 'Add / edit assets' },
  { key: 'manageTG', label: 'Manage task groups' },
  { key: 'manageUsers', label: 'Manage users & groups' },
]
const ROLE_MATRIX = {
  admin:      { viewAll: 1, edit: 1, create: 1, approve: 1, manageAssets: 1, manageTG: 1, manageUsers: 1 },
  manager:    { viewAll: 1, edit: 1, create: 1, approve: 1, manageAssets: 1, manageTG: 1, manageUsers: 0 },
  technician: { viewAll: 0, edit: 0, create: 0, approve: 0, manageAssets: 0, manageTG: 0, manageUsers: 0 },
}
const permsFor = role => Object.fromEntries(PERM_ROWS.map(r => [r.key, !!(ROLE_MATRIX[role] || ROLE_MATRIX.technician)[r.key]]))
// maintenance crews (the "Group" column in Settings). Manufacturing & Packing
// stay separate all the way down; crews are the people who service them.
const CREWS = [
  { id: 'plant_admin', name: 'Plant Administration' },
  { id: 'maint_mgr', name: 'Maintenance Manager' },
  { id: 'mech', name: 'Mechanical Crew' },
  { id: 'elec', name: 'Electrical Crew' },
  { id: 'util', name: 'Utility Crew' },
]
const crewName = id => CREWS.find(c => c.id === id)?.name || '—'
const defaultCrew = role => (role === 'admin' ? 'plant_admin' : role === 'manager' ? 'maint_mgr' : 'mech')

/* ══════════════════════════════════════════════════════════════════════════
   GLOBAL STATE
   ══════════════════════════════════════════════════════════════════════════ */
const Ctx = createContext(null)
const useApp = () => useContext(Ctx)

function AppProvider({ children }) {
  const [profile, setProfile] = useState(null)
  const [assets, setAssets] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [users, setUsers] = useState([])
  const [taskGroups, setTaskGroups] = useState([])
  const [projects, setProjects] = useState([])
  const [schedules, setSchedules] = useState([])
  const [workReqs, setWorkReqs] = useState([])
  const [purchReqs, setPurchReqs] = useState([])
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const role = profile?.role || 'technician'
  const perms = permsFor(role)

  const rWOs = useCallback(async () => { try { setWorkOrders(await qWorkOrders()) } catch (e) { setErr(e.message) } }, [])
  const rAssets = useCallback(async () => { try { setAssets(await qAssets()) } catch (e) { setErr(e.message) } }, [])
  const rUsers = useCallback(async () => { try { setUsers(await qUsers()) } catch (e) { setErr(e.message) } }, [])
  const rTGs = useCallback(async () => { try { setTaskGroups(await qTaskGroups()) } catch (e) { setErr(e.message) } }, [])
  const rProjects = useCallback(async () => { try { setProjects(await qProjects()) } catch (e) { setErr(e.message) } }, [])
  const rScheds = useCallback(async () => { try { setSchedules(await qSchedules()) } catch (e) { setErr(e.message) } }, [])
  const rWReqs = useCallback(async () => { try { setWorkReqs(await qWorkReqs()) } catch (e) { setErr(e.message) } }, [])
  const rPReqs = useCallback(async () => { try { setPurchReqs(await qPurchReqs()) } catch (e) { setErr(e.message) } }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([rWOs(), rAssets(), rUsers(), rTGs(), rProjects(), rScheds(), rWReqs(), rPReqs()])
  }, [])

  useEffect(() => {
    let active = true
    async function boot(session) {
      if (!session) { if (active) { setProfile(null); setLoading(false) }; return }
      setLoading(true)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (!active) return
      setProfile(prof)
      await refreshAll()
      if (active) setLoading(false)
    }
    supabase.auth.getSession().then(({ data: { session } }) => boot(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => boot(session))
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  return (
    <Ctx.Provider value={{ profile, perms, loading, err, flash, setFlash, assets, workOrders, users, taskGroups, projects, schedules, workReqs, purchReqs, rWOs, rAssets, rUsers, rTGs, rProjects, rScheds, rWReqs, rPReqs, refreshAll }}>
      {children}
    </Ctx.Provider>
  )
}

const PLANTS = [
  { id: 'p1', name: 'Uluberia Plant', code: 'PCUB', loc: 'ITC PCPB · West Bengal', ic: '🏭', bg: '#CCFBF1' },
  { id: 'p2', name: 'Manpura Plant', code: 'PCMP', loc: 'ITC PCPB · Himachal Pradesh', ic: '⚙️', bg: '#EDE9FE' },
  { id: 'p3', name: 'Haridwar Plant', code: 'PCHD', loc: 'ITC PCPB · Uttarakhand', ic: '🔧', bg: '#FEF3C7' },
]
function LoginScreen() {
  const [plantId, setPlantId] = useState(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const pl = PLANTS.find(p => p.id === plantId)
  const login = async () => {
    if (!email || !pw) { setErr('Enter email and password.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    setBusy(false)
    if (error) setErr(error.message)
  }
  if (!plantId) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-teal-900">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-3"><div className="w-10 h-10 bg-teal-400 rounded-2xl flex items-center justify-center text-white font-black text-xl">P</div><div className="text-white text-2xl font-black">PlantCare <span className="text-teal-300">CMMS</span></div></div>
        <p className="text-slate-400 text-center text-sm mb-8">ITC PCPB — Preventive Maintenance System</p>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="font-bold text-base mb-1">Choose your plant</div>
          <p className="text-xs text-slate-400 mb-4">You'll only see your own plant's data.</p>
          {PLANTS.map(p => <button key={p.id} onClick={() => setPlantId(p.id)} className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-2xl mb-3 text-left hover:border-teal-400 hover:bg-teal-50 transition-colors"><div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: p.bg }}>{p.ic}</div><div><div className="font-bold text-sm">{p.name}</div><div className="text-xs text-slate-400">{p.loc}</div></div><span className="ml-auto text-teal-600 font-black">→</span></button>)}
        </div>
      </div>
    </div>
  )
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-teal-900">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-3"><div className="w-10 h-10 bg-teal-400 rounded-2xl flex items-center justify-center text-white font-black text-xl">P</div><div className="text-white text-2xl font-black">PlantCare <span className="text-teal-300">CMMS</span></div></div>
        <p className="text-slate-400 text-center text-sm mb-8">Preventive Maintenance System</p>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 text-teal-800 rounded-full px-3 py-1.5 text-xs font-bold mb-5">{pl.ic} {pl.name} · {pl.code}</div>
          <div className="font-bold text-base mb-4">Sign in</div>
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5 mb-4">{err}</div>}
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="you@itc.in" autoFocus />
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="••••••••" />
          <button onClick={login} disabled={busy} className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl py-3 text-sm transition-colors disabled:opacity-60">{busy ? 'Signing in…' : `Sign in to ${pl.name}`}</button>
          <button onClick={() => { setPlantId(null); setErr('') }} className="block w-full text-center text-teal-700 text-xs font-bold mt-4">← Change plant</button>
        </div>
      </div>
    </div>
  )
}
function AuthGate({ children }) {
  const { profile, loading } = useApp()
  const [checked, setChecked] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setHasSession(!!session); setChecked(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s))
    return () => subscription.unsubscribe()
  }, [])
  if (!checked) return <Spinner />
  if (!hasSession) return <LoginScreen />
  if (loading || !profile) return <Spinner />
  return children
}

/* ══════════════════════════════════════════════════════════════════════════
   UI PRIMITIVES
   ══════════════════════════════════════════════════════════════════════════ */
const Badge = ({ variant = 'status', children }) => {
  const c = { High: 'bg-red-100 text-red-800', Medium: 'bg-amber-100 text-amber-800', Low: 'bg-green-100 text-green-800', status: 'bg-slate-100 text-slate-600', type: 'bg-indigo-50 text-indigo-700', pm: 'bg-teal-100 text-teal-800', bd: 'bg-rose-100 text-rose-800', pending: 'bg-amber-100 text-amber-800', ok: 'bg-green-100 text-green-800', rej: 'bg-red-100 text-red-800' }[variant] || 'bg-slate-100 text-slate-600'
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${c}`}>{children}</span>
}
// convenience: kind badge for a work order
const KindBadge = ({ wo }) => <Badge variant={isPM(wo) ? 'pm' : 'bd'}>{ticketKindShort(wo)}</Badge>
const Btn = ({ variant = 'line', children, className = '', ...p }) => {
  const c = { teal: 'bg-teal-700 text-white hover:bg-teal-800', line: 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50', ghost: 'border border-teal-700 text-teal-700 bg-white hover:bg-teal-50', red: 'border border-red-300 text-red-600 bg-white hover:bg-red-50', dark: 'bg-slate-800 text-white hover:bg-slate-700' }[variant] || ''
  return <button {...p} className={`rounded-xl px-3.5 py-2 text-sm font-bold cursor-pointer transition-colors ${c} ${className}`}>{children}</button>
}
const Card = ({ children, className = '' }) => <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`}>{children}</div>
const CardHead = ({ children, action }) => <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 font-bold text-sm"><span>{children}</span>{action}</div>
const Lbl = ({ children }) => <div className="text-xs uppercase tracking-wide text-slate-400 font-bold mb-1">{children}</div>
const KPICard = ({ title, value, sub, color = 'text-slate-900' }) => <Card className="p-4"><Lbl>{title}</Lbl><div className={`text-3xl font-black mt-1 ${color}`}>{value}</div>{sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}</Card>
const Input = ({ className = '', ...p }) => <input {...p} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400 ${className}`} />
const Select = ({ children, className = '', ...p }) => <select {...p} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400 ${className}`}>{children}</select>
const Textarea = ({ className = '', ...p }) => <textarea {...p} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white resize-y focus:outline-none focus:ring-2 focus:ring-teal-600 ${className}`} />
const Field = ({ label, children, full }) => <div className={full ? 'sm:col-span-2' : ''}><Lbl>{label}</Lbl>{children}</div>
const Pill = ({ on, children }) => <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${on ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-600'}`}>{children}</span>
const Note = ({ variant = 'grey', children }) => { const c = { grey: 'bg-slate-50 border-slate-200 text-slate-600', amber: 'bg-amber-50 border-amber-200 text-amber-800', red: 'bg-red-50 border-red-200 text-red-700' }[variant]; return <div className={`text-sm rounded-xl p-3 mb-3 border ${c}`}>{children}</div> }
const ProgressBar = ({ done, total }) => <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-3"><div className="h-full bg-teal-600 rounded-full transition-all" style={{ width: `${total ? done / total * 100 : 0}%` }} /></div>
const HBar = ({ label, value, max, color = '#0F766E' }) => <div className="flex items-center gap-3 px-4 py-1.5 text-sm"><span className="w-40 flex-shrink-0 text-slate-500 truncate">{label}</span><div className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden"><div className="h-full rounded-md" style={{ width: `${max ? value / max * 100 : 0}%`, background: color }} /></div><span className="w-10 text-right font-bold text-slate-700">{value}</span></div>
const RingSVG = ({ n, total, color }) => { const R = 48, C = 2 * Math.PI * R, p = total ? n / total : 0; return <svg width={104} height={104} viewBox="0 0 120 120"><circle cx={60} cy={60} r={R} fill="none" stroke="#E2E8F0" strokeWidth={13} /><circle cx={60} cy={60} r={R} fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 60 60)" /><text x={60} y={56} textAnchor="middle" fontSize={24} fontWeight={700} fill="#0F172A">{n}</text><text x={60} y={75} textAnchor="middle" fontSize={11} fill="#64748B">of {total}</text></svg> }
const GaugeSVG = ({ pct }) => { const R = 46, C = Math.PI * R; return <svg width={112} height={68} viewBox="0 0 120 72"><path d="M 14 62 A 46 46 0 0 1 106 62" fill="none" stroke="#E2E8F0" strokeWidth={12} strokeLinecap="round" /><path d="M 14 62 A 46 46 0 0 1 106 62" fill="none" stroke="#1D4ED8" strokeWidth={12} strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} /><text x={60} y={58} textAnchor="middle" fontSize={20} fontWeight={700} fill="#0F172A">{Math.round(pct * 100)}%</text></svg> }
const Spinner = () => <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" /></div>

function Modal({ title, eyebrow, onClose, footer, children, maxWidth = 'max-w-3xl' }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-2xl w-full ${maxWidth} max-h-[92vh] flex flex-col shadow-2xl`}>
        <div className="px-5 pt-5 pb-4 border-b border-slate-200">
          <button onClick={onClose} className="float-right text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
          {eyebrow && <div className="text-xs uppercase tracking-wide text-slate-400 font-bold">{eyebrow}</div>}
          <div className="text-lg font-black mt-1">{title}</div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-2 flex-wrap">{footer}</div>}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   WORK ORDER MODAL  (PM Ticket / Breakdown)
   New: Work Permit No, Start/Completion timestamps, Remarks. No per-task hours.
   ══════════════════════════════════════════════════════════════════════════ */
function WOModal({ wo, onClose }) {
  const { profile, perms, users, assets, projects, rWOs } = useApp()
  const [tab, setTab] = useState('checklist')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [cErr, setCErr] = useState('')
  if (!wo) return null
  const a = assets.find(x => x.id === wo.asset_id) || { name: '?', status: 'Online' }
  const closed = wo.status === 'Closed'
  const canExec = perms.edit || wo.assigned_to === profile?.id
  const dn = doneCt(wo), blk = closeBlockers(wo)
  const dur = durationHrs(wo)
  const lockTask = !canExec || closed, lockEdit = !perms.edit || closed

  const tog = async (t, v) => { await updTask(t.id, { done: v }); await rWOs(); setCErr('') }
  const res = async (t, v) => { await updTask(t.id, { result: v || null }); await rWOs() }
  const fld = async (f, v) => { await updWO(wo.id, { [f]: v === '' ? null : v }); await rWOs(); setCErr('') }
  const start = async () => { setSaving(true); await updWO(wo.id, { status: 'In Progress' }); await rWOs(); setSaving(false) }
  const close = async () => {
    if (blk.blocked) { setCErr('Cannot close: ' + blk.msgs.join(', ') + '.'); return }
    setSaving(true)
    await updWO(wo.id, { status: 'Closed', closed_on: TODAY() })
    const d = durationHrs(wo)
    await addLog(wo.id, profile.name, `Closed — ${wo.wo_tasks.length} tasks done${d != null ? `, ${d.toFixed(1)} h actual duration` : ''}.`)
    await rWOs(); setSaving(false); onClose()
  }
  const addN = async () => { if (!note.trim()) return; setSaving(true); await addLog(wo.id, profile.name, note.trim()); await rWOs(); setNote(''); setSaving(false) }
  const addP = async () => { const n = prompt('Part name'); if (!n) return; await addPartRow(wo.id, n, 1); await rWOs() }

  const tabs = [['checklist', `Checklist (${dn}/${wo.wo_tasks?.length ?? 0})`], ['general', 'General'], ['parts', `Parts (${wo.wo_parts?.length ?? 0})`], ['log', `Log (${wo.wo_log?.length ?? 0})`]]
  let body
  if (tab === 'checklist') body = <>
    {closed && <Note>Closed {fmtDate(wo.closed_on)}{dur != null ? ` — ${dur.toFixed(1)} h actual duration` : ''}.</Note>}
    {!closed && canExec && <Note variant="amber">To close this {isPM(wo) ? 'PM ticket' : 'breakdown work order'}: tick every task <strong>and</strong> fill both Start Time and Completion Time (in the General tab).</Note>}

    {/* Work permit + start/completion live at the top of the checklist for quick entry */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      <Field label="Work Permit No."><Input defaultValue={wo.permit_no ?? ''} disabled={lockEdit} onBlur={e => fld('permit_no', e.target.value)} placeholder="e.g. WP-2026-0500" /></Field>
      <Field label={isPM(wo) ? 'PM Start Time' : 'Job Start Time'}><Input type="datetime-local" defaultValue={wo.started_at ?? ''} disabled={lockEdit} onChange={e => fld('started_at', e.target.value)} /></Field>
      <Field label="Completion Time"><Input type="datetime-local" defaultValue={wo.completed_at ?? ''} disabled={lockEdit} onChange={e => fld('completed_at', e.target.value)} /></Field>
    </div>

    <Lbl>Checklist</Lbl>
    <div className="grid grid-cols-[1fr_150px] gap-2 px-2 pb-2 text-xs font-bold uppercase text-slate-400"><span>Task</span><span>Result</span></div>
    {(wo.wo_tasks || []).map(t => (
      <div key={t.id} className={`grid grid-cols-[1fr_150px] gap-2 border rounded-xl p-2.5 mb-2 items-center ${t.done ? 'bg-teal-50 border-teal-200' : 'border-slate-200'}`}>
        <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={t.done} disabled={lockTask} onChange={e => tog(t, e.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-600" /><span className={`text-sm ${t.done ? 'line-through text-slate-400' : ''}`}>{t.description}</span></label>
        <select defaultValue={t.result || ''} disabled={lockTask} onChange={e => res(t, e.target.value)} className="border border-slate-300 rounded-lg px-1 py-1 text-sm w-full disabled:bg-slate-50"><option value="">Result…</option>{['OK', 'Adjusted', 'Replaced', 'Needs attention'].map(r => <option key={r}>{r}</option>)}</select>
      </div>))}
    <ProgressBar done={dn} total={wo.wo_tasks?.length ?? 0} />
    <div className="text-xs text-slate-400 mt-1.5">{dn}/{wo.wo_tasks?.length ?? 0} tasks{dur != null ? ` · ${dur.toFixed(1)} h actual duration` : (wo.started_at && !wo.completed_at ? ' · started, awaiting completion time' : '')}</div>

    {/* Remarks */}
    <div className="mt-4"><Lbl>Remarks</Lbl><Textarea rows={3} defaultValue={wo.remarks ?? ''} disabled={lockEdit} onBlur={e => fld('remarks', e.target.value)} placeholder="Observations, parts used, follow-ups…" /></div>
  </>
  else if (tab === 'general') body = <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <Field label="Priority"><Select defaultValue={wo.priority} disabled={lockEdit} onChange={e => fld('priority', e.target.value)}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field>
    <Field label="Type"><Select defaultValue={wo.type} disabled={lockEdit} onChange={e => fld('type', e.target.value)}><option value="Preventive">Preventive (PM Ticket)</option><option value="Corrective">Corrective (Breakdown)</option></Select></Field>
    <Field label="Assigned to"><Select defaultValue={wo.assigned_to ?? ''} disabled={lockEdit} onChange={e => fld('assigned_to', e.target.value)}><option value="">— None —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
    <Field label="Project"><Select defaultValue={wo.project_id ?? ''} disabled={lockEdit} onChange={e => fld('project_id', e.target.value)}><option value="">— None —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    <Field label="Work Permit No."><Input defaultValue={wo.permit_no ?? ''} disabled={lockEdit} onBlur={e => fld('permit_no', e.target.value)} placeholder="e.g. WP-2026-0500" /></Field>
    <Field label="Actual duration"><Input value={dur != null ? dur.toFixed(1) + ' h' : '—'} disabled /></Field>
    <Field label={isPM(wo) ? 'PM Start Time' : 'Job Start Time'}><Input type="datetime-local" defaultValue={wo.started_at ?? ''} disabled={lockEdit} onChange={e => fld('started_at', e.target.value)} /></Field>
    <Field label="Completion Time"><Input type="datetime-local" defaultValue={wo.completed_at ?? ''} disabled={lockEdit} onChange={e => fld('completed_at', e.target.value)} /></Field>
    <Field label="Start date (planned)"><Input type="date" defaultValue={wo.start_date} disabled={lockEdit} onBlur={e => fld('start_date', e.target.value)} /></Field>
    <Field label="Due date"><Input type="date" defaultValue={wo.due_date} disabled={lockEdit} onBlur={e => fld('due_date', e.target.value)} /></Field>
    <Field label="Asset" full><Input value={assetPath(wo.asset_id, assets)} disabled /></Field>
    <Field label="Remarks" full><Textarea rows={3} defaultValue={wo.remarks ?? ''} disabled={lockEdit} onBlur={e => fld('remarks', e.target.value)} placeholder="Observations, parts used, follow-ups…" /></Field>
  </div>
  else if (tab === 'parts') body = <>
    {(wo.wo_parts || []).length === 0 && <p className="text-sm text-slate-400">No parts reserved.</p>}
    {(wo.wo_parts || []).map(p => <div key={p.id} className="flex justify-between border border-slate-200 rounded-xl px-3 py-2.5 mb-2 text-sm"><span>{p.name}</span><span className="text-slate-400">Qty {p.qty}</span></div>)}
    {perms.edit && !closed && <Btn variant="ghost" className="mt-1 text-sm" onClick={addP}>+ Add part</Btn>}
  </>
  else body = <>
    {(wo.wo_log || []).length === 0 && <p className="text-sm text-slate-400 mb-3">No entries yet.</p>}
    {(wo.wo_log || []).map(l => <div key={l.id} className="border border-slate-200 rounded-xl px-3 py-2.5 mb-2"><div className="text-xs text-slate-400 mb-1"><strong className="text-slate-700">{l.author_name}</strong> · {fmtDateTime(l.created_at)}</div><p className="text-sm">{l.body}</p></div>)}
    {canExec && !closed && <div className="flex gap-2 mt-2"><input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addN()} placeholder="Add a note…" className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" /><Btn variant="dark" onClick={addN} disabled={saving}>Add</Btn></div>}
  </>

  return (
    <Modal eyebrow={`${ticketKind(wo)} · ${a.name}`} title={`#${wo.id} · ${wo.title}`} onClose={onClose}
      footer={<>{!closed && canExec && wo.status === 'Open' && <Btn variant="line" onClick={start} disabled={saving}>Start work</Btn>}{!closed && canExec && <Btn variant="teal" onClick={close} disabled={saving} className={blk.blocked ? 'opacity-60' : ''}>{blk.blocked ? 'Close 🔒' : `Close ${isPM(wo) ? 'PM ticket' : 'work order'}`}</Btn>}{closed && <span className="text-sm text-slate-400">Closed {fmtDate(wo.closed_on)}</span>}</>}>
      <div className="flex gap-2 mb-3 flex-wrap items-center"><KindBadge wo={wo} /><Badge variant={wo.priority}>{wo.priority}</Badge><Badge variant="status">{wo.status}</Badge><span className="text-xs text-slate-400">{wo.started_at ? `${fmtDateTime(wo.started_at)}` : `planned ${fmtDate(wo.start_date)}`} {wo.completed_at ? `→ ${fmtDateTime(wo.completed_at)}` : ''}</span>{dur != null && <span className="text-xs font-bold text-blue-700">Duration {dur.toFixed(1)} h</span>}</div>
      <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 ${tab === k ? 'text-teal-700 border-teal-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>{l}</button>)}</div>
      {cErr && <Note variant="red">{cErr}</Note>}
      {body}
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   CREATE WORK ORDER MODAL
   ══════════════════════════════════════════════════════════════════════════ */
function CreateWOModal({ onClose, prefill = null, onCreated = null }) {
  const { profile, users, assets, taskGroups, rWOs } = useApp()
  const [f, setF] = useState({ title: prefill?.title || '', asset_id: prefill?.asset_id || (assets[0]?.id ?? ''), assigned_to: users[0]?.id ?? '', priority: prefill?.priority || 'Medium', type: prefill?.type || (prefill?.fromReq ? 'Corrective' : 'Preventive'), start_date: TODAY(), due_date: TODAY(), permit_no: '', tg_id: '', tasks: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(o => ({ ...o, [k]: v }))
  const tree = buildTree(assets)
  const applyTG = id => { const g = taskGroups.find(x => x.id === id); set('tg_id', id); if (!g) return; set('tasks', (g.task_group_items || []).map(t => t.description).join('\n')); if (!f.title) set('title', g.name) }
  const isPMForm = f.type === 'Preventive'
  const save = async () => {
    if (!f.title.trim()) { alert('Enter a title.'); return }
    setSaving(true)
    const g = taskGroups.find(x => x.id === f.tg_id)
    const tasks = f.tasks.split('\n').map(s => s.trim()).filter(Boolean).map((desc, i) => { const it = g?.task_group_items?.find(t => t.description === desc); return { description: desc, position: i, est_hrs: it?.est_hrs ?? null } })
    const id = await createWO({ plant_id: profile.plant_id, title: f.title.trim(), asset_id: f.asset_id || null, assigned_to: f.assigned_to || null, priority: f.priority, type: f.type, start_date: f.start_date, due_date: f.due_date, permit_no: f.permit_no || null, created_by: profile.id, tasks, log: [{ author_name: profile.name, body: `Created${g ? ' from task group: ' + g.name : ''}${prefill?.fromReq ? ' from work request' : ''}.` }] })
    if (onCreated) await onCreated(id)
    await rWOs(); setSaving(false); onClose()
  }
  return (
    <Modal title={isPMForm ? 'New PM ticket' : 'New breakdown work order'} onClose={onClose} maxWidth="max-w-2xl" footer={<><Btn variant="line" onClick={onClose}>Cancel</Btn><Btn variant="teal" onClick={save} disabled={saving}>{isPMForm ? 'Create PM ticket' : 'Create work order'}</Btn></>}>
      {prefill?.desc && <Note>Request: {prefill.desc}</Note>}
      <div className="mb-3"><Lbl>Task group (optional — fills checklist)</Lbl><Select value={f.tg_id} onChange={e => applyTG(e.target.value)}><option value="">— None, type manually —</option>{taskGroups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.task_group_items?.length ?? 0} tasks)</option>)}</Select></div>
      <div className="mb-3"><Lbl>Title</Lbl><Input value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Monthly PM — Case Packer" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Asset"><Select value={f.asset_id} onChange={e => set('asset_id', e.target.value)}>{tree.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name} ({n.a.code})</option>)}</Select></Field>
        <Field label="Assign to"><Select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)}><option value="">— None —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={e => set('priority', e.target.value)}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Type"><Select value={f.type} onChange={e => set('type', e.target.value)}><option value="Preventive">Preventive (PM Ticket)</option><option value="Corrective">Corrective (Breakdown)</option></Select></Field>
        <Field label="Planned start date"><Input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
        <Field label="Work Permit No. (optional)"><Input value={f.permit_no} onChange={e => set('permit_no', e.target.value)} placeholder="WP-2026-0500" /></Field>
      </div>
      <div><Lbl>Checklist tasks — one per line</Lbl><Textarea rows={5} value={f.tasks} onChange={e => set('tasks', e.target.value)} placeholder={"Check belt tension\nLubricate bearings\nInspect seals"} /></div>
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGES
   ══════════════════════════════════════════════════════════════════════════ */
/* Small shared row used by both dashboards' "This week" / "Open work" lists */
function WORow({ w, assets, onOpen }) {
  const a = assets.find(x => x.id === w.asset_id) || { name: '?', code: '' }
  const t = TODAY()
  const od = w.due_date && w.due_date < t
  const total = w.wo_tasks?.length ?? 0
  return (
    <button onClick={() => onOpen(w)} className="flex items-center gap-3 px-4 py-3 w-full text-left border-t border-slate-100 hover:bg-slate-50">
      <span className="w-1.5 h-9 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[w.priority] || '#94A3B8' }} />
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate">#{w.id} · {w.title}</div>
        <div className="text-xs text-slate-400 truncate">{a.name}{a.code ? ` (${a.code})` : ''} · due <span className={od ? 'text-red-600 font-bold' : ''}>{fmtDate(w.due_date)}</span></div>
      </div>
      <span className="text-xs text-slate-400 whitespace-nowrap">{doneCt(w)}/{total} tasks</span>
      <Badge variant={w.priority}>{w.priority}</Badge>
    </button>
  )
}

function ManagerDashboard({ setOpenWO }) {
  const { workOrders, users, assets, workReqs } = useApp()
  const t = TODAY()
  const open = workOrders.filter(w => w.status !== 'Closed')
  const closed = workOrders.filter(w => w.status === 'Closed')
  const overdue = open.filter(w => w.due_date && w.due_date < t)
  const onTime = closed.filter(w => w.closed_on && w.closed_on <= w.due_date)
  const comp = closed.length ? onTime.length / closed.length : 0
  const highOpen = open.filter(w => w.priority === 'High')
  const pendReq = workReqs.filter(r => r.status === 'Pending')
  const backlog = open.reduce((s, w) => s + Math.max(estHrs(w) - spentHrs(w), 0), 0)
  const totSpent = workOrders.reduce((s, w) => s + spentHrs(w), 0)
  const totEst = workOrders.reduce((s, w) => s + estHrs(w), 0)
  const techs = users.filter(u => u.role === 'technician')
  const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
  const week = open.filter(w => (w.status === 'In Progress') || (w.due_date && w.due_date <= weekEnd)).sort((a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1).slice(0, 10)
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <Card className="flex items-center gap-3 p-4 col-span-2"><div className="text-center"><GaugeSVG pct={comp} /></div><div><div className="text-xs font-bold uppercase text-slate-400 mb-1 leading-tight">Schedule Compliance</div><div className="text-xs text-slate-400">{onTime.length} of {closed.length} closed WOs met their due date</div><div className="text-[11px] text-slate-400 mt-0.5">All assets & all groups</div></div></Card>
        <Card className="flex items-center gap-3 p-4"><RingSVG n={overdue.length} total={workOrders.length} color="#B91C1C" /><div className="text-xs font-bold uppercase text-slate-400 leading-tight">Overdue<br />Work Orders</div></Card>
        <KPICard title="High Priority Open" value={highOpen.length} color="text-red-600" />
        <KPICard title="Open Work Orders" value={open.length} color="text-teal-700" />
        <KPICard title="Work Requests Pending" value={pendReq.length} color="text-amber-600" />
        <KPICard title="Closed Work Orders" value={closed.length} color="text-slate-500" />
        <KPICard title="Backlog (est)" value={`${backlog.toFixed(1)} h`} />
        <KPICard title="Hours: Spent vs Est" value={`${totSpent.toFixed(1)} / ${totEst.toFixed(1)} h`} color="text-blue-700" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHead>Workload by technician</CardHead>
          {techs.length === 0 ? <p className="px-4 py-4 text-sm text-slate-400">No technicians yet. Add users in Settings.</p> : techs.map(u => {
            const o = open.filter(w => w.assigned_to === u.id), od = o.filter(w => w.due_date && w.due_date < t)
            return <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 text-sm"><div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: u.color || '#0F766E' }}>{u.initials || '?'}</div><span className="flex-1 truncate">{u.name}</span><span className="text-teal-700 font-bold">{o.length} open</span>{od.length ? <span className="text-red-600 font-bold">{od.length} overdue</span> : <span className="text-slate-400">on track</span>}</div>
          })}
        </Card>
        <Card>
          <CardHead action={<span className="text-xs font-normal text-slate-400">{week.length} due or in progress</span>}>This week</CardHead>
          {week.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing due this week.</p> : week.map(w => <WORow key={w.id} w={w} assets={assets} onOpen={setOpenWO} />)}
        </Card>
      </div>
    </>
  )
}

function TechnicianDashboard({ setOpenWO }) {
  const { profile, workOrders, assets } = useApp()
  const t = TODAY()
  const mineAll = workOrders.filter(w => w.assigned_to === profile?.id)
  const mineOpen = mineAll.filter(w => w.status !== 'Closed')
  const mineOverdue = mineOpen.filter(w => w.due_date && w.due_date < t)
  const inProg = mineOpen.filter(w => w.status === 'In Progress')
  const myHrs = mineAll.reduce((s, w) => s + spentHrs(w), 0)
  const closedThisWk = (() => { const d = new Date(); d.setDate(d.getDate() - 7); const c = d.toISOString().slice(0, 10); return mineAll.filter(w => w.status === 'Closed' && w.closed_on && w.closed_on >= c) })()
  const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
  const todo = [...mineOpen].sort((a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1)
  const upcoming = todo.filter(w => !(w.due_date && w.due_date <= weekEnd))
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KPICard title="My Open Tickets" value={mineOpen.length} color="text-teal-700" />
        <KPICard title="My Overdue" value={mineOverdue.length} color={mineOverdue.length ? 'text-red-600' : 'text-slate-500'} />
        <KPICard title="In Progress" value={inProg.length} color="text-blue-700" />
        <KPICard title="Hours Logged" value={`${myHrs.toFixed(1)} h`} sub={`${closedThisWk.length} closed in last 7 days`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHead action={<span className="text-xs font-normal text-slate-400">{todo.length} assigned to you</span>}>My work — do next</CardHead>
          {todo.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing assigned to you right now. 🎉</p> : todo.slice(0, 8).map(w => <WORow key={w.id} w={w} assets={assets} onOpen={setOpenWO} />)}
        </Card>
        <Card>
          <CardHead>Later / upcoming</CardHead>
          {upcoming.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing scheduled beyond this week.</p> : upcoming.slice(0, 8).map(w => <WORow key={w.id} w={w} assets={assets} onOpen={setOpenWO} />)}
        </Card>
      </div>
    </>
  )
}

function DashboardPage() {
  const { profile, perms, workOrders } = useApp()
  const [openWO, setOpenWO] = useState(null)
  const canManage = perms.viewAll // manager / admin
  const [view, setView] = useState(canManage ? 'manager' : 'tech')
  const Tab = ({ id, children }) => (
    <button onClick={() => setView(id)} className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${view === id ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{children}</button>
  )
  return (
    <div className="p-6">
      {canManage ? (
        <div className="flex items-center gap-1 border-b border-slate-200 mb-5">
          <Tab id="tech">Technician Dashboard</Tab>
          <Tab id="manager">Manager Dashboard</Tab>
        </div>
      ) : (
        <h1 className="text-xl font-black mb-5">My Dashboard</h1>
      )}
      {view === 'manager' && canManage ? <ManagerDashboard setOpenWO={setOpenWO} /> : <TechnicianDashboard setOpenWO={setOpenWO} />}
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)} />}
    </div>
  )
}

function WorkOrdersPage({ mine = false }) {
  const { profile, perms, workOrders, assets, users } = useApp()
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('All')
  const [kindF, setKindF] = useState('all') // all | PM | BD
  const [openWO, setOpenWO] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createType, setCreateType] = useState('Preventive')
  const t = TODAY()
  const base = mine ? workOrders.filter(w => w.assigned_to === profile?.id) : workOrders
  const list = base
    .filter(w => kindF === 'all' || (kindF === 'PM' ? isPM(w) : !isPM(w)))
    .filter(w => statusF === 'All' || w.status === statusF)
    .filter(w => { const a = assets.find(x => x.id === w.asset_id) || { name: '', code: '' }; return (w.title + w.id + a.name + a.code).toLowerCase().includes(search.toLowerCase()) })
    .sort((a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1)
  const nPM = base.filter(isPM).length, nBD = base.filter(w => !isPM(w)).length
  const startCreate = type => { setCreateType(type); setCreating(true) }
  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="text-xl font-black">{mine ? 'Assigned to me' : 'Work Orders'}</h1>
        <div className="flex-1" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="border border-slate-300 rounded-xl px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-teal-600" />
        <Select value={statusF} onChange={e => setStatusF(e.target.value)} className="w-auto">{['All', 'Open', 'In Progress', 'Closed'].map(s => <option key={s}>{s}</option>)}</Select>
        {perms.create && !mine && <Btn variant="ghost" onClick={() => startCreate('Preventive')}>+ PM ticket</Btn>}
        {perms.create && !mine && <Btn variant="teal" onClick={() => startCreate('Corrective')}>+ Breakdown</Btn>}
      </div>
      {/* PM / Breakdown / All toggle */}
      <div className="inline-flex bg-slate-100 rounded-xl p-1 mb-4">
        {[['all', `All (${base.length})`], ['PM', `PM Tickets (${nPM})`], ['BD', `Breakdown (${nBD})`]].map(([k, l]) =>
          <button key={k} onClick={() => setKindF(k)} className={`px-4 py-1.5 rounded-lg text-sm font-bold ${kindF === k ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}>{l}</button>)}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]"><thead><tr className="bg-slate-50 text-slate-400 text-xs uppercase">{['Ticket', 'Type', 'Asset', 'Priority', 'Status', 'Start', 'Completion', 'Permit', 'Tasks'].map(h => <th key={h} className="text-left px-3 py-2.5 border-b border-slate-200 font-bold">{h}</th>)}</tr></thead>
        <tbody>{list.map(w => { const a = assets.find(x => x.id === w.asset_id) || { name: '?', code: '?' }; const od = w.due_date && w.due_date < t && w.status !== 'Closed'; return <tr key={w.id} onClick={() => setOpenWO(w)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"><td className="px-3 py-2.5"><div className="font-bold">#{w.id}</div><div className="text-xs text-slate-400 max-w-[180px] truncate">{w.title}</div></td><td className="px-3 py-2.5"><KindBadge wo={w} /></td><td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{a.name} <span className="text-slate-400">({a.code})</span></td><td className="px-3 py-2.5"><Badge variant={w.priority}>{w.priority}</Badge></td><td className="px-3 py-2.5"><Badge variant="status">{w.status}</Badge></td><td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{w.started_at ? fmtDateTime(w.started_at) : <span className="text-slate-300">—</span>}</td><td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{w.completed_at ? fmtDateTime(w.completed_at) : <span className="text-slate-300">—</span>}</td><td className="px-3 py-2.5 text-xs">{w.permit_no || <span className="text-slate-300">—</span>}</td><td className="px-3 py-2.5 text-slate-400">{doneCt(w)}/{w.wo_tasks?.length ?? 0}</td></tr> })}
        {list.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No tickets here. Create one above.</td></tr>}</tbody></table>
      </Card>
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)} />}
      {creating && <CreateWOModal prefill={{ type: createType }} onClose={() => setCreating(false)} />}
    </div>
  )
}

function AssetsPage({ kind = 'all' }) {
  const { profile, perms, assets, workOrders, rAssets } = useApp()
  const [closed, setClosed] = useState({})
  const [adding, setAdding] = useState(false)
  const [openWO, setOpenWO] = useState(null)
  const [f, setF] = useState({ name: '', code: '', kind: 'equipment', status: 'Online', parent_id: '' })
  const filtered = kind === 'all' ? assets : assets.filter(a => a.kind === kind)
  const tree = kind === 'all' ? buildTree(assets, closed) : filtered.map(a => ({ a, depth: 0, hasKids: false }))
  const open = workOrders.filter(w => w.status !== 'Closed')
  const treeAll = buildTree(assets)
  const title = { all: 'All Assets', location: 'Facilities', equipment: 'Equipment', tool: 'Tools' }[kind] || 'Assets'
  const setStatus = async (a, s) => { await upsertAsset({ ...a, status: s }); await rAssets() }
  const add = async () => { if (!f.name || !f.code) { alert('Name and code required.'); return } await upsertAsset({ id: 'a_' + Date.now(), plant_id: profile.plant_id, parent_id: f.parent_id || null, code: f.code, name: f.name, kind: f.kind, status: f.status }); await rAssets(); setAdding(false); setF({ name: '', code: '', kind: 'equipment', status: 'Online', parent_id: '' }) }
  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4"><h1 className="text-xl font-black">{title}</h1><span className="text-xs text-slate-400">{filtered.length} records</span><div className="flex-1" />{perms.manageAssets && <Btn variant="teal" onClick={() => setAdding(true)}>+ Add asset</Btn>}</div>
      <Card>
        <div className="flex px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-2xl text-xs font-bold uppercase text-slate-400"><span className="flex-1">Name</span><span className="w-32">Code</span><span className="w-24">Status</span><span className="w-24">Open</span></div>
        {tree.map(({ a, depth, hasKids }) => { const wos = open.filter(w => w.asset_id === a.id); return <div key={a.id} className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 text-sm hover:bg-slate-50"><span style={{ width: depth * 18 }} className="flex-shrink-0" />{hasKids ? <button onClick={() => setClosed(c => ({ ...c, [a.id]: !c[a.id] }))} className="w-5 text-center text-slate-400 font-bold hover:text-slate-700">{closed[a.id] ? '+' : '–'}</button> : <span className="w-5 text-center text-slate-300">·</span>}<span className="text-base">{KIND_IC[a.kind] || '🔩'}</span><span className="flex-1 truncate font-medium">{a.name}</span><span className="w-32 text-slate-400 text-xs truncate">{a.code}</span><span className="w-24">{perms.manageAssets ? <select value={a.status} onChange={e => setStatus(a, e.target.value)} className="text-xs border border-slate-300 rounded-lg px-1 py-0.5 bg-white"><option>Online</option><option>Offline</option></select> : <Pill on={a.status === 'Online'}>{a.status}</Pill>}</span><span className="w-24 flex gap-1 flex-wrap">{wos.length ? wos.map(w => <button key={w.id} onClick={() => setOpenWO(w)} className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5 hover:bg-indigo-100">#{w.id}</button>) : <span className="text-slate-300 text-xs">—</span>}</span></div> })}
        {tree.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No assets.</p>}
      </Card>
      <p className="text-xs text-slate-400 mt-3">🏭 facility · 🔗 line · 🔩 equipment · 🧰 tool. Click +/– to expand.</p>
      {adding && <Modal title="Add asset" onClose={() => setAdding(false)} maxWidth="max-w-md" footer={<><Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="teal" onClick={add}>Add asset</Btn></>}><div className="mb-3"><Lbl>Parent (hierarchy)</Lbl><Select value={f.parent_id} onChange={e => setF(o => ({ ...o, parent_id: e.target.value }))}><option value="">— Top level —</option>{treeAll.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name} ({n.a.code})</option>)}</Select></div><div className="mb-3"><Lbl>Name</Lbl><Input value={f.name} onChange={e => setF(o => ({ ...o, name: e.target.value }))} placeholder="e.g. Case Packer" /></div><div className="grid grid-cols-2 gap-3"><Field label="Code"><Input value={f.code} onChange={e => setF(o => ({ ...o, code: e.target.value }))} placeholder="A305" /></Field><Field label="Type"><Select value={f.kind} onChange={e => setF(o => ({ ...o, kind: e.target.value }))}><option value="equipment">Equipment</option><option value="tool">Tool</option><option value="line">Line</option><option value="location">Facility</option></Select></Field></div></Modal>}
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)} />}
    </div>
  )
}

/* Build the human name for a master checklist, in the plant's house style:
   "Mechanical <Freq> PM Checklist for <Area> <Machine>". Manufacturing and
   Packing stay visibly separate because the area is baked into the name. */
function masterTGName(cl) {
  const e = MASTER.equipment.find(x => x.checklist === cl.id)
  const where = e ? `${e.area} ${e.name}` : cl.name
  return `Mechanical ${cl.freq || 'Monthly'} PM Checklist for ${where}`
}
// Insert one task group per master checklist. Skips names already present so it
// is safe to run twice. Each row's tasks are flattened as "[sub-assembly] task".
async function loadMasterTaskGroups(profile, onProgress) {
  const { data: existing } = await supabase.from('task_groups').select('name').eq('plant_id', profile.plant_id)
  const have = new Set((existing || []).map(g => g.name))
  let added = 0, skipped = 0
  for (const cl of MASTER.checklists) {
    const name = masterTGName(cl)
    if (have.has(name)) { skipped++; continue }
    const e = MASTER.equipment.find(x => x.checklist === cl.id)
    const items = []
    cl.groups.forEach(g => g.tasks.forEach(t => items.push({ description: `[${g.name}] ${t}` })))
    await saveTG({ plant_id: profile.plant_id, name, asset_hint: e ? e.name : cl.name }, items)
    added++; onProgress(`Adding task groups… ${added}`)
  }
  return { added, skipped, total: MASTER.checklists.length }
}

function TaskGroupsPage() {
  const { profile, perms, taskGroups, rTGs } = useApp()
  const [editId, setEditId] = useState(null)
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const openEdit = g => { if (g === 'new') { setD({ id: undefined, name: '', asset_hint: '', task_group_items: [{ description: '', est_hrs: '' }] }); setEditId('new') } else { setD({ ...g, task_group_items: [...(g.task_group_items || []).map(t => ({ ...t }))] }); setEditId(g.id) } }
  const save = async () => { if (!d.name.trim()) { alert('Name it.'); return } const items = d.task_group_items.filter(t => t.description.trim()); if (!items.length) { alert('Add a task.'); return } await saveTG({ id: d.id, plant_id: profile.plant_id, name: d.name, asset_hint: d.asset_hint }, items); await rTGs(); setEditId(null); setD(null) }
  const del = async () => { if (confirm('Delete?')) { await delTG(d.id); await rTGs(); setEditId(null); setD(null) } }
  const loadMaster = async () => {
    if (!confirm(`Load the ${MASTER.checklists.length} master PM checklists from the plant check-sheets into Task Groups? Ones already present are skipped.`)) return
    setLoading(true); setNote('Loading master check-sheets…')
    try { const r = await loadMasterTaskGroups(profile, setNote); await rTGs(); setNote(`Done — ${r.added} task groups added${r.skipped ? `, ${r.skipped} already existed` : ''}.`) }
    catch (e) { setNote('Failed: ' + (e.message || e)) }
    setLoading(false)
  }
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-xl font-black">Task Groups</h1><div className="flex-1" />
        {perms.manageTG && <Btn variant="ghost" onClick={loadMaster} disabled={loading}>{loading ? 'Loading…' : '⤓ Load master checklists'}</Btn>}
        {perms.manageTG && <Btn variant="teal" onClick={() => openEdit('new')}>+ New task group</Btn>}
      </div>
      <p className="text-sm text-slate-400 mb-4">Reusable checklists used by Scheduled Maintenance and new tickets. “Load master checklists” pulls every PM check-sheet (Manufacturing &amp; Packing, kept separate) straight from the plant master data.</p>
      {note && <Note variant={note.startsWith('Failed') ? 'red' : note.startsWith('Done') ? 'grey' : 'amber'}>{note}</Note>}
      <Card>{taskGroups.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No task groups yet. Use “Load master checklists” to import them from the plant check-sheets.</p> : taskGroups.map(g => { const tot = (g.task_group_items || []).reduce((s, t) => s + (parseFloat(t.est_hrs) || 0), 0); return <button key={g.id} onClick={() => openEdit(g)} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 w-full text-left hover:bg-slate-50 text-sm"><div className="flex-1 min-w-0"><div className="font-bold truncate">{g.name}</div>{g.asset_hint && <div className="text-xs text-slate-400">For: {g.asset_hint}</div>}</div><span className="text-slate-400 text-xs w-16">{g.task_group_items?.length ?? 0} tasks</span><span className="text-slate-400 text-xs w-20">{tot ? tot.toFixed(2) + ' h' : '—'}</span><span className="text-teal-700 font-bold text-xs">Edit</span></button> })}</Card>
      {editId && d && <Modal title={editId === 'new' ? 'New task group' : 'Edit task group'} onClose={() => { setEditId(null); setD(null) }} maxWidth="max-w-xl" footer={<div className="flex justify-between w-full">{editId !== 'new' ? <Btn variant="red" onClick={del}>Delete</Btn> : <span />}<div className="flex gap-2"><Btn variant="line" onClick={() => { setEditId(null); setD(null) }}>Cancel</Btn><Btn variant="teal" onClick={save}>Save</Btn></div></div>}>
        <div className="mb-3"><Lbl>Name</Lbl><Input value={d.name} onChange={e => setD(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Electrical Monthly PM" /></div>
        <div className="mb-4"><Lbl>For asset / line (optional)</Lbl><Input value={d.asset_hint || ''} onChange={e => setD(x => ({ ...x, asset_hint: e.target.value }))} placeholder="e.g. Taping m/c" /></div>
        <div className="grid grid-cols-[1fr_80px_32px] gap-2 mb-2 text-xs font-bold uppercase text-slate-400"><span>Task</span><span>Est h</span><span /></div>
        {d.task_group_items.map((t, i) => <div key={i} className="grid grid-cols-[1fr_80px_32px] gap-2 mb-2"><input value={t.description} onChange={e => { const its = [...d.task_group_items]; its[i] = { ...its[i], description: e.target.value }; setD(x => ({ ...x, task_group_items: its })) }} className="border border-slate-300 rounded-xl px-3 py-1.5 text-sm" placeholder="Task description" /><input value={t.est_hrs || ''} onChange={e => { const its = [...d.task_group_items]; its[i] = { ...its[i], est_hrs: e.target.value }; setD(x => ({ ...x, task_group_items: its })) }} className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm" placeholder="0.1" /><button onClick={() => { const its = d.task_group_items.filter((_, j) => j !== i); setD(x => ({ ...x, task_group_items: its.length ? its : [{ description: '', est_hrs: '' }] })) }} className="text-slate-300 hover:text-red-500 font-bold">🗑</button></div>)}
        <button onClick={() => setD(x => ({ ...x, task_group_items: [...x.task_group_items, { description: '', est_hrs: '' }] }))} className="text-teal-700 font-bold text-sm">+ Add task</button>
      </Modal>}
    </div>
  )
}

function ScheduledPage() {
  const { profile, schedules, taskGroups, assets, users, rScheds, rWOs, setFlash } = useApp()
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', task_group_id: taskGroups[0]?.id || '', asset_id: assets[0]?.id || '', assigned_to: users[0]?.id || '', frequency: 'monthly', next_due: TODAY(), priority: 'High', lead_days: 3 })
  const tree = buildTree(assets)
  const genNow = async sc => { const g = taskGroups.find(x => x.id === sc.task_group_id); const tasks = (g?.task_group_items || []).map((t, i) => ({ description: t.description, position: i, est_hrs: t.est_hrs })); const id = await createWO({ plant_id: sc.plant_id, asset_id: sc.asset_id, assigned_to: sc.assigned_to, title: sc.name, priority: sc.priority, type: 'Preventive', start_date: sc.next_due, due_date: advanceDate(sc.next_due, 'daily'), created_by: profile.id, tasks, log: [{ author_name: 'System', body: `Auto-generated from schedule: ${sc.name}` }] }); let nd = sc.next_due, g2 = 0; while (nd <= TODAY() && g2++ < 400) nd = advanceDate(nd, sc.frequency); await updSched(sc.id, { next_due: nd }); await rScheds(); await rWOs(); setFlash(`PM ticket #${id} generated.`) }
  const add = async () => { if (!f.name.trim() || !f.task_group_id) { alert('Name and task group required.'); return } await saveSched({ ...f, plant_id: profile.plant_id, active: true }); await rScheds(); setAdding(false) }
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-xl font-black">Scheduled Maintenance</h1><div className="flex-1" /><Btn variant="teal" onClick={() => setAdding(true)}>+ New schedule</Btn></div>
      <p className="text-sm text-slate-400 mb-4">Recurring PM plans. “Generate now” creates the next PM ticket immediately.</p>
      <Card>{schedules.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No schedules yet. Create a task group first, then a schedule.</p> : schedules.map(sc => { const g = taskGroups.find(x => x.id === sc.task_group_id) || { name: '?', task_group_items: [] }; const a = assets.find(x => x.id === sc.asset_id) || { name: '?' }; const u = users.find(x => x.id === sc.assigned_to) || { name: '?' }; const od = sc.next_due <= TODAY(); return <div key={sc.id} className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100 text-sm"><span className="text-base">{sc.active ? '🔁' : '⏸'}</span><div className="flex-1 min-w-0"><div className="font-bold truncate">{sc.name}</div><div className="text-xs text-slate-400">{a.name} · {g.name} ({g.task_group_items?.length ?? 0} tasks) · {u.name}</div></div><Badge variant={sc.priority}>{sc.priority}</Badge><Badge variant="status">{sc.frequency}</Badge><span className={`text-xs font-bold ${od ? 'text-red-600' : 'text-slate-500'}`}>Next: {fmtDate(sc.next_due)}</span><Btn variant="ghost" className="text-xs py-1 px-2.5" onClick={() => genNow(sc)}>Generate now</Btn><Btn variant="line" className="text-xs py-1 px-2.5" onClick={async () => { await updSched(sc.id, { active: !sc.active }); await rScheds() }}>{sc.active ? 'Pause' : 'Resume'}</Btn><Btn variant="red" className="text-xs py-1 px-2.5" onClick={async () => { if (confirm('Delete?')) { await delSched(sc.id); await rScheds() } }}>Delete</Btn></div> })}</Card>
      {adding && <Modal title="New maintenance schedule" onClose={() => setAdding(false)} maxWidth="max-w-lg" footer={<><Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="teal" onClick={add}>Create schedule</Btn></>}><div className="mb-3"><Lbl>Schedule name (becomes PM ticket title)</Lbl><Input value={f.name} onChange={e => setF(o => ({ ...o, name: e.target.value }))} placeholder="e.g. Monthly PM — Taping m/c" /></div><div className="grid grid-cols-2 gap-3"><Field label="Task group"><Select value={f.task_group_id} onChange={e => setF(o => ({ ...o, task_group_id: e.target.value }))}><option value="">— Select —</option>{taskGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field><Field label="Asset"><Select value={f.asset_id} onChange={e => setF(o => ({ ...o, asset_id: e.target.value }))}>{tree.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name}</option>)}</Select></Field><Field label="Assign to"><Select value={f.assigned_to} onChange={e => setF(o => ({ ...o, assigned_to: e.target.value }))}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field><Field label="Frequency"><Select value={f.frequency} onChange={e => setF(o => ({ ...o, frequency: e.target.value }))}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></Field><Field label="Priority"><Select value={f.priority} onChange={e => setF(o => ({ ...o, priority: e.target.value }))}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field><Field label="First due date"><Input type="date" value={f.next_due} onChange={e => setF(o => ({ ...o, next_due: e.target.value }))} /></Field></div></Modal>}
    </div>
  )
}

function SubmitRequestPage() {
  const { profile, workReqs, assets, rWReqs } = useApp()
  const [f, setF] = useState({ title: '', asset_id: assets[0]?.id || '', priority: 'Medium', description: '' })
  const [saving, setSaving] = useState(false)
  const mine = workReqs.filter(r => r.raised_by === profile.id)
  const submit = async () => { if (!f.title.trim()) { alert('Describe the problem.'); return } setSaving(true); await saveWReq({ ...f, plant_id: profile.plant_id, raised_by: profile.id, status: 'Pending' }); await rWReqs(); setF({ title: '', asset_id: assets[0]?.id || '', priority: 'Medium', description: '' }); setSaving(false) }
  const rb = s => s === 'Pending' ? 'pending' : s === 'Rejected' ? 'rej' : 'ok'
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Submit Work Request</h1><p className="text-sm text-slate-400 mb-4">Report a problem. A manager reviews it and converts it into a work order.</p>
      <Card className="p-5 max-w-xl mb-6"><div className="mb-3"><Lbl>What's wrong?</Lbl><Input value={f.title} onChange={e => setF(o => ({ ...o, title: e.target.value }))} placeholder="e.g. Abnormal noise from Case Packer drive" /></div><div className="grid grid-cols-2 gap-3 mb-3"><Field label="Asset"><Select value={f.asset_id} onChange={e => setF(o => ({ ...o, asset_id: e.target.value }))}>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Urgency"><Select value={f.priority} onChange={e => setF(o => ({ ...o, priority: e.target.value }))}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field></div><div className="mb-4"><Lbl>Description</Lbl><Textarea rows={4} value={f.description} onChange={e => setF(o => ({ ...o, description: e.target.value }))} placeholder="When it happens, what it looks/sounds like…" /></div><div className="flex justify-end"><Btn variant="teal" onClick={submit} disabled={saving}>Submit request</Btn></div></Card>
      <h2 className="font-black mb-3">My requests</h2>
      <Card>{mine.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing submitted yet.</p> : mine.map(r => <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.title}</span><Badge variant={r.priority}>{r.priority}</Badge><Badge variant={rb(r.status)}>{r.status}</Badge>{r.wo_id && <span className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">→ WO #{r.wo_id}</span>}</div><div className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</div>{r.note && <div className="text-xs text-red-600 mt-1">Reason: {r.note}</div>}</div>)}</Card>
    </div>
  )
}

function WorkRequestsPage() {
  const { workReqs, assets, users, rWReqs, rWOs } = useApp()
  const [converting, setConverting] = useState(null)
  const rb = s => s === 'Pending' ? 'pending' : s === 'Rejected' ? 'rej' : 'ok'
  const reject = async r => { const why = prompt('Rejection reason:') || ''; await saveWReq({ ...r, status: 'Rejected', note: why }); await rWReqs() }
  const onConv = async woId => { await saveWReq({ ...converting, status: 'Converted', wo_id: woId }); await rWReqs(); await rWOs(); setConverting(null) }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Work Requests</h1><p className="text-sm text-slate-400 mb-4">Convert to a breakdown work order or reject.</p>
      <Card>{workReqs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No work requests.</p> : workReqs.map(r => { const a = assets.find(x => x.id === r.asset_id) || { name: '?' }; const u = users.find(x => x.id === r.raised_by); return <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.title}</span><Badge variant={r.priority}>{r.priority}</Badge><Badge variant={rb(r.status)}>{r.status}</Badge>{r.wo_id && <span className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">→ WO #{r.wo_id}</span>}</div><div className="text-xs text-slate-400 mb-1">{a.name} · by {u?.name || '—'} · {fmtDateTime(r.created_at)}</div>{r.description && <p className="text-sm mb-2">{r.description}</p>}{r.note && <div className="text-xs text-red-600 mb-1">Rejected: {r.note}</div>}{r.status === 'Pending' && <div className="flex gap-2 mt-2"><Btn variant="teal" className="text-xs py-1.5 px-3" onClick={() => setConverting(r)}>Convert to work order</Btn><Btn variant="red" className="text-xs py-1.5 px-3" onClick={() => reject(r)}>Reject</Btn></div>}</div> })}</Card>
      {converting && <CreateWOModal prefill={{ title: converting.title, asset_id: converting.asset_id, priority: converting.priority, desc: converting.description, fromReq: true, type: 'Corrective' }} onClose={() => setConverting(null)} onCreated={onConv} />}
    </div>
  )
}

function SubmitPurchasePage() {
  const { profile, rPReqs } = useApp()
  const [f, setF] = useState({ item: '', qty: '1', est_cost: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => { if (!f.item.trim()) { alert('Name the item.'); return } setSaving(true); await savePReq({ item: f.item, qty: parseInt(f.qty) || 1, est_cost: parseFloat(f.est_cost) || null, reason: f.reason, plant_id: profile.plant_id, raised_by: profile.id, status: 'Pending' }); await rPReqs(); setF({ item: '', qty: '1', est_cost: '', reason: '' }); setSaving(false) }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Submit Purchase Request</h1><p className="text-sm text-slate-400 mb-4">Request a spare or consumable for manager approval.</p>
      <Card className="p-5 max-w-xl"><div className="mb-3"><Lbl>Item</Lbl><Input value={f.item} onChange={e => setF(o => ({ ...o, item: e.target.value }))} placeholder="e.g. Gripping belt spare — Taping m/c" /></div><div className="grid grid-cols-2 gap-3 mb-3"><Field label="Quantity"><Input type="number" value={f.qty} onChange={e => setF(o => ({ ...o, qty: e.target.value }))} /></Field><Field label="Est. cost (₹)"><Input value={f.est_cost} onChange={e => setF(o => ({ ...o, est_cost: e.target.value }))} placeholder="4500" /></Field></div><div className="mb-4"><Lbl>Why is it needed?</Lbl><Textarea rows={3} value={f.reason} onChange={e => setF(o => ({ ...o, reason: e.target.value }))} placeholder="e.g. Consumed in last PM; nil stock." /></div><div className="flex justify-end"><Btn variant="teal" onClick={submit} disabled={saving}>Submit request</Btn></div></Card>
    </div>
  )
}

function MyPurchasePage() {
  const { profile, purchReqs } = useApp()
  const rb = s => s === 'Pending' ? 'pending' : s === 'Rejected' ? 'rej' : 'ok'
  const mine = purchReqs.filter(r => r.raised_by === profile.id)
  return (
    <div className="p-6"><h1 className="text-xl font-black mb-4">My Purchase Requests</h1><Card>{mine.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing submitted yet.</p> : mine.map(r => <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.item}</span><Badge variant={rb(r.status)}>{r.status}</Badge></div><div className="text-xs text-slate-400">Qty {r.qty}{r.est_cost ? ` · est ₹${r.est_cost}` : ''} · {fmtDateTime(r.created_at)}</div>{r.reason && <p className="text-sm mt-1">{r.reason}</p>}{r.note && <div className="text-xs text-red-600 mt-1">Reason: {r.note}</div>}</div>)}</Card></div>
  )
}

function PurchaseRequestsPage() {
  const { purchReqs, profile, users, rPReqs } = useApp()
  const rb = s => s === 'Pending' ? 'pending' : s === 'Rejected' ? 'rej' : 'ok'
  const decide = async (r, ok) => { const note = ok ? '' : (prompt('Rejection reason:') || ''); await savePReq({ ...r, status: ok ? 'Approved' : 'Rejected', decided_by: profile.id, note }); await rPReqs() }
  return (
    <div className="p-6"><h1 className="text-xl font-black mb-4">Purchase Requests</h1><Card>{purchReqs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No purchase requests.</p> : purchReqs.map(r => { const u = users.find(x => x.id === r.raised_by); return <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.item}</span><Badge variant={rb(r.status)}>{r.status}</Badge></div><div className="text-xs text-slate-400">Qty {r.qty}{r.est_cost ? ` · est ₹${r.est_cost}` : ''} · by {u?.name || '—'} · {fmtDateTime(r.created_at)}</div>{r.reason && <p className="text-sm mt-1">{r.reason}</p>}{r.note && <div className="text-xs text-red-600 mt-1">Rejected: {r.note}</div>}{r.status === 'Pending' && <div className="flex gap-2 mt-2"><Btn variant="teal" className="text-xs py-1.5 px-3" onClick={() => decide(r, true)}>Approve</Btn><Btn variant="red" className="text-xs py-1.5 px-3" onClick={() => decide(r, false)}>Reject</Btn></div>}</div> })}</Card></div>
  )
}

function ActiveInsightsPage() {
  const { workOrders, assets } = useApp()
  const t = TODAY(), open = workOrders.filter(w => w.status !== 'Closed')
  const byPri = { High: open.filter(w => w.priority === 'High').length, Medium: open.filter(w => w.priority === 'Medium').length, Low: open.filter(w => w.priority === 'Low').length }
  const mxP = Math.max(...Object.values(byPri), 1)
  const aging = { 'Not due': 0, '1–3 d': 0, '4–7 d': 0, '>7 d': 0 }
  open.forEach(w => { if (!w.due_date || w.due_date >= t) aging['Not due']++; else { const d = Math.round((Date.parse(t) - Date.parse(w.due_date)) / 864e5); if (d <= 3) aging['1–3 d']++; else if (d <= 7) aging['4–7 d']++; else aging['>7 d']++ } })
  const mxA = Math.max(...Object.values(aging), 1)
  const byA = {}; open.forEach(w => { const a = assets.find(x => x.id === w.asset_id); const k = a?.name || '?'; byA[k] = (byA[k] || 0) + 1 })
  const top = Object.entries(byA).sort((a, b) => b[1] - a[1]).slice(0, 6); const mxAs = Math.max(...top.map(x => x[1]), 1)
  return (
    <div className="p-6"><h1 className="text-xl font-black mb-4">Active Work Order Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><KPICard title="Open" value={open.length} color="text-teal-700" /><KPICard title="Overdue" value={open.filter(w => w.due_date && w.due_date < t).length} color="text-red-600" /><KPICard title="PM open" value={open.filter(isPM).length} color="text-teal-700" /><KPICard title="Breakdown open" value={open.filter(w => !isPM(w)).length} color="text-rose-700" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Card><CardHead>By priority</CardHead><div className="py-2"><HBar label="High" value={byPri.High} max={mxP} color="#DC2626" /><HBar label="Medium" value={byPri.Medium} max={mxP} color="#D97706" /><HBar label="Low" value={byPri.Low} max={mxP} color="#16A34A" /></div></Card><Card><CardHead>Aging</CardHead><div className="py-2">{Object.entries(aging).map(([k, v], i) => <HBar key={k} label={k} value={v} max={mxA} color={['#16A34A', '#D97706', '#EA580C', '#DC2626'][i]} />)}</div></Card><Card><CardHead>Top assets by open</CardHead><div className="py-2">{top.length ? top.map(([k, v]) => <HBar key={k} label={k} value={v} max={mxAs} color="#1D4ED8" />) : <p className="px-4 py-3 text-sm text-slate-400">Nothing open.</p>}</div></Card></div>
    </div>
  )
}

function ClosedInsightsPage() {
  const { workOrders } = useApp()
  const closed = workOrders.filter(w => w.status === 'Closed')
  const onTime = closed.filter(w => w.closed_on && w.closed_on <= w.due_date)
  const comp = closed.length ? onTime.length / closed.length : 0
  const durs = closed.map(durationHrs).filter(x => x != null)
  const avgDur = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null
  const res = { OK: 0, Adjusted: 0, Replaced: 0, 'Needs attention': 0 }
  closed.forEach(w => (w.wo_tasks || []).forEach(t => { if (t.result && res[t.result] !== undefined) res[t.result]++ }))
  const mxR = Math.max(...Object.values(res), 1)
  const byType = { 'PM Tickets': closed.filter(isPM).length, 'Breakdowns': closed.filter(w => !isPM(w)).length }
  const mxT = Math.max(...Object.values(byType), 1)
  return (
    <div className="p-6"><h1 className="text-xl font-black mb-4">Closed Work Order Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Card className="flex items-center gap-4 p-4 col-span-2"><div className="text-center"><GaugeSVG pct={comp} /><div className="text-xs text-slate-400">on time</div></div><div><div className="text-xs font-bold uppercase text-slate-400 mb-1">Compliance</div><div className="text-xs text-slate-400">{onTime.length} of {closed.length} on time</div></div></Card><KPICard title="Closed" value={closed.length} color="text-slate-500" /><KPICard title="Avg duration" value={avgDur != null ? avgDur.toFixed(1) + ' h' : '—'} color="text-blue-700" sub={durs.length ? `from ${durs.length} timed jobs` : 'no timed jobs yet'} /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Card><CardHead>Task results</CardHead><div className="py-2"><HBar label="OK" value={res.OK} max={mxR} color="#16A34A" /><HBar label="Adjusted" value={res.Adjusted} max={mxR} color="#D97706" /><HBar label="Replaced" value={res.Replaced} max={mxR} color="#1D4ED8" /><HBar label="Needs attention" value={res['Needs attention']} max={mxR} color="#DC2626" /></div></Card><Card><CardHead>By type</CardHead><div className="py-2"><HBar label="PM Tickets" value={byType['PM Tickets']} max={mxT} color="#0F766E" /><HBar label="Breakdowns" value={byType['Breakdowns']} max={mxT} color="#E11D48" /></div></Card></div>
    </div>
  )
}

function AssetInsightsPage() {
  const { assets, workOrders } = useApp()
  const eq = assets.filter(a => a.kind === 'equipment'), onl = eq.filter(a => a.status === 'Online')
  const byA = {}; workOrders.forEach(w => { const a = assets.find(x => x.id === w.asset_id); const k = a?.name || '?'; byA[k] = (byA[k] || 0) + 1 })
  const top = Object.entries(byA).sort((a, b) => b[1] - a[1]).slice(0, 8); const mx = Math.max(...top.map(x => x[1]), 1)
  return (
    <div className="p-6"><h1 className="text-xl font-black mb-4">Asset Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5"><KPICard title="Total" value={assets.length} /><KPICard title="Equipment" value={eq.length} color="text-teal-700" /><KPICard title="Online" value={onl.length} color="text-green-600" sub={eq.length ? Math.round(onl.length / eq.length * 100) + '%' : ''} /><KPICard title="Offline" value={eq.length - onl.length} color={eq.length - onl.length ? 'text-red-600' : 'text-slate-400'} /><KPICard title="With open WOs" value={[...new Set(workOrders.filter(w => w.status !== 'Closed').map(w => w.asset_id))].length} color="text-blue-700" /></div>
      <Card><CardHead>Most worked-on assets</CardHead><div className="py-2">{top.length ? top.map(([k, v]) => <HBar key={k} label={k} value={v} max={mx} color="#0F766E" />) : <p className="px-4 py-3 text-sm text-slate-400">No work orders yet.</p>}</div></Card>
    </div>
  )
}

function RolePermissionMatrix() {
  return (
    <Card className="p-4">
      <div className="font-black text-sm mb-3">Role permission matrix</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400 font-bold">
              <th className="text-left py-2 pr-4">Capability</th>
              {ROLE_ORDER.map(r => <th key={r} className="text-left py-2 px-4 whitespace-nowrap">{ROLES[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERM_ROWS.map(row => (
              <tr key={row.key} className="border-t border-slate-100">
                <td className="py-2.5 pr-4 text-slate-700">{row.label}</td>
                {ROLE_ORDER.map(r => (
                  <td key={r} className="py-2.5 px-4">
                    {ROLE_MATRIX[r][row.key] ? <span className="text-teal-600 font-black">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-4 leading-relaxed">Everyone can submit work and purchase requests, and fill checklists on their own work orders. Closing requires every task ticked with hours — no exceptions.</p>
    </Card>
  )
}

function UsersPage() {
  const { users, profile, rUsers } = useApp()
  const PLANTS = [{ id: 'p1', name: 'Uluberia' }, { id: 'p2', name: 'Manpura' }, { id: 'p3', name: 'Haridwar' }]
  const isAdmin = profile?.role === 'admin'
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ email: '', password: '', name: '', role: 'technician', crew: 'mech', plant_id: profile?.plant_id || 'p1' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState('')
  const setRole = async (u, role) => { await supabase.from('profiles').update({ role }).eq('id', u.id); await rUsers() }
  // "Group" = crew. Persisted to profiles.crew when that column exists; failures are surfaced, not swallowed.
  const setCrew = async (u, crew) => {
    const { error } = await supabase.from('profiles').update({ crew }).eq('id', u.id)
    if (error) setNote('Groups need a "crew" text column on profiles. Add it in Supabase to persist this. (' + error.message + ')')
    else { setNote(''); await rUsers() }
  }
  const resetPw = async u => {
    if (!u.email) { setNote('No email on file for this user.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(u.email)
    setNote(error ? 'Reset failed: ' + error.message : `Password reset email sent to ${u.email}.`)
  }
  const removeUser = async u => {
    if (u.id === profile?.id) { setNote("You can't remove yourself."); return }
    if (!confirm(`Remove ${u.name}? This deletes their profile.`)) return
    const { error } = await supabase.from('profiles').delete().eq('id', u.id)
    setNote(error ? 'Remove failed: ' + error.message : `${u.name} removed.`)
    await rUsers()
  }
  const create = async () => {
    if (!f.email || !f.password || !f.name) { setMsg('Email, password and name are required.'); return }
    if (f.password.length < 6) { setMsg('Password must be at least 6 characters.'); return }
    setBusy(true); setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('https://itzkbcwyxrvldvkgxcfa.supabase.co/functions/v1/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(f),
      })
      const out = await res.json()
      if (!res.ok) { setMsg(out.error || 'Failed.'); setBusy(false); return }
      await rUsers()
      setAdding(false)
      setF({ email: '', password: '', name: '', role: 'technician', crew: 'mech', plant_id: profile?.plant_id || 'p1' })
    } catch (e) { setMsg(String(e.message || e)) }
    setBusy(false)
  }
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-xl font-black">Users &amp; permissions</h1><div className="flex-1" />{isAdmin && <Btn variant="teal" onClick={() => { setAdding(true); setMsg('') }}>+ Add user</Btn>}</div>
      {note && <Note variant={note.includes('sent') || note.includes('removed') ? 'grey' : 'amber'}>{note}</Note>}
      <Card className="mb-5">{users.map(u => {
        const me = u.id === profile?.id
        const crew = u.crew || defaultCrew(u.role)
        return (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 flex-wrap first:border-t-0">
            <div className="w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: u.color || '#0F766E' }}>{u.initials || '?'}</div>
            <div className="flex-1 min-w-0"><div className="font-bold text-sm">{u.name}{me ? ' · you' : ''}</div><div className="text-xs text-slate-400">@{(u.email || '').split('@')[0] || '—'}</div></div>
            <Select value={crew} onChange={e => setCrew(u, e.target.value)} disabled={!isAdmin} className="w-auto min-w-[170px]">{CREWS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select value={u.role} onChange={e => setRole(u, e.target.value)} disabled={!isAdmin || me} className="w-auto min-w-[170px]">{ROLE_ORDER.map(k => <option key={k} value={k}>{ROLES[k]}</option>)}</Select>
            <Btn variant="line" className="text-xs py-1.5 px-3" onClick={() => resetPw(u)}>Reset password</Btn>
            {isAdmin && !me && <Btn variant="red" className="text-xs py-1.5 px-3" onClick={() => removeUser(u)}>Remove</Btn>}
          </div>
        )
      })}</Card>

      <RolePermissionMatrix />

      {adding && <Modal title="Add user" onClose={() => setAdding(false)} maxWidth="max-w-md" footer={<><Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="teal" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</Btn></>}>
        {msg && <Note variant="red">{msg}</Note>}
        <div className="mb-3"><Lbl>Full name</Lbl><Input value={f.name} onChange={e => setF(o => ({ ...o, name: e.target.value }))} placeholder="e.g. Ramesh Kumar" /></div>
        <div className="mb-3"><Lbl>Email (login ID)</Lbl><Input type="email" value={f.email} onChange={e => setF(o => ({ ...o, email: e.target.value }))} placeholder="ramesh@itc.in" /></div>
        <div className="mb-3"><Lbl>Password (min 6 chars)</Lbl><Input type="text" value={f.password} onChange={e => setF(o => ({ ...o, password: e.target.value }))} placeholder="starter password" /></div>
        <div className="grid grid-cols-2 gap-3 mb-3"><Field label="Plant"><Select value={f.plant_id} onChange={e => setF(o => ({ ...o, plant_id: e.target.value }))}>{PLANTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Field label="Group"><Select value={f.crew} onChange={e => setF(o => ({ ...o, crew: e.target.value }))}>{CREWS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></div>
        <Field label="Role"><Select value={f.role} onChange={e => setF(o => ({ ...o, role: e.target.value, crew: defaultCrew(e.target.value) }))}>{ROLE_ORDER.map(k => <option key={k} value={k}>{ROLES[k]}</option>)}</Select></Field>
      </Modal>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   PM SCHEDULE  — Section → Line → Asset → month calendar of PM tickets
   (renamed from "Calendar"; shows PM tickets only, drill-down by asset)
   ══════════════════════════════════════════════════════════════════════════ */
function PMSchedulePage() {
  const { assets, workOrders } = useApp()
  const [sel, setSel] = useState({ section: null, line: null, asset: null })
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [openWO, setOpenWO] = useState(null)

  // Derive the hierarchy from the asset tree: depth 0 = section, 1 = line, 2+ = machine/asset.
  // We treat "location" kind as section, "line" kind as line; anything with children is a group.
  const tree = buildTree(assets)
  const sections = tree.filter(n => n.depth === 0)
  const childrenOf = pid => assets.filter(a => (a.parent_id || null) === pid)

  // fallback: if there is no explicit hierarchy, offer a flat asset list at the asset step
  const pmFor = assetId => workOrders.filter(w => isPM(w) && w.asset_id === assetId)

  const crumb = (label, active, done, onClick) =>
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-sm font-bold border ${active ? 'bg-teal-700 text-white border-teal-700' : done ? 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100' : 'bg-white text-slate-600 border-slate-200'}`}>{label}</button>

  const PickCard = ({ icon, bg, title, subtitle, onClick }) =>
    <button onClick={onClick} className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-2xl bg-white text-left hover:border-teal-400 hover:bg-teal-50 transition-colors">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: bg }}>{icon}</div>
      <div className="min-w-0"><div className="font-bold text-sm truncate">{title}</div><div className="text-xs text-slate-400">{subtitle}</div></div>
      <span className="ml-auto text-teal-600 font-black">→</span>
    </button>

  // Breadcrumb bar
  const bar = (
    <div className="flex items-center gap-2 flex-wrap mb-5">
      {crumb('Sections', !sel.section, !!sel.section, () => setSel({ section: null, line: null, asset: null }))}
      {sel.section && <span className="text-slate-300 font-black">›</span>}
      {sel.section && crumb(assets.find(a => a.id === sel.section)?.name || 'Section', !sel.line, !!sel.line, () => setSel(s => ({ section: s.section, line: null, asset: null })))}
      {sel.line && <span className="text-slate-300 font-black">›</span>}
      {sel.line && crumb(assets.find(a => a.id === sel.line)?.name || 'Line', !sel.asset, !!sel.asset, () => setSel(s => ({ section: s.section, line: s.line, asset: null })))}
      {sel.asset && <span className="text-slate-300 font-black">›</span>}
      {sel.asset && crumb(assets.find(a => a.id === sel.asset)?.name || 'Asset', true, false, () => {})}
    </div>
  )

  // STEP 1 — sections
  if (!sel.section) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-black mb-1">PM Schedule</h1>
        <p className="text-sm text-slate-400 mb-5">Drill down to an asset to see its PM calendar.</p>
        {bar}
        {sections.length === 0
          ? <Note>No top-level sections found. Add assets with a hierarchy (facility → line → equipment) in the Assets page, or pick from all assets below.</Note>
          : <div className="grid gap-3 max-w-2xl">{sections.map(n => { const lines = childrenOf(n.a.id); return <PickCard key={n.a.id} icon={KIND_IC[n.a.kind] || '🏭'} bg="#CCFBF1" title={n.a.name} subtitle={`${lines.length} line${lines.length !== 1 ? 's' : ''}`} onClick={() => setSel({ section: n.a.id, line: null, asset: null })} />})}</div>}
        {/* Fallback: flat asset shortcut */}
        {sections.length === 0 && <div className="grid gap-3 max-w-2xl mt-3">{assets.map(a => <PickCard key={a.id} icon="🔩" bg="#F1F5F9" title={a.name} subtitle={`${a.code} · ${pmFor(a.id).length} PM tickets`} onClick={() => setSel({ section: 'flat', line: 'flat', asset: a.id })} />)}</div>}
      </div>
    )
  }

  // STEP 2 — lines under the section
  if (!sel.line) {
    const lines = childrenOf(sel.section)
    return (
      <div className="p-6">
        <h1 className="text-xl font-black mb-1">PM Schedule</h1>
        <p className="text-sm text-slate-400 mb-5">Select a line.</p>
        {bar}
        {lines.length === 0
          ? <Note>No lines under this section. <button className="underline font-bold" onClick={() => setSel(s => ({ section: s.section, line: 'direct', asset: null }))}>Show assets directly →</button></Note>
          : <div className="grid gap-3 max-w-2xl">{lines.map(l => { const machines = childrenOf(l.id); return <PickCard key={l.id} icon={KIND_IC[l.kind] || '🔗'} bg="#DBEAFE" title={l.name} subtitle={`${machines.length} asset${machines.length !== 1 ? 's' : ''}`} onClick={() => setSel(s => ({ section: s.section, line: l.id, asset: null }))} />})}</div>}
      </div>
    )
  }

  // STEP 3 — assets under the line
  if (!sel.asset) {
    const machines = sel.line === 'direct' ? childrenOf(sel.section) : childrenOf(sel.line)
    return (
      <div className="p-6">
        <h1 className="text-xl font-black mb-1">PM Schedule</h1>
        <p className="text-sm text-slate-400 mb-5">Select an asset.</p>
        {bar}
        {machines.length === 0
          ? <Note>No assets here.</Note>
          : <div className="grid gap-3 max-w-2xl">{machines.map(a => { const n = pmFor(a.id).length; return <PickCard key={a.id} icon={KIND_IC[a.kind] || '🔩'} bg="#F1F5F9" title={a.name} subtitle={`${a.code} · ${n} PM ticket${n !== 1 ? 's' : ''}`} onClick={() => setSel(s => ({ section: s.section, line: s.line, asset: a.id }))} />})}</div>}
      </div>
    )
  }

  // STEP 4 — calendar for the chosen asset (PM tickets only)
  const { y, m } = ym
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const days = new Date(y, m + 1, 0).getDate()
  const lead = new Date(y, m, 1).getDay()
  const isoOf = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const t = TODAY()
  const nav = delta => { let nm = m + delta, ny = y; if (nm < 0) { nm = 11; ny-- } if (nm > 11) { nm = 0; ny++ } setYm({ y: ny, m: nm }) }
  const mine = pmFor(sel.asset).filter(w => w.start_date)
  const byDay = {}; mine.forEach(w => { (byDay[w.start_date] = byDay[w.start_date] || []).push(w) })
  const assetName = assets.find(a => a.id === sel.asset)?.name || 'asset'

  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-1">PM Schedule</h1>
      <p className="text-sm text-slate-400 mb-5">PM tickets for <b>{assetName}</b> — click a ticket to open it.</p>
      {bar}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <Btn variant="ghost" onClick={() => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }) }}>Today</Btn>
          <Btn variant="line" onClick={() => nav(-1)}>‹</Btn>
          <Btn variant="line" onClick={() => nav(1)}>›</Btn>
          <b className="text-base ml-1">{MN[m]} {y}</b>
          <div className="flex-1" />
          <span className="text-xs text-slate-400">{mine.length} PM ticket{mine.length !== 1 ? 's' : ''} on this asset</span>
        </div>
        <div className="grid grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-400 bg-slate-50 border-b border-slate-200">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={'e' + i} className="min-h-24 bg-slate-50 border-b border-r border-slate-100" />)}
          {Array.from({ length: days }).map((_, i) => {
            const d = i + 1, di = isoOf(d), list = byDay[di] || []
            return (
              <div key={d} className="min-h-24 border-b border-r border-slate-100 p-1">
                <div className={`w-6 h-6 flex items-center justify-center text-xs font-bold rounded-full mb-1 ${di === t ? 'bg-teal-600 text-white' : 'text-slate-400'}`}>{d}</div>
                {list.map(w => {
                  const cls = w.status === 'Closed' ? 'bg-slate-100 border-slate-400 text-slate-500' : { High: 'bg-red-50 border-red-500 text-red-700', Medium: 'bg-amber-50 border-amber-500 text-amber-700', Low: 'bg-green-50 border-green-500 text-green-700' }[w.priority]
                  return <button key={w.id} onClick={() => setOpenWO(w)} title={w.title} className={`block w-full text-left border-l-4 rounded text-xs px-1 py-0.5 mb-0.5 hover:opacity-80 truncate ${cls}`}><b>#{w.id}</b> {w.status === 'Closed' ? '✓ ' : ''}{w.title}</button>
                })}
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 px-4 py-3 text-xs text-slate-400 flex-wrap">{[['High', 'bg-red-500'], ['Medium', 'bg-amber-500'], ['Low', 'bg-green-500'], ['Closed', 'bg-slate-400']].map(([l, c]) => <span key={l}><span className={`inline-block w-3 h-3 rounded ${c} mr-1.5 align-middle`} />{l}</span>)}<span className="ml-auto">✓ = completed</span></div>
      </Card>
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)} />}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   HISTORY & INSIGHTS
   ══════════════════════════════════════════════════════════════════════════ */
function HistoryPage() {
  const { workOrders, assets } = useApp()
  const [assetF, setAssetF] = useState('all')
  const [rangeF, setRangeF] = useState('all')
  const [kindF, setKindF] = useState('all') // all | PM | BD
  const t = TODAY()

  const cutoff = (() => {
    if (rangeF === 'all') return null
    const d = new Date(); d.setDate(d.getDate() - parseInt(rangeF))
    return d.toISOString().slice(0, 10)
  })()
  const inRange = w => {
    if (!cutoff) return true
    const ref = w.start_date || (w.created_at ? w.created_at.slice(0, 10) : null)
    return ref ? ref >= cutoff : true
  }
  const matchAsset = w => assetF === 'all' || w.asset_id === assetF
  const matchKind = w => kindF === 'all' || (kindF === 'PM' ? isPM(w) : !isPM(w))

  const scoped = workOrders.filter(w => inRange(w) && matchAsset(w) && matchKind(w))
  const closed = scoped.filter(w => w.status === 'Closed')
  const pending = scoped.filter(w => w.status !== 'Closed')
  const overdue = pending.filter(w => w.due_date && w.due_date < t)
  const completion = scoped.length ? Math.round(closed.length / scoped.length * 100) : 0

  const durs = closed.map(durationHrs).filter(x => x != null)
  const avgDur = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null

  const rows = assets.map(a => {
    const list = workOrders.filter(w => w.asset_id === a.id && inRange(w) && matchKind(w))
    const cl = list.filter(w => w.status === 'Closed').length
    const pe = list.filter(w => w.status !== 'Closed').length
    const od = list.filter(w => w.status !== 'Closed' && w.due_date && w.due_date < t).length
    return { a, total: list.length, closed: cl, pending: pe, overdue: od }
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)
  const maxTotal = Math.max(...rows.map(r => r.total), 1)

  const rangeLabel = { all: 'All time', '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last 12 months' }[rangeF]

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="text-xl font-black">History &amp; Insights</h1>
        <div className="flex-1" />
        <Select value={assetF} onChange={e => setAssetF(e.target.value)} className="w-auto">
          <option value="all">All assets</option>
          {buildTree(assets).map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name}</option>)}
        </Select>
        <Select value={rangeF} onChange={e => setRangeF(e.target.value)} className="w-auto">
          <option value="all">All time</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </Select>
      </div>
      <div className="inline-flex bg-slate-100 rounded-xl p-1 mb-3 mt-2">
        {[['all', 'All'], ['PM', 'PM Tickets'], ['BD', 'Breakdown']].map(([k, l]) =>
          <button key={k} onClick={() => setKindF(k)} className={`px-4 py-1.5 rounded-lg text-sm font-bold ${kindF === k ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}>{l}</button>)}
      </div>
      <p className="text-sm text-slate-400 mb-5">{rangeLabel}{assetF !== 'all' ? ` · ${assets.find(a => a.id === assetF)?.name || ''}` : ' · all machines'}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPICard title="Total tickets" value={scoped.length} />
        <KPICard title="Closed" value={closed.length} color="text-teal-700" sub={`${completion}% completion`} />
        <KPICard title="Pending / open" value={pending.length} color="text-blue-700" />
        <KPICard title="Overdue" value={overdue.length} color={overdue.length ? 'text-red-600' : 'text-slate-400'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard title="Avg actual duration" value={avgDur != null ? avgDur.toFixed(1) + ' h' : '—'} sub={durs.length ? `${durs.length} timed jobs` : 'no timed jobs yet'} />
        <KPICard title="PM closed" value={closed.filter(isPM).length} color="text-teal-700" />
        <KPICard title="Breakdown closed" value={closed.filter(w => !isPM(w)).length} color="text-rose-700" />
        <KPICard title="Timed jobs" value={durs.length} color="text-blue-700" />
      </div>

      <Card className="overflow-x-auto">
        <CardHead>Per-asset breakdown</CardHead>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wide">
              {['Asset', 'Total', 'Closed', 'Pending', 'Overdue', 'Activity'].map(h =>
                <th key={h} className="text-left px-3 py-2.5 border-b border-slate-200 font-bold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.a.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setAssetF(r.a.id)}>
                <td className="px-3 py-2.5"><div className="font-bold">{r.a.name}</div><div className="text-xs text-slate-400">{r.a.code}</div></td>
                <td className="px-3 py-2.5 font-semibold">{r.total}</td>
                <td className="px-3 py-2.5 text-teal-700 font-bold">{r.closed}</td>
                <td className="px-3 py-2.5 text-blue-700 font-bold">{r.pending}</td>
                <td className={`px-3 py-2.5 font-bold ${r.overdue ? 'text-red-600' : 'text-slate-300'}`}>{r.overdue || '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden w-32">
                    <div className="h-full flex">
                      <div className="h-full bg-teal-500" style={{ width: `${r.total ? r.closed / maxTotal * 100 : 0}%` }} />
                      <div className="h-full bg-blue-400" style={{ width: `${r.total ? r.pending / maxTotal * 100 : 0}%` }} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No tickets in this period.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="flex gap-4 mt-3 text-xs text-slate-400">
        <span><span className="inline-block w-3 h-3 rounded bg-teal-500 mr-1.5 align-middle" />Closed</span>
        <span><span className="inline-block w-3 h-3 rounded bg-blue-400 mr-1.5 align-middle" />Pending</span>
        <span className="ml-auto">Tip: click a row to filter everything above to that asset.</span>
      </div>
    </div>
  )
}
/* ══════════════════════════════════════════════════════════════════════════
   SHELL
   ══════════════════════════════════════════════════════════════════════════ */
function Sidebar() {
  const { profile, perms, workReqs, purchReqs } = useApp()
  const pendW = workReqs.filter(r => r.status === 'Pending').length
  const pendP = purchReqs.filter(r => r.status === 'Pending').length
  const Item = ({ to, icon, label, badge, sub }) => <NavLink to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm mb-0.5 ${sub ? 'ml-4' : ''} ${isActive ? 'bg-teal-800 text-white font-bold' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}><span className="w-4 text-center">{icon}</span><span className="flex-1">{label}</span>{badge ? <span className="bg-amber-500 text-white text-xs font-black rounded-full px-1.5 py-0.5">{badge}</span> : null}</NavLink>
  const Head = ({ children }) => <div className="text-xs uppercase tracking-widest text-slate-600 font-bold px-3 pt-3 pb-1">{children}</div>
  return (
    <aside className="w-60 bg-slate-900 flex flex-col h-screen flex-shrink-0">
      <div className="px-4 py-3.5 border-b border-slate-800 flex items-center gap-2.5"><div className="w-8 h-8 bg-teal-500 rounded-xl flex items-center justify-center text-white font-black">P</div><div><div className="text-white font-black text-sm leading-tight">PlantCare</div><div className="text-slate-500 text-xs">🏭 Uluberia Plant</div></div></div>
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <Head>Dashboard</Head>
        <Item to="/" icon="▦" label="Dashboard" />
        <Item to="/work-orders" icon="☰" label="Work Orders" />
        <Item to="/pm-schedule" icon="🗓️" label="PM Schedule" />
        <Item to="/assigned-wos" icon="✅" label="Assigned to me" />
        <Head>Maintenance</Head>
        <Item to="/scheduled" icon="🔁" label="Scheduled Maintenance" />
        <Item to="/task-groups" icon="☑" label="Task Groups" />
        <Item to="/submit-request" icon="✍" label="Submit Work Request" />
        <Item to="/work-requests" icon="📥" label="Work Requests" badge={pendW || null} />
        <Head>Purchasing</Head>
        <Item to="/submit-purchase" icon="🛒" label="Submit Purchase" />
        <Item to="/my-purchase" icon="🧾" label="My Purchases" />
        <Item to="/purchase-requests" icon="📥" label="Purchase Requests" badge={pendP || null} />
        <Head>Assets</Head>
        <Item to="/assets" icon="🌳" label="All Assets" />
        <Item to="/facilities" icon="🏭" label="Facilities" sub />
        <Item to="/equipment" icon="🔩" label="Equipment" sub />
        <Item to="/tools" icon="🧰" label="Tools" sub />
        <Head>Insights</Head>
        <Item to="/active-insights" icon="📊" label="Active WOs" />
        <Item to="/closed-insights" icon="📈" label="Closed WOs" />
        <Item to="/asset-insights" icon="🔍" label="Assets" />
        <Item to="/history" icon="📜" label="History" />
        <Head>Settings</Head>
        <Item to="/users" icon="👥" label="Users" />
      </nav>
    <div className="px-4 py-3 border-t border-slate-800">
        <div className="text-white text-xs font-bold">{profile.name}</div>
        <div className="text-slate-500 text-xs mb-2">{profile.role}</div>
        <button onClick={() => supabase.auth.signOut()} className="w-full border border-slate-700 rounded-xl py-1.5 text-slate-400 text-xs hover:bg-slate-800">Log off</button>
      </div>
    </aside>
  )
}

function Layout() {
  const { loading, err, flash, setFlash } = useApp()
  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 min-w-0 h-screen overflow-y-auto">
        {flash && <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl flex justify-between items-center"><span>⚡ {flash}</span><button onClick={() => setFlash('')} className="font-bold">✕</button></div>}
        {err && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">⚠ {err}</div>}
        {loading ? <Spinner /> : (
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/pm-schedule" element={<PMSchedulePage />} />
            <Route path="/assigned-wos" element={<WorkOrdersPage mine />} />
            <Route path="/scheduled" element={<ScheduledPage />} />
            <Route path="/task-groups" element={<TaskGroupsPage />} />
            <Route path="/submit-request" element={<SubmitRequestPage />} />
            <Route path="/work-requests" element={<WorkRequestsPage />} />
            <Route path="/submit-purchase" element={<SubmitPurchasePage />} />
            <Route path="/my-purchase" element={<MyPurchasePage />} />
            <Route path="/purchase-requests" element={<PurchaseRequestsPage />} />
            <Route path="/assets" element={<AssetsPage kind="all" />} />
            <Route path="/facilities" element={<AssetsPage kind="location" />} />
            <Route path="/equipment" element={<AssetsPage kind="equipment" />} />
            <Route path="/tools" element={<AssetsPage kind="tool" />} />
            <Route path="/active-insights" element={<ActiveInsightsPage />} />
            <Route path="/closed-insights" element={<ClosedInsightsPage />} />
            <Route path="/asset-insights" element={<AssetInsightsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AuthGate>
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      </AuthGate>
    </AppProvider>
  )
}
