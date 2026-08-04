import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { Card, Badge, Btn, Modal, Note, ProgressBar, Field, Select, Input, Lbl } from '../components/ui'
import { fmtDate, doneCt, spentHrs, closeBlockers, assetPath } from '../lib/utils'
import { updateWorkOrder, updateTask, addLogEntry, createWorkOrder } from '../lib/supabase'

function WOModal({ wo, onClose }) {
  const { profile, perms, users, assets, refreshWOs } = useApp()
  const [tab, setTab] = useState('checklist')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [closeErr, setCloseErr] = useState('')

  if (!wo) return null
  const a      = assets.find(x => x.id === wo.asset_id) || { name: '?' }
  const closed = wo.status === 'Closed'
  const canExec = perms.edit || wo.assigned_to === profile?.id
  const dn     = doneCt(wo)
  const sp     = spentHrs(wo)

  async function handleTaskToggle(task, checked) {
    await updateTask(task.id, { done: checked })
    await refreshWOs()
  }
  async function handleTaskHrs(task, val) {
    await updateTask(task.id, { hrs_spent: val === '' ? null : parseFloat(val) })
    await refreshWOs()
  }
  async function handleField(field, value) {
    await updateWorkOrder(wo.id, { [field]: value || null })
    await refreshWOs()
  }
  async function handleClose() {
    const blk = closeBlockers(wo)
    if (blk.blocked) { setCloseErr('Cannot close: ' + blk.msgs.join(', ')); return }
    setSaving(true)
    await updateWorkOrder(wo.id, { status: 'Closed', closed_on: new Date().toISOString().slice(0,10) })
    await addLogEntry(wo.id, profile.id, profile.name, `Work order closed. ${sp.toFixed(1)} h spent.`)
    await refreshWOs()
    setSaving(false)
    onClose()
  }
  async function handleAddNote() {
    if (!note.trim()) return
    setSaving(true)
    await addLogEntry(wo.id, profile.id, profile.name, note.trim())
    await refreshWOs()
    setNote('')
    setSaving(false)
  }

  const blk = closeBlockers(wo)
  const tabs = [
    ['checklist', `Checklist (${dn}/${wo.wo_tasks?.length ?? 0})`],
    ['general', 'General'],
    ['log', `Log (${wo.wo_log?.length ?? 0})`],
  ]

  let body
  if (tab === 'checklist') {
    body = <>
      {closed && <Note>Closed {fmtDate(wo.closed_on)} — {sp.toFixed(1)} h spent vs {wo.est_hrs} h estimated.</Note>}
      {!closed && canExec && <Note>Tick every task and enter hours before closing.</Note>}
      <div className="grid grid-cols-[1fr_70px_88px] gap-2 px-3 pb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
        <span>Task</span><span>Est h</span><span>Spent h</span>
      </div>
      {(wo.wo_tasks || []).map(t => {
        const missing = t.done && (t.hrs_spent == null || isNaN(parseFloat(t.hrs_spent)))
        return (
          <div key={t.id} className={`grid grid-cols-[1fr_70px_88px] gap-2 border rounded-xl p-2.5 mb-2 items-center
            ${t.done && !missing ? 'bg-teal-50 border-teal-200' : missing ? 'bg-red-50 border-red-200' : 'border-slate-200'}`}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={t.done} disabled={!canExec || closed}
                onChange={e => handleTaskToggle(t, e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-teal-600 flex-shrink-0"/>
              <span className={`text-sm ${t.done ? 'line-through text-slate-400' : ''}`}>{t.description}</span>
            </label>
            <div className="text-center text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg py-1">{t.est_hrs ?? '—'}</div>
            <input type="text" placeholder="0.0" defaultValue={t.hrs_spent ?? ''} disabled={!canExec || closed}
              onBlur={e => handleTaskHrs(t, e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-full disabled:bg-slate-50"/>
          </div>
        )
      })}
      <ProgressBar done={dn} total={wo.wo_tasks?.length ?? 0}/>
      <div className="text-xs text-slate-400 mt-1.5">{dn} of {wo.wo_tasks?.length ?? 0} tasks · {sp.toFixed(1)} h spent</div>
    </>
  } else if (tab === 'general') {
    body = (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Priority">
          <Select defaultValue={wo.priority} disabled={!perms.edit || closed} onChange={e => handleField('priority', e.target.value)}>
            {['High','Medium','Low'].map(x => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select defaultValue={wo.assigned_to ?? ''} disabled={!perms.edit || closed} onChange={e => handleField('assigned_to', e.target.value)}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Start date">
          <Input type="date" defaultValue={wo.start_date} disabled={!perms.edit || closed}
            onBlur={e => handleField('start_date', e.target.value)}/>
        </Field>
        <Field label="Due date">
          <Input type="date" defaultValue={wo.due_date} disabled={!perms.edit || closed}
            onBlur={e => handleField('due_date', e.target.value)}/>
        </Field>
        <Field label="Asset" full>
          <Input value={assetPath(wo.asset_id, assets)} disabled/>
        </Field>
      </div>
    )
  } else {
    body = <>
      {(wo.wo_log || []).length === 0 && <p className="text-sm text-slate-400 mb-3">No entries yet.</p>}
      {(wo.wo_log || []).map(l => (
        <div key={l.id} className="border border-slate-200 rounded-xl px-3 py-2.5 mb-2">
          <div className="text-xs text-slate-400 mb-1"><strong className="text-slate-700">{l.author_name}</strong> · {fmtDate(l.created_at)}</div>
          <p className="text-sm">{l.body}</p>
        </div>
      ))}
      {canExec && !closed && (
        <div className="flex gap-2 mt-2">
          <input value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddNote()}
            placeholder="Add a note…"
            className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"/>
          <Btn variant="dark" onClick={handleAddNote} disabled={saving}>Add</Btn>
        </div>
      )}
    </>
  }

  return (
    <Modal eyebrow={`Work order · ${a.name}`} title={`#${wo.id} · ${wo.title}`} onClose={onClose}
      footer={<>
        {!closed && canExec && <Btn variant="teal" onClick={handleClose} disabled={saving}>{blk.blocked ? 'Close 🔒' : 'Close work order'}</Btn>}
        {closed && <span className="text-sm text-slate-400">Closed {fmtDate(wo.closed_on)}</span>}
      </>}>
      <div className="flex gap-2 mb-2 flex-wrap">
        <Badge variant={wo.priority}>{wo.priority}</Badge>
        <Badge variant="status">{wo.status}</Badge>
        <span className="text-xs text-slate-400">{fmtDate(wo.start_date)} → {fmtDate(wo.due_date)}</span>
      </div>
      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors
              ${tab === key ? 'text-teal-700 border-teal-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>
      {closeErr && <Note variant="red">{closeErr}</Note>}
      {body}
    </Modal>
  )
}

export default function WorkOrdersPage({ mine = false }) {
  const { profile, perms, workOrders, assets, users, refreshWOs } = useApp()
  const [search,   setSearch]   = useState('')
  const [statusF,  setStatusF]  = useState('All')
  const [openWO,   setOpenWO]   = useState(null)
  const [creating, setCreating] = useState(false)
  const [form,     setForm]     = useState({
    title:'', asset_id:'', assigned_to:'', priority:'Medium', type:'Preventive',
    start_date: new Date().toISOString().slice(0,10),
    due_date: new Date().toISOString().slice(0,10),
    est_hrs:'1', tasks:''
  })
  const [saving, setSaving] = useState(false)

  const base = mine
    ? workOrders.filter(w => w.assigned_to === profile?.id)
    : (perms.viewAll ? workOrders : workOrders.filter(w => w.assigned_to === profile?.id))

  const list = base
    .filter(w => statusF === 'All' || w.status === statusF)
    .filter(w => {
      const a = assets.find(x => x.id === w.asset_id) || { name: '', code: '' }
      return (w.title + w.id + a.name + a.code).toLowerCase().includes(search.toLowerCase())
    })
    .sort((a,b) => (a.due_date||'') < (b.due_date||'') ? -1 : 1)

  const set = (k,v) => setForm(f => ({...f, [k]:v}))

  async function handleCreate() {
    if (!form.title.trim()) { alert('Enter a title.'); return }
    setSaving(true)
    const lines = form.tasks.split('\n').map(s => s.trim()).filter(Boolean)
    const tasks = lines.map((desc,i) => ({ description: desc, position: i }))
    await createWorkOrder({
      plant_id: profile.plant_id,
      title: form.title.trim(),
      asset_id: form.asset_id || null,
      assigned_to: form.assigned_to || null,
      priority: form.priority,
      type: form.type,
      start_date: form.start_date,
      due_date: form.due_date,
      est_hrs: parseFloat(form.est_hrs)||0,
      created_by: profile.id,
      tasks,
      log: [{ author_name: profile.name, body: 'Work order created.' }]
    })
    await refreshWOs()
    setCreating(false)
    setSaving(false)
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-black">{mine ? 'Assigned Work Orders' : 'Work Orders'}</h1>
        <div className="flex-1"/>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
          className="border border-slate-300 rounded-xl px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-600"/>
        <select value={statusF} onChange={e => setStatusF(e.target.value)}
          className="border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
          {['All','Open','In Progress','Closed'].map(s => <option key={s}>{s}</option>)}
        </select>
        {perms.create && !mine && <Btn variant="teal" onClick={() => setCreating(true)}>+ New work order</Btn>}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wide">
              {['WO','Asset','Priority','Status','Assigned to','Due','Checklist'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 border-b border-slate-200 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(w => {
              const a  = assets.find(x => x.id === w.asset_id) || { name: '?' }
              const u  = users.find(x => x.id === w.assigned_to)
              const od = w.due_date && w.due_date < new Date().toISOString().slice(0,10) && w.status !== 'Closed'
              return (
                <tr key={w.id} onClick={() => setOpenWO(w)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5"><div className="font-bold">#{w.id}</div><div className="text-xs text-slate-400 max-w-[180px] truncate">{w.title}</div></td>
                  <td className="px-3 py-2.5 text-slate-600">{a.name}</td>
                  <td className="px-3 py-2.5"><Badge variant={w.priority}>{w.priority}</Badge></td>
                  <td className="px-3 py-2.5"><Badge variant="status">{w.status}</Badge></td>
                  <td className="px-3 py-2.5 max-w-[120px] truncate">{u?.name ?? '—'}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap ${od ? 'text-red-600 font-bold' : ''}`}>{fmtDate(w.due_date)}{od ? ' ⚠' : ''}</td>
                  <td className="px-3 py-2.5 text-slate-400">{doneCt(w)}/{w.wo_tasks?.length ?? 0}</td>
                </tr>
              )
            })}
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No work orders found.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {openWO && <WOModal wo={openWO} onClose={() => setOpenWO(null)}/>}

      {creating && (
        <Modal title="New work order" onClose={() => setCreating(false)} maxWidth="max-w-xl"
          footer={<><Btn variant="line" onClick={() => setCreating(false)}>Cancel</Btn><Btn variant="teal" onClick={handleCreate} disabled={saving}>Create</Btn></>}>
          <div className="mb-3"><Lbl>Title</Lbl><Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Monthly PM — Conveyor 3"/></div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><Lbl>Asset</Lbl>
              <Select value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                <option value="">— None —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            <div><Lbl>Assign to</Lbl>
              <Select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">— None —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
            <div><Lbl>Priority</Lbl>
              <Select value={form.priority} onChange={e => set('priority', e.target.value)}>
                {['High','Medium','Low'].map(x => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div><Lbl>Type</Lbl>
              <Select value={form.type} onChange={e => set('type', e.target.value)}>
                <option>Preventive</option><option>Corrective</option>
              </Select>
            </div>
            <div><Lbl>Start date</Lbl><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}/></div>
            <div><Lbl>Due date</Lbl><Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}/></div>
          </div>
          <div><Lbl>Checklist tasks — one per line</Lbl>
            <textarea rows={5} value={form.tasks} onChange={e => set('tasks', e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-teal-600"
              placeholder={"Check belt tension\nLubricate bearings\nInspect seals"}/>
          </div>
        </Modal>
      )}
    </div>
  )
}