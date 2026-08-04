import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import {
  Badge, Btn, Card, CardHead, Lbl, KPICard, RingSVG, GaugeSVG, HBar,
  ProgressBar, Note, Modal, Field, Input, Select, Textarea, Pill
} from '../components/ui'
import {
  todayISO, fmtDate, fmtDateTime, doneCt, spentHrs, closeBlockers,
  assetPath, buildAssetTree, advanceDate, KIND_IC, PRIORITY_COLOR
} from '../lib/utils'
import {
  supabase, createWorkOrder, updateWorkOrder, updateTask, addLogEntry, addPart,
  upsertAsset, saveTaskGroup, deleteTaskGroup, saveSchedule, updateSchedule,
  deleteSchedule, saveWorkRequest, savePurchaseRequest
} from '../lib/supabase'

const TODAY = () => new Date().toISOString().slice(0, 10)
const reqBadge = s => s === 'Pending' ? 'pending' : s === 'Rejected' ? 'rej' : 'ok'

/* ============================ WORK ORDER MODAL ============================ */
function WOModal({ wo, onClose }) {
  const { profile, perms, users, assets, projects, refreshWOs } = useApp()
  const [tab, setTab] = useState('checklist')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [closeErr, setCloseErr] = useState('')

  if (!wo) return null
  const a = assets.find(x => x.id === wo.asset_id) || { name: '?', status: 'Online' }
  const closed = wo.status === 'Closed'
  const canExec = perms.edit || wo.assigned_to === profile?.id
  const dn = doneCt(wo), sp = spentHrs(wo)
  const blk = closeBlockers(wo)

  const taskToggle = async (t, v) => { await updateTask(t.id, { done: v }); await refreshWOs(); setCloseErr('') }
  const taskHrs    = async (t, v) => { await updateTask(t.id, { hrs_spent: v === '' ? null : parseFloat(v) }); await refreshWOs() }
  const taskResult = async (t, v) => { await updateTask(t.id, { result: v || null }); await refreshWOs() }
  const setField   = async (f, v) => { await updateWorkOrder(wo.id, { [f]: v === '' ? null : v }); await refreshWOs() }
  const start      = async () => { setSaving(true); await updateWorkOrder(wo.id, { status: 'In Progress' }); await refreshWOs(); setSaving(false) }
  const closeWO    = async () => {
    if (closeBlockers(wo).blocked) { setCloseErr('Cannot close: ' + blk.msgs.join(', ') + '. Tick every task and enter hours.'); return }
    setSaving(true)
    await updateWorkOrder(wo.id, { status: 'Closed', closed_on: TODAY() })
    await addLogEntry(wo.id, profile.id, profile.name, `Closed — all ${wo.wo_tasks.length} tasks done, ${sp.toFixed(1)} h spent vs ${wo.est_hrs} h est.`)
    await refreshWOs(); setSaving(false); onClose()
  }
  const addNote = async () => { if (!note.trim()) return; setSaving(true); await addLogEntry(wo.id, profile.id, profile.name, note.trim()); await refreshWOs(); setNote(''); setSaving(false) }
  const addPartRow = async () => { const n = prompt('Part name'); if (!n) return; await addPart(wo.id, n, 1); await refreshWOs() }

  const tabs = [['checklist', `Checklist (${dn}/${wo.wo_tasks?.length ?? 0})`], ['general', 'General'], ['parts', `Parts (${wo.wo_parts?.length ?? 0})`], ['log', `Log (${wo.wo_log?.length ?? 0})`]]
  const lockTask = !canExec || closed, lockEdit = !perms.edit || closed

  let body
  if (tab === 'checklist') body = <>
    {closed && <Note>Closed {fmtDate(wo.closed_on)} — {sp.toFixed(1)} h spent vs {wo.est_hrs} h est.</Note>}
    {!closed && canExec && <Note>Close only when every task is ticked <strong>and</strong> hours are entered.</Note>}
    <div className="grid grid-cols-[1fr_64px_84px_130px] gap-2 px-2 pb-2 text-xs font-bold uppercase tracking-wide text-slate-400"><span>Task</span><span>Est</span><span>Spent</span><span>Result</span></div>
    {(wo.wo_tasks || []).map(t => {
      const miss = t.done && (t.hrs_spent == null || isNaN(parseFloat(t.hrs_spent)))
      return (
        <div key={t.id} className={`grid grid-cols-[1fr_64px_84px_130px] gap-2 border rounded-xl p-2.5 mb-2 items-center ${t.done && !miss ? 'bg-teal-50 border-teal-200' : miss ? 'bg-red-50 border-red-200' : 'border-slate-200'}`}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={t.done} disabled={lockTask} onChange={e => taskToggle(t, e.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-600"/>
            <span className={`text-sm ${t.done ? 'line-through text-slate-400' : ''}`}>{t.description}</span>
          </label>
          <div className="text-center text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg py-1">{t.est_hrs ?? '—'}</div>
          <input type="text" placeholder="0.0" defaultValue={t.hrs_spent ?? ''} disabled={lockTask} onBlur={e => taskHrs(t, e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-full disabled:bg-slate-50"/>
          <select defaultValue={t.result || ''} disabled={lockTask} onChange={e => taskResult(t, e.target.value)} className="border border-slate-300 rounded-lg px-1 py-1 text-sm w-full disabled:bg-slate-50">
            <option value="">Result…</option>{['OK', 'Adjusted', 'Replaced', 'Needs attention'].map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
      )
    })}
    <ProgressBar done={dn} total={wo.wo_tasks?.length ?? 0}/>
    <div className="text-xs text-slate-400 mt-1.5">{dn}/{wo.wo_tasks?.length ?? 0} tasks · {sp.toFixed(1)} h spent of {wo.est_hrs} h est</div>
  </>
  else if (tab === 'general') body = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Priority"><Select defaultValue={wo.priority} disabled={lockEdit} onChange={e => setField('priority', e.target.value)}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Type"><Select defaultValue={wo.type} disabled={lockEdit} onChange={e => setField('type', e.target.value)}>{['Preventive', 'Corrective'].map(x => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Assigned to"><Select defaultValue={wo.assigned_to ?? ''} disabled={lockEdit} onChange={e => setField('assigned_to', e.target.value)}><option value="">— None —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="Project"><Select defaultValue={wo.project_id ?? ''} disabled={lockEdit} onChange={e => setField('project_id', e.target.value)}><option value="">— None —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Estimated hours"><Input type="text" defaultValue={wo.est_hrs} disabled={lockEdit} onBlur={e => setField('est_hrs', parseFloat(e.target.value) || 0)}/></Field>
      <Field label="Hours spent"><Input value={sp.toFixed(1) + ' h'} disabled/></Field>
      <Field label="Start date"><Input type="date" defaultValue={wo.start_date} disabled={lockEdit} onBlur={e => setField('start_date', e.target.value)}/></Field>
      <Field label="Due date"><Input type="date" defaultValue={wo.due_date} disabled={lockEdit} onBlur={e => setField('due_date', e.target.value)}/></Field>
      <Field label="Asset" full><Input value={assetPath(wo.asset_id, assets)} disabled/></Field>
    </div>
  )
  else if (tab === 'parts') body = <>
    {(wo.wo_parts || []).length === 0 && <p className="text-sm text-slate-400">No parts reserved.</p>}
    {(wo.wo_parts || []).map(p => <div key={p.id} className="flex justify-between border border-slate-200 rounded-xl px-3 py-2.5 mb-2 text-sm"><span>{p.name}</span><span className="text-slate-400">Qty {p.qty}</span></div>)}
    {perms.edit && !closed && <Btn variant="ghost" className="mt-1 text-sm" onClick={addPartRow}>+ Add part</Btn>}
  </>
  else body = <>
    {(wo.wo_log || []).length === 0 && <p className="text-sm text-slate-400 mb-3">No entries yet.</p>}
    {(wo.wo_log || []).map(l => <div key={l.id} className="border border-slate-200 rounded-xl px-3 py-2.5 mb-2"><div className="text-xs text-slate-400 mb-1"><strong className="text-slate-700">{l.author_name}</strong> · {fmtDateTime(l.created_at)}</div><p className="text-sm">{l.body}</p></div>)}
    {canExec && !closed && <div className="flex gap-2 mt-2"><input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()} placeholder="Add a note…" className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"/><Btn variant="dark" onClick={addNote} disabled={saving}>Add</Btn></div>}
  </>

  return (
    <Modal eyebrow={`Work order · ${a.name}`} title={`#${wo.id} · ${wo.title}`} onClose={onClose}
      footer={<>
        {!closed && canExec && wo.status === 'Open' && <Btn variant="line" onClick={start} disabled={saving}>Start work</Btn>}
        {!closed && canExec && <Btn variant="teal" onClick={closeWO} disabled={saving} className={blk.blocked ? 'opacity-60' : ''}>{blk.blocked ? 'Close 🔒' : 'Close work order'}</Btn>}
        {closed && <span className="text-sm text-slate-400">Closed {fmtDate(wo.closed_on)}</span>}
      </>}>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <Badge variant={wo.priority}>{wo.priority}</Badge><Badge variant="status">{wo.status}</Badge><Badge variant="type">{wo.type}</Badge>
        <span className="text-xs text-slate-400">{fmtDate(wo.start_date)} → {fmtDate(wo.due_date)}</span>
        <span className="text-xs font-bold text-blue-700">Est {wo.est_hrs} h · Spent {sp.toFixed(1)} h</span>
      </div>
      <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 ${tab === k ? 'text-teal-700 border-teal-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>{l}</button>)}
      </div>
      {closeErr && <Note variant="red">{closeErr}</Note>}
      {body}
    </Modal>
  )
}

/* ============================ CREATE WORK ORDER ============================ */
function CreateWOModal({ onClose, prefill = null, onCreated = null }) {
  const { profile, users, assets, taskGroups, refreshWOs } = useApp()
  const [form, setForm] = useState({
    title: prefill?.title || '', asset_id: prefill?.asset_id || (assets[0]?.id ?? ''),
    assigned_to: users[0]?.id ?? '', priority: prefill?.priority || 'Medium',
    type: prefill?.fromReq ? 'Corrective' : 'Preventive', start_date: TODAY(), due_date: TODAY(),
    est_hrs: '1', tg_id: '', tasks: ''
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const tree = buildAssetTree(assets)

  const applyTG = id => {
    const g = taskGroups.find(x => x.id === id)
    set('tg_id', id)
    if (!g) return
    set('tasks', (g.task_group_items || []).map(t => t.description).join('\n'))
    const tot = (g.task_group_items || []).reduce((s, t) => s + (parseFloat(t.est_hrs) || 0), 0)
    if (tot > 0) set('est_hrs', String(Math.round(tot * 100) / 100))
    if (!form.title) set('title', g.name)
  }

  const save = async () => {
    if (!form.title.trim()) { alert('Enter a title.'); return }
    setSaving(true)
    const g = taskGroups.find(x => x.id === form.tg_id)
    const lines = form.tasks.split('\n').map(s => s.trim()).filter(Boolean)
    const tasks = lines.map((desc, i) => {
      const it = g?.task_group_items?.find(t => t.description === desc)
      return { description: desc, position: i, est_hrs: it?.est_hrs ?? null }
    })
    const woId = await createWorkOrder({
      plant_id: profile.plant_id, title: form.title.trim(), asset_id: form.asset_id || null,
      assigned_to: form.assigned_to || null, priority: form.priority, type: form.type,
      start_date: form.start_date, due_date: form.due_date, est_hrs: parseFloat(form.est_hrs) || 0,
      created_by: profile.id, tasks,
      log: [{ author_name: profile.name, body: `Created${g ? ' from task group: ' + g.name : ''}${prefill?.fromReq ? ' from work request' : ''}.` }]
    })
    if (onCreated) await onCreated(woId)
    await refreshWOs(); setSaving(false); onClose()
  }

  return (
    <Modal title="New work order" onClose={onClose} maxWidth="max-w-2xl"
      footer={<><Btn variant="line" onClick={onClose}>Cancel</Btn><Btn variant="teal" onClick={save} disabled={saving}>Create work order</Btn></>}>
      {prefill?.desc && <Note>Request: {prefill.desc}</Note>}
      <div className="mb-3"><Lbl>Task group (optional — fills the checklist)</Lbl><Select value={form.tg_id} onChange={e => applyTG(e.target.value)}><option value="">— None, type manually —</option>{taskGroups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.task_group_items?.length ?? 0} tasks)</option>)}</Select></div>
      <div className="mb-3"><Lbl>Title</Lbl><Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Monthly PM — Case Packer"/></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Asset"><Select value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>{tree.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name} ({n.a.code})</option>)}</Select></Field>
        <Field label="Assign to"><Select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}><option value="">— None —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Priority"><Select value={form.priority} onChange={e => set('priority', e.target.value)}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Type"><Select value={form.type} onChange={e => set('type', e.target.value)}><option>Preventive</option><option>Corrective</option></Select></Field>
        <Field label="Start date"><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}/></Field>
        <Field label="Due date"><Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}/></Field>
        <Field label="Estimated hours"><Input value={form.est_hrs} onChange={e => set('est_hrs', e.target.value)}/></Field>
      </div>
      <div><Lbl>Checklist tasks — one per line</Lbl><Textarea rows={5} value={form.tasks} onChange={e => set('tasks', e.target.value)} placeholder={"Check belt tension\nLubricate bearings\nInspect seals"}/></div>
    </Modal>
  )
}

/* ================================ DASHBOARD ================================ */
export function DashboardPage() {
  const { workOrders, users, assets } = useApp()
  const [openWO, setOpenWO] = useState(null)
  const t = TODAY()
  const open = workOrders.filter(w => w.status !== 'Closed')
  const closed = workOrders.filter(w => w.status === 'Closed')
  const overdue = open.filter(w => w.due_date && w.due_date < t)
  const onTime = closed.filter(w => w.closed_on && w.closed_on <= w.due_date)
  const comp = closed.length ? onTime.length / closed.length : 0
  const backlog = open.reduce((s, w) => s + (w.est_hrs || 0), 0)
  const techs = users.filter(u => u.role === 'technician')
  const week = [...open].sort((a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1).slice(0, 8)

  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-5">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="flex items-center gap-4 p-4 col-span-2"><div className="text-center"><GaugeSVG pct={comp}/><div className="text-xs text-slate-400">closed on time</div></div><div><div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Schedule Compliance</div><div className="text-xs text-slate-400">{onTime.length} of {closed.length} closed WOs met their due date</div></div></Card>
        <Card className="flex items-center gap-4 p-4 col-span-2"><RingSVG n={overdue.length} total={workOrders.length} color="#B91C1C"/><div><div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Overdue</div><div className="text-xs text-slate-400">{overdue.length} of {workOrders.length} total WOs</div></div></Card>
        <KPICard title="Open work orders" value={open.length} color="text-teal-700"/>
        <KPICard title="Closed" value={closed.length} color="text-slate-500"/>
        <KPICard title="Backlog (est)" value={backlog.toFixed(1) + ' h'}/>
        <KPICard title="Assets" value={assets.length} color="text-blue-700"/>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHead>Open work orders</CardHead>
          {week.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing open.</p> : week.map(w => {
            const a = assets.find(x => x.id === w.asset_id) || { name: '?', code: '?' }
            const od = w.due_date && w.due_date < t
            return <button key={w.id} onClick={() => setOpenWO(w)} className="flex items-center gap-3 px-4 py-3 w-full text-left border-t border-slate-100 hover:bg-slate-50">
              <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[w.priority] }}/>
              <div className="flex-1 min-w-0"><div className="font-bold text-sm truncate">#{w.id} · {w.title}</div><div className="text-xs text-slate-400">{a.name} · due <span className={od ? 'text-red-600 font-bold' : ''}>{fmtDate(w.due_date)}</span></div></div>
              <span className="text-xs text-slate-400">{doneCt(w)}/{w.wo_tasks?.length ?? 0}</span><Badge variant={w.priority}>{w.priority}</Badge>
            </button>
          })}
        </Card>
        <Card>
          <CardHead>Workload by technician</CardHead>
          {techs.length === 0 ? <p className="px-4 py-4 text-sm text-slate-400">No technicians yet.</p> : techs.map(u => {
            const o = open.filter(w => w.assigned_to === u.id), od = o.filter(w => w.due_date && w.due_date < t)
            return <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 text-sm"><div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: u.color || '#0F766E' }}>{u.initials || '?'}</div><span className="flex-1 truncate">{u.name}</span><span className="text-teal-700 font-bold">{o.length} open</span>{od.length ? <span className="text-red-600 font-bold">{od.length} overdue</span> : <span className="text-slate-400">on track</span>}</div>
          })}
        </Card>
      </div>
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)}/>}
    </div>
  )
}

/* =============================== WORK ORDERS =============================== */
export function WorkOrdersPage({ mine = false }) {
  const { profile, perms, workOrders, assets, users } = useApp()
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('All')
  const [openWO, setOpenWO] = useState(null)
  const [creating, setCreating] = useState(false)
  const t = TODAY()
  const base = mine ? workOrders.filter(w => w.assigned_to === profile?.id) : workOrders
  const list = base.filter(w => statusF === 'All' || w.status === statusF).filter(w => {
    const a = assets.find(x => x.id === w.asset_id) || { name: '', code: '' }
    return (w.title + w.id + a.name + a.code).toLowerCase().includes(search.toLowerCase())
  }).sort((a, b) => (a.due_date || '') < (b.due_date || '') ? -1 : 1)

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-black">{mine ? 'Assigned to me' : 'Work Orders'}</h1><div className="flex-1"/>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="border border-slate-300 rounded-xl px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-600"/>
        <select value={statusF} onChange={e => setStatusF(e.target.value)} className="border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">{['All', 'Open', 'In Progress', 'Closed'].map(s => <option key={s}>{s}</option>)}</select>
        {perms.create && !mine && <Btn variant="teal" onClick={() => setCreating(true)}>+ New work order</Btn>}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead><tr className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wide">{['WO', 'Asset', 'Priority', 'Status', 'Assigned', 'Due', 'Est', 'Spent', 'Tasks'].map(h => <th key={h} className="text-left px-3 py-2.5 border-b border-slate-200 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {list.map(w => {
              const a = assets.find(x => x.id === w.asset_id) || { name: '?', code: '?' }
              const u = users.find(x => x.id === w.assigned_to)
              const od = w.due_date && w.due_date < t && w.status !== 'Closed'
              const sp = spentHrs(w)
              return <tr key={w.id} onClick={() => setOpenWO(w)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2.5"><div className="font-bold">#{w.id}</div><div className="text-xs text-slate-400 max-w-[180px] truncate">{w.title}</div></td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{a.name} <span className="text-slate-400">({a.code})</span></td>
                <td className="px-3 py-2.5"><Badge variant={w.priority}>{w.priority}</Badge></td>
                <td className="px-3 py-2.5"><Badge variant="status">{w.status}</Badge></td>
                <td className="px-3 py-2.5 max-w-[120px] truncate">{u?.name ?? '—'}</td>
                <td className={`px-3 py-2.5 whitespace-nowrap ${od ? 'text-red-600 font-bold' : ''}`}>{fmtDate(w.due_date)}{od ? ' ⚠' : ''}</td>
                <td className="px-3 py-2.5 text-slate-400">{w.est_hrs} h</td>
                <td className={`px-3 py-2.5 font-semibold ${sp > w.est_hrs ? 'text-red-600' : 'text-blue-700'}`}>{sp ? sp.toFixed(1) + ' h' : '—'}</td>
                <td className="px-3 py-2.5 text-slate-400">{doneCt(w)}/{w.wo_tasks?.length ?? 0}</td>
              </tr>
            })}
            {list.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No work orders. Create one to get started.</td></tr>}
          </tbody>
        </table>
      </Card>
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)}/>}
      {creating && <CreateWOModal onClose={() => setCreating(false)}/>}
    </div>
  )
}

/* ================================= ASSETS ================================= */
export function AssetsPage({ kind = 'all' }) {
  const { profile, perms, assets, workOrders, refreshAssets } = useApp()
  const [closed, setClosed] = useState({})
  const [adding, setAdding] = useState(false)
  const [openWO, setOpenWO] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', kind: 'equipment', status: 'Online', parent_id: '' })
  const filtered = kind === 'all' ? assets : assets.filter(a => a.kind === kind)
  const tree = kind === 'all' ? buildAssetTree(assets, closed) : filtered.map(a => ({ a, depth: 0, hasKids: false }))
  const open = workOrders.filter(w => w.status !== 'Closed')
  const treeAll = buildAssetTree(assets)
  const title = { all: 'All Assets', location: 'Facilities', equipment: 'Equipment', tool: 'Tools' }[kind] || 'Assets'

  const setStatus = async (a, s) => { await upsertAsset({ ...a, status: s }); await refreshAssets() }
  const add = async () => {
    if (!form.name || !form.code) { alert('Name and code required.'); return }
    const id = 'a_' + Date.now()
    await upsertAsset({ id, plant_id: profile.plant_id, parent_id: form.parent_id || null, code: form.code, name: form.name, kind: form.kind, status: form.status })
    await refreshAssets(); setAdding(false); setForm({ name: '', code: '', kind: 'equipment', status: 'Online', parent_id: '' })
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4"><h1 className="text-xl font-black">{title}</h1><span className="text-xs text-slate-400">{filtered.length} records</span><div className="flex-1"/>{perms.manageAssets && <Btn variant="teal" onClick={() => setAdding(true)}>+ Add asset</Btn>}</div>
      <Card>
        <div className="flex px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-2xl text-xs font-bold uppercase tracking-wide text-slate-400"><span className="flex-1">Name</span><span className="w-32">Code</span><span className="w-24">Status</span><span className="w-24">Open WOs</span></div>
        {tree.map(({ a, depth, hasKids }) => {
          const wos = open.filter(w => w.asset_id === a.id)
          return <div key={a.id} className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 text-sm hover:bg-slate-50">
            <span style={{ width: depth * 18 }} className="flex-shrink-0"/>
            {hasKids ? <button onClick={() => setClosed(c => ({ ...c, [a.id]: !c[a.id] }))} className="w-5 text-center text-slate-400 font-bold hover:text-slate-700">{closed[a.id] ? '+' : '–'}</button> : <span className="w-5 text-center text-slate-300">·</span>}
            <span className="text-base">{KIND_IC[a.kind] || '🔩'}</span>
            <span className="flex-1 truncate font-medium">{a.name}</span>
            <span className="w-32 text-slate-400 text-xs truncate">{a.code}</span>
            <span className="w-24">{perms.manageAssets ? <select value={a.status} onChange={e => setStatus(a, e.target.value)} className="text-xs border border-slate-300 rounded-lg px-1 py-0.5 bg-white"><option>Online</option><option>Offline</option></select> : <Pill on={a.status === 'Online'}>{a.status}</Pill>}</span>
            <span className="w-24 flex gap-1 flex-wrap">{wos.length ? wos.map(w => <button key={w.id} onClick={() => setOpenWO(w)} className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5 hover:bg-indigo-100">#{w.id}</button>) : <span className="text-slate-300 text-xs">—</span>}</span>
          </div>
        })}
        {tree.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No assets.</p>}
      </Card>
      <p className="text-xs text-slate-400 mt-3">🏭 facility · 🔗 line · 🔩 equipment · 🧰 tool. Click +/– to expand.</p>
      {adding && <Modal title="Add asset" onClose={() => setAdding(false)} maxWidth="max-w-md" footer={<><Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="teal" onClick={add}>Add asset</Btn></>}>
        <div className="mb-3"><Lbl>Parent (hierarchy)</Lbl><Select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}><option value="">— Top level —</option>{treeAll.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name} ({n.a.code})</option>)}</Select></div>
        <div className="mb-3"><Lbl>Name</Lbl><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Case Packer"/></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Code"><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="A305"/></Field><Field label="Type"><Select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}><option value="equipment">Equipment</option><option value="tool">Tool</option><option value="line">Line</option><option value="location">Facility</option></Select></Field></div>
      </Modal>}
      {openWO && <WOModal wo={workOrders.find(w => w.id === openWO.id) || openWO} onClose={() => setOpenWO(null)}/>}
    </div>
  )
}

/* =============================== TASK GROUPS =============================== */
export function TaskGroupsPage() {
  const { profile, perms, taskGroups, refreshTGs } = useApp()
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(null)
  const openEdit = g => {
    if (g === 'new') { setDraft({ id: null, name: '', asset_hint: '', task_group_items: [{ description: '', est_hrs: '' }] }); setEditId('new') }
    else { setDraft({ ...g, task_group_items: [...(g.task_group_items || []).map(t => ({ ...t }))] }); setEditId(g.id) }
  }
  const save = async () => {
    if (!draft.name.trim()) { alert('Name the task group.'); return }
    const items = draft.task_group_items.filter(t => t.description.trim())
    if (!items.length) { alert('Add at least one task.'); return }
    await saveTaskGroup({ id: draft.id, plant_id: profile.plant_id, name: draft.name, asset_hint: draft.asset_hint }, items)
    await refreshTGs(); setEditId(null); setDraft(null)
  }
  const del = async () => { if (confirm('Delete this task group?')) { await deleteTaskGroup(draft.id); await refreshTGs(); setEditId(null); setDraft(null) } }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-xl font-black">Task Groups</h1><div className="flex-1"/>{perms.manageTG && <Btn variant="teal" onClick={() => openEdit('new')}>+ New task group</Btn>}</div>
      <p className="text-sm text-slate-400 mb-4">Reusable checklists used by Scheduled Maintenance and the new-work-order form.</p>
      <Card>
        {taskGroups.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No task groups yet.</p> : taskGroups.map(g => {
          const tot = (g.task_group_items || []).reduce((s, t) => s + (parseFloat(t.est_hrs) || 0), 0)
          return <button key={g.id} onClick={() => perms.manageTG && openEdit(g)} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 w-full text-left hover:bg-slate-50 text-sm"><div className="flex-1 min-w-0"><div className="font-bold truncate">{g.name}</div>{g.asset_hint && <div className="text-xs text-slate-400">For: {g.asset_hint}</div>}</div><span className="text-slate-400 text-xs w-16">{g.task_group_items?.length ?? 0} tasks</span><span className="text-slate-400 text-xs w-20">{tot ? tot.toFixed(2) + ' h' : '—'}</span><span className="text-teal-700 font-bold text-xs">Edit</span></button>
        })}
      </Card>
      {editId && draft && <Modal title={editId === 'new' ? 'New task group' : 'Edit task group'} onClose={() => { setEditId(null); setDraft(null) }} maxWidth="max-w-xl"
        footer={<div className="flex justify-between w-full">{editId !== 'new' ? <Btn variant="red" onClick={del}>Delete</Btn> : <span/>}<div className="flex gap-2"><Btn variant="line" onClick={() => { setEditId(null); setDraft(null) }}>Cancel</Btn><Btn variant="teal" onClick={save}>Save</Btn></div></div>}>
        <div className="mb-3"><Lbl>Name</Lbl><Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Electrical Monthly PM"/></div>
        <div className="mb-4"><Lbl>For asset / line (optional)</Lbl><Input value={draft.asset_hint || ''} onChange={e => setDraft(d => ({ ...d, asset_hint: e.target.value }))} placeholder="e.g. Taping m/c"/></div>
        <div className="grid grid-cols-[1fr_80px_32px] gap-2 mb-2 text-xs font-bold uppercase text-slate-400"><span>Task</span><span>Est h</span><span/></div>
        {draft.task_group_items.map((t, i) => <div key={i} className="grid grid-cols-[1fr_80px_32px] gap-2 mb-2">
          <input value={t.description} onChange={e => { const its = [...draft.task_group_items]; its[i] = { ...its[i], description: e.target.value }; setDraft(d => ({ ...d, task_group_items: its })) }} className="border border-slate-300 rounded-xl px-3 py-1.5 text-sm" placeholder="Task description"/>
          <input value={t.est_hrs || ''} onChange={e => { const its = [...draft.task_group_items]; its[i] = { ...its[i], est_hrs: e.target.value }; setDraft(d => ({ ...d, task_group_items: its })) }} className="border border-slate-300 rounded-xl px-2 py-1.5 text-sm" placeholder="0.1"/>
          <button onClick={() => { const its = draft.task_group_items.filter((_, j) => j !== i); setDraft(d => ({ ...d, task_group_items: its.length ? its : [{ description: '', est_hrs: '' }] })) }} className="text-slate-300 hover:text-red-500 font-bold">🗑</button>
        </div>)}
        <button onClick={() => setDraft(d => ({ ...d, task_group_items: [...d.task_group_items, { description: '', est_hrs: '' }] }))} className="text-teal-700 font-bold text-sm">+ Add task</button>
      </Modal>}
    </div>
  )
}

/* ============================ SCHEDULED MAINT. ============================ */
export function ScheduledPage() {
  const { profile, schedules, taskGroups, assets, users, refreshScheds, refreshWOs, setFlash } = useApp()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', task_group_id: taskGroups[0]?.id || '', asset_id: assets[0]?.id || '', assigned_to: users[0]?.id || '', frequency: 'monthly', next_due: TODAY(), priority: 'High', lead_days: 3 })
  const tree = buildAssetTree(assets)

  const genNow = async sc => {
    const g = taskGroups.find(x => x.id === sc.task_group_id)
    const tasks = (g?.task_group_items || []).map((t, i) => ({ description: t.description, position: i, est_hrs: t.est_hrs }))
    const est = tasks.reduce((s, t) => s + (parseFloat(t.est_hrs) || 0), 0)
    const woId = await createWorkOrder({ plant_id: sc.plant_id, asset_id: sc.asset_id, assigned_to: sc.assigned_to, title: sc.name, priority: sc.priority, type: 'Preventive', start_date: sc.next_due, due_date: advanceDate(sc.next_due, 'daily'), est_hrs: Math.round(est * 100) / 100 || 1, created_by: profile.id, tasks, log: [{ author_name: 'System', body: `Auto-generated from schedule: ${sc.name}` }] })
    let nd = sc.next_due, guard = 0
    while (nd <= TODAY() && guard++ < 400) nd = advanceDate(nd, sc.frequency)
    await updateSchedule(sc.id, { next_due: nd }); await refreshScheds(); await refreshWOs()
    setFlash(`Work order #${woId} generated from "${sc.name}".`)
  }
  const add = async () => {
    if (!form.name.trim() || !form.task_group_id) { alert('Name and task group required.'); return }
    await saveSchedule({ ...form, plant_id: profile.plant_id, active: true }); await refreshScheds(); setAdding(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4"><h1 className="text-xl font-black">Scheduled Maintenance</h1><div className="flex-1"/><Btn variant="teal" onClick={() => setAdding(true)}>+ New schedule</Btn></div>
      <p className="text-sm text-slate-400 mb-4">Recurring PM plans. "Generate now" creates the next WO immediately.</p>
      <Card>
        {schedules.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No schedules yet. Create a task group first, then a schedule.</p> : schedules.map(sc => {
          const g = taskGroups.find(x => x.id === sc.task_group_id) || { name: '?', task_group_items: [] }
          const a = assets.find(x => x.id === sc.asset_id) || { name: '?' }
          const u = users.find(x => x.id === sc.assigned_to) || { name: '?' }
          const od = sc.next_due <= TODAY()
          return <div key={sc.id} className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-base">{sc.active ? '🔁' : '⏸'}</span>
            <div className="flex-1 min-w-0"><div className="font-bold truncate">{sc.name}</div><div className="text-xs text-slate-400">{a.name} · {g.name} ({g.task_group_items?.length ?? 0} tasks) · {u.name}</div></div>
            <Badge variant={sc.priority}>{sc.priority}</Badge><Badge variant="status">{sc.frequency}</Badge>
            <span className={`text-xs font-bold ${od ? 'text-red-600' : 'text-slate-500'}`}>Next: {fmtDate(sc.next_due)}</span>
            <Btn variant="ghost" className="text-xs py-1 px-2.5" onClick={() => genNow(sc)}>Generate now</Btn>
            <Btn variant="line" className="text-xs py-1 px-2.5" onClick={async () => { await updateSchedule(sc.id, { active: !sc.active }); await refreshScheds() }}>{sc.active ? 'Pause' : 'Resume'}</Btn>
            <Btn variant="red" className="text-xs py-1 px-2.5" onClick={async () => { if (confirm('Delete?')) { await deleteSchedule(sc.id); await refreshScheds() } }}>Delete</Btn>
          </div>
        })}
      </Card>
      {adding && <Modal title="New maintenance schedule" onClose={() => setAdding(false)} maxWidth="max-w-lg" footer={<><Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn><Btn variant="teal" onClick={add}>Create schedule</Btn></>}>
        <div className="mb-3"><Lbl>Schedule name (becomes WO title)</Lbl><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Monthly PM — Taping m/c"/></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Task group"><Select value={form.task_group_id} onChange={e => setForm(f => ({ ...f, task_group_id: e.target.value }))}><option value="">— Select —</option>{taskGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          <Field label="Asset"><Select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))}>{tree.map(n => <option key={n.a.id} value={n.a.id}>{'\u00A0'.repeat(n.depth * 2)}{n.a.name}</option>)}</Select></Field>
          <Field label="Assign to"><Select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Frequency"><Select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></Field>
          <Field label="Priority"><Select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="First due date"><Input type="date" value={form.next_due} onChange={e => setForm(f => ({ ...f, next_due: e.target.value }))}/></Field>
        </div>
      </Modal>}
    </div>
  )
}

/* ============================ SUBMIT WORK REQUEST ========================= */
export function SubmitRequestPage() {
  const { profile, workReqs, assets, refreshWReqs } = useApp()
  const [form, setForm] = useState({ title: '', asset_id: assets[0]?.id || '', priority: 'Medium', description: '' })
  const [saving, setSaving] = useState(false)
  const mine = workReqs.filter(r => r.raised_by === profile.id)
  const submit = async () => {
    if (!form.title.trim()) { alert('Describe the problem.'); return }
    setSaving(true)
    await saveWorkRequest({ ...form, plant_id: profile.plant_id, raised_by: profile.id, status: 'Pending' })
    await refreshWReqs(); setForm({ title: '', asset_id: assets[0]?.id || '', priority: 'Medium', description: '' }); setSaving(false)
  }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Submit Work Request</h1>
      <p className="text-sm text-slate-400 mb-4">Report a problem. A manager reviews it and converts it into a work order.</p>
      <Card className="p-5 max-w-xl mb-6">
        <div className="mb-3"><Lbl>What's wrong?</Lbl><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Abnormal noise from Case Packer drive"/></div>
        <div className="grid grid-cols-2 gap-3 mb-3"><Field label="Asset"><Select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))}>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Urgency"><Select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</Select></Field></div>
        <div className="mb-4"><Lbl>Description</Lbl><Textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="When it happens, what it looks/sounds like…"/></div>
        <div className="flex justify-end"><Btn variant="teal" onClick={submit} disabled={saving}>Submit request</Btn></div>
      </Card>
      <h2 className="font-black mb-3">My requests</h2>
      <Card>
        {mine.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing submitted yet.</p> : mine.map(r => <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.title}</span><Badge variant={r.priority}>{r.priority}</Badge><Badge variant={reqBadge(r.status)}>{r.status}</Badge>{r.wo_id && <span className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">→ WO #{r.wo_id}</span>}</div><div className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</div>{r.note && <div className="text-xs text-red-600 mt-1">Reason: {r.note}</div>}</div>)}
      </Card>
    </div>
  )
}

/* ============================ WORK REQUESTS (mgr) ========================= */
export function WorkRequestsPage() {
  const { workReqs, assets, users, refreshWReqs, refreshWOs } = useApp()
  const [converting, setConverting] = useState(null)
  const reject = async r => { const why = prompt('Rejection reason:') || ''; await saveWorkRequest({ ...r, status: 'Rejected', note: why }); await refreshWReqs() }
  const onConverted = async woId => { const r = converting; await saveWorkRequest({ ...r, status: 'Converted', wo_id: woId }); await refreshWReqs(); await refreshWOs(); setConverting(null) }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Work Requests</h1><p className="text-sm text-slate-400 mb-4">Convert to a work order or reject.</p>
      <Card>
        {workReqs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No work requests.</p> : workReqs.map(r => {
          const a = assets.find(x => x.id === r.asset_id) || { name: '?' }
          const u = users.find(x => x.id === r.raised_by)
          return <div key={r.id} className="px-4 py-3 border-t border-slate-100">
            <div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.title}</span><Badge variant={r.priority}>{r.priority}</Badge><Badge variant={reqBadge(r.status)}>{r.status}</Badge>{r.wo_id && <span className="text-xs font-bold bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">→ WO #{r.wo_id}</span>}</div>
            <div className="text-xs text-slate-400 mb-1">{a.name} · by {u?.name || '—'} · {fmtDateTime(r.created_at)}</div>
            {r.description && <p className="text-sm mb-2">{r.description}</p>}{r.note && <div className="text-xs text-red-600 mb-1">Rejected: {r.note}</div>}
            {r.status === 'Pending' && <div className="flex gap-2 mt-2"><Btn variant="teal" className="text-xs py-1.5 px-3" onClick={() => setConverting(r)}>Convert to WO</Btn><Btn variant="red" className="text-xs py-1.5 px-3" onClick={() => reject(r)}>Reject</Btn></div>}
          </div>
        })}
      </Card>
      {converting && <CreateWOModal prefill={{ title: converting.title, asset_id: converting.asset_id, priority: converting.priority, desc: converting.description, fromReq: true }} onClose={() => setConverting(null)} onCreated={onConverted}/>}
    </div>
  )
}

/* ========================== SUBMIT PURCHASE REQ ========================== */
export function SubmitPurchasePage() {
  const { profile, refreshPReqs } = useApp()
  const [form, setForm] = useState({ item: '', qty: '1', est_cost: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!form.item.trim()) { alert('Name the item.'); return }
    setSaving(true)
    await savePurchaseRequest({ item: form.item, qty: parseInt(form.qty) || 1, est_cost: parseFloat(form.est_cost) || null, reason: form.reason, plant_id: profile.plant_id, raised_by: profile.id, status: 'Pending' })
    await refreshPReqs(); setForm({ item: '', qty: '1', est_cost: '', reason: '' }); setSaving(false)
  }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-2">Submit Purchase Request</h1><p className="text-sm text-slate-400 mb-4">Request a spare or consumable for manager approval.</p>
      <Card className="p-5 max-w-xl">
        <div className="mb-3"><Lbl>Item</Lbl><Input value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))} placeholder="e.g. Gripping belt spare — Taping m/c"/></div>
        <div className="grid grid-cols-2 gap-3 mb-3"><Field label="Quantity"><Input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}/></Field><Field label="Est. cost (₹)"><Input value={form.est_cost} onChange={e => setForm(f => ({ ...f, est_cost: e.target.value }))} placeholder="4500"/></Field></div>
        <div className="mb-4"><Lbl>Why is it needed?</Lbl><Textarea rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Current spare consumed in last PM; nil stock."/></div>
        <div className="flex justify-end"><Btn variant="teal" onClick={submit} disabled={saving}>Submit request</Btn></div>
      </Card>
    </div>
  )
}

/* ============================ MY PURCHASE REQS =========================== */
export function MyPurchasePage() {
  const { profile, purchReqs } = useApp()
  const mine = purchReqs.filter(r => r.raised_by === profile.id)
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">My Purchase Requests</h1>
      <Card>{mine.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing submitted yet.</p> : mine.map(r => <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.item}</span><Badge variant={reqBadge(r.status)}>{r.status}</Badge></div><div className="text-xs text-slate-400">Qty {r.qty}{r.est_cost ? ` · est ₹${r.est_cost}` : ''} · {fmtDateTime(r.created_at)}</div>{r.reason && <p className="text-sm mt-1">{r.reason}</p>}{r.note && <div className="text-xs text-red-600 mt-1">Reason: {r.note}</div>}</div>)}</Card>
    </div>
  )
}

/* ========================= PURCHASE REQUESTS (mgr) ======================= */
export function PurchaseRequestsPage() {
  const { purchReqs, profile, users, refreshPReqs } = useApp()
  const decide = async (r, ok) => { const note = ok ? '' : (prompt('Rejection reason:') || ''); await savePurchaseRequest({ ...r, status: ok ? 'Approved' : 'Rejected', decided_by: profile.id, note }); await refreshPReqs() }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">Purchase Requests</h1>
      <Card>{purchReqs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No purchase requests.</p> : purchReqs.map(r => {
        const u = users.find(x => x.id === r.raised_by)
        return <div key={r.id} className="px-4 py-3 border-t border-slate-100"><div className="flex flex-wrap gap-2 items-center mb-1"><span className="font-bold text-sm">{r.item}</span><Badge variant={reqBadge(r.status)}>{r.status}</Badge></div><div className="text-xs text-slate-400">Qty {r.qty}{r.est_cost ? ` · est ₹${r.est_cost}` : ''} · by {u?.name || '—'} · {fmtDateTime(r.created_at)}</div>{r.reason && <p className="text-sm mt-1">{r.reason}</p>}{r.note && <div className="text-xs text-red-600 mt-1">Rejected: {r.note}</div>}{r.status === 'Pending' && <div className="flex gap-2 mt-2"><Btn variant="teal" className="text-xs py-1.5 px-3" onClick={() => decide(r, true)}>Approve</Btn><Btn variant="red" className="text-xs py-1.5 px-3" onClick={() => decide(r, false)}>Reject</Btn></div>}</div>
      })}</Card>
    </div>
  )
}

/* =============================== INSIGHTS ================================= */
export function ActiveInsightsPage() {
  const { workOrders, users, assets } = useApp()
  const t = TODAY(), open = workOrders.filter(w => w.status !== 'Closed')
  const byPri = { High: open.filter(w => w.priority === 'High').length, Medium: open.filter(w => w.priority === 'Medium').length, Low: open.filter(w => w.priority === 'Low').length }
  const mxP = Math.max(...Object.values(byPri), 1)
  const aging = { 'Not due': 0, '1–3 d': 0, '4–7 d': 0, '>7 d': 0 }
  open.forEach(w => { if (!w.due_date || w.due_date >= t) aging['Not due']++; else { const d = Math.round((Date.parse(t) - Date.parse(w.due_date)) / 86400000); if (d <= 3) aging['1–3 d']++; else if (d <= 7) aging['4–7 d']++; else aging['>7 d']++ } })
  const mxA = Math.max(...Object.values(aging), 1)
  const byAsset = {}; open.forEach(w => { const a = assets.find(x => x.id === w.asset_id); const k = a?.name || '?'; byAsset[k] = (byAsset[k] || 0) + 1 })
  const top = Object.entries(byAsset).sort((a, b) => b[1] - a[1]).slice(0, 6); const mxAs = Math.max(...top.map(x => x[1]), 1)
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">Active Work Order Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><KPICard title="Open" value={open.length} color="text-teal-700"/><KPICard title="Overdue" value={open.filter(w => w.due_date && w.due_date < t).length} color="text-red-600"/><KPICard title="Backlog" value={open.reduce((s, w) => s + (w.est_hrs || 0), 0).toFixed(1) + ' h'}/><KPICard title="In progress" value={open.filter(w => w.status === 'In Progress').length} color="text-blue-700"/></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardHead>By priority</CardHead><div className="py-2"><HBar label="High" value={byPri.High} max={mxP} color="#DC2626"/><HBar label="Medium" value={byPri.Medium} max={mxP} color="#D97706"/><HBar label="Low" value={byPri.Low} max={mxP} color="#16A34A"/></div></Card>
        <Card><CardHead>Aging</CardHead><div className="py-2">{Object.entries(aging).map(([k, v], i) => <HBar key={k} label={k} value={v} max={mxA} color={['#16A34A', '#D97706', '#EA580C', '#DC2626'][i]}/>)}</div></Card>
        <Card><CardHead>Top assets by open WOs</CardHead><div className="py-2">{top.length ? top.map(([k, v]) => <HBar key={k} label={k} value={v} max={mxAs} color="#1D4ED8"/>) : <p className="px-4 py-3 text-sm text-slate-400">Nothing open.</p>}</div></Card>
      </div>
    </div>
  )
}
export function ClosedInsightsPage() {
  const { workOrders } = useApp()
  const closed = workOrders.filter(w => w.status === 'Closed')
  const onTime = closed.filter(w => w.closed_on && w.closed_on <= w.due_date)
  const comp = closed.length ? onTime.length / closed.length : 0
  const est = closed.reduce((s, w) => s + (w.est_hrs || 0), 0), sp = closed.reduce((s, w) => s + spentHrs(w), 0)
  const res = { OK: 0, Adjusted: 0, Replaced: 0, 'Needs attention': 0 }
  closed.forEach(w => (w.wo_tasks || []).forEach(t => { if (t.result && res[t.result] !== undefined) res[t.result]++ }))
  const mxR = Math.max(...Object.values(res), 1)
  const byType = { Preventive: closed.filter(w => w.type === 'Preventive').length, Corrective: closed.filter(w => w.type === 'Corrective').length }
  const mxT = Math.max(...Object.values(byType), 1)
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">Closed Work Order Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Card className="flex items-center gap-4 p-4 col-span-2"><div className="text-center"><GaugeSVG pct={comp}/><div className="text-xs text-slate-400">closed on time</div></div><div><div className="text-xs font-bold uppercase text-slate-400 mb-1">Compliance</div><div className="text-xs text-slate-400">{onTime.length} of {closed.length} on time</div></div></Card><KPICard title="Closed" value={closed.length} color="text-slate-500"/><KPICard title="Spent / est" value={sp.toFixed(1) + ' / ' + est.toFixed(1) + ' h'} color="text-blue-700" sub={est ? Math.round(sp / est * 100) + '% accuracy' : ''}/></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardHead>Task results</CardHead><div className="py-2"><HBar label="OK" value={res.OK} max={mxR} color="#16A34A"/><HBar label="Adjusted" value={res.Adjusted} max={mxR} color="#D97706"/><HBar label="Replaced" value={res.Replaced} max={mxR} color="#1D4ED8"/><HBar label="Needs attention" value={res['Needs attention']} max={mxR} color="#DC2626"/></div></Card>
        <Card><CardHead>By type</CardHead><div className="py-2"><HBar label="Preventive" value={byType.Preventive} max={mxT} color="#0F766E"/><HBar label="Corrective" value={byType.Corrective} max={mxT} color="#EA580C"/></div></Card>
      </div>
    </div>
  )
}
export function AssetInsightsPage() {
  const { assets, workOrders } = useApp()
  const eq = assets.filter(a => a.kind === 'equipment'), onl = eq.filter(a => a.status === 'Online')
  const byAsset = {}; workOrders.forEach(w => { const a = assets.find(x => x.id === w.asset_id); const k = a?.name || '?'; byAsset[k] = (byAsset[k] || 0) + 1 })
  const top = Object.entries(byAsset).sort((a, b) => b[1] - a[1]).slice(0, 8); const mx = Math.max(...top.map(x => x[1]), 1)
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">Asset Insights</h1>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5"><KPICard title="Total" value={assets.length}/><KPICard title="Equipment" value={eq.length} color="text-teal-700"/><KPICard title="Online" value={onl.length} color="text-green-600" sub={eq.length ? Math.round(onl.length / eq.length * 100) + '%' : ''}/><KPICard title="Offline" value={eq.length - onl.length} color={eq.length - onl.length ? 'text-red-600' : 'text-slate-400'}/><KPICard title="With open WOs" value={[...new Set(workOrders.filter(w => w.status !== 'Closed').map(w => w.asset_id))].length} color="text-blue-700"/></div>
      <Card><CardHead>Most worked-on assets</CardHead><div className="py-2">{top.length ? top.map(([k, v]) => <HBar key={k} label={k} value={v} max={mx} color="#0F766E"/>) : <p className="px-4 py-3 text-sm text-slate-400">No work orders yet.</p>}</div></Card>
    </div>
  )
}

/* ================================= USERS ================================= */
export function UsersPage() {
  const { users, refreshUsers } = useApp()
  const ROLES = { admin: 'Administrator', manager: 'Maintenance Manager', technician: 'Technician' }
  const setRole = async (u, role) => { await supabase.from('profiles').update({ role }).eq('id', u.id); await refreshUsers() }
  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-4">Users &amp; permissions</h1>
      <Note variant="amber">Adding new users needs email auth to be enabled in Supabase. For now you can view users and change roles.</Note>
      <Card>{users.map(u => <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 flex-wrap"><div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: u.color || '#0F766E' }}>{u.initials || '?'}</div><div className="flex-1 min-w-0"><div className="font-bold text-sm">{u.name}</div><div className="text-xs text-slate-400">{u.user_group || '—'}</div></div><select value={u.role} onChange={e => setRole(u, e.target.value)} className="text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white">{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>)}</Card>
    </div>
  )
}