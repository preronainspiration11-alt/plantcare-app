import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { Card, Btn, Pill } from '../components/ui'
import { buildAssetTree, KIND_IC } from '../lib/utils'
import { upsertAsset } from '../lib/supabase'

export default function AssetsPage({ kind = 'all' }) {
  const { profile, perms, assets, workOrders, refreshAssets } = useApp()
  const [closed, setClosed] = useState({})
  const [adding, setAdding] = useState(false)
  const [form,   setForm]   = useState({ name:'', code:'', kind:'equipment', status:'Online', parent_id:'' })

  const filtered = kind === 'all' ? assets : assets.filter(a => a.kind === kind)
  const tree     = kind === 'all' ? buildAssetTree(assets, closed) : filtered.map(a => ({ a, depth:0, hasKids:false }))
  const open     = workOrders.filter(w => w.status !== 'Closed')
  const treeAll  = buildAssetTree(assets)
  const title    = { all:'All Assets', location:'Facilities', equipment:'Equipment', tool:'Tools' }[kind] || 'Assets'

  async function handleStatus(a, status) {
    await upsertAsset({ ...a, status })
    await refreshAssets()
  }

  async function handleAdd() {
    if (!form.name || !form.code) { alert('Name and code are required.'); return }
    await upsertAsset({ ...form, plant_id: profile.plant_id, parent_id: form.parent_id || null })
    await refreshAssets()
    setAdding(false)
    setForm({ name:'', code:'', kind:'equipment', status:'Online', parent_id:'' })
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-black">{title}</h1>
        <span className="text-xs text-slate-400">{filtered.length} records</span>
        <div className="flex-1"/>
        {perms.manageAssets && <Btn variant="teal" onClick={() => setAdding(true)}>+ Add asset</Btn>}
      </div>

      <Card>
        <div className="flex px-4 py-2.5 border-b border-slate-100 bg-slate-50 rounded-t-2xl text-xs font-bold uppercase tracking-wide text-slate-400">
          <span className="flex-1">Name</span>
          <span className="w-32">Code</span>
          <span className="w-24">Status</span>
          <span className="w-20">Open WOs</span>
        </div>
        {tree.map(({ a, depth, hasKids }) => {
          const woCount = open.filter(w => w.asset_id === a.id).length
          return (
            <div key={a.id} className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 text-sm hover:bg-slate-50">
              <span style={{ width: depth * 20 }} className="flex-shrink-0"/>
              {hasKids
                ? <button onClick={() => setClosed(c => ({ ...c, [a.id]: !c[a.id] }))}
                    className="w-5 text-center text-slate-400 font-bold hover:text-slate-700">
                    {closed[a.id] ? '+' : '-'}
                  </button>
                : <span className="w-5 text-center text-slate-300">·</span>}
              <span className="text-base">{KIND_IC[a.kind] || '🔩'}</span>
              <span className="flex-1 truncate font-medium">{a.name}</span>
              <span className="w-32 text-slate-400 text-xs truncate">{a.code}</span>
              <span className="w-24">
                {perms.manageAssets
                  ? <select value={a.status} onChange={e => handleStatus(a, e.target.value)}
                      className="text-xs border border-slate-300 rounded-lg px-1 py-0.5 bg-white">
                      <option>Online</option><option>Offline</option>
                    </select>
                  : <Pill on={a.status === 'Online'}>{a.status}</Pill>}
              </span>
              <span className="w-20 text-xs text-slate-400">{woCount > 0 ? `${woCount} open` : '—'}</span>
            </div>
          )
        })}
        {tree.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No assets found.</p>}
      </Card>

      {adding && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
             onClick={e => { if (e.target === e.currentTarget) setAdding(false) }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <div className="flex justify-between mb-4">
              <div className="font-black text-base">Add asset</div>
              <button onClick={() => setAdding(false)} className="text-slate-400 font-bold text-xl">✕</button>
            </div>
            <div className="mb-3">
              <div className="text-xs font-bold uppercase text-slate-400 mb-1">Parent (optional)</div>
              <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">— Top level —</option>
                {treeAll.map(n => <option key={n.a.id} value={n.a.id}>{'  '.repeat(n.depth)}{n.a.name}</option>)}
              </select>
            </div>
            <div className="mb-3">
              <div className="text-xs font-bold uppercase text-slate-400 mb-1">Name</div>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="e.g. Case Packer"/>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <div className="text-xs font-bold uppercase text-slate-400 mb-1">Code</div>
                <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="A305"/>
              </div>
              <div>
                <div className="text-xs font-bold uppercase text-slate-400 mb-1">Type</div>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
                  <option value="equipment">Equipment</option>
                  <option value="tool">Tool</option>
                  <option value="line">Line</option>
                  <option value="location">Facility</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="line" onClick={() => setAdding(false)}>Cancel</Btn>
              <Btn variant="teal" onClick={handleAdd}>Add asset</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}