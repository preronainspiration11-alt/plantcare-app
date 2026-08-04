import { useState } from 'react'
import { supabase } from '../lib/supabase'

const PLANTS = [
  { id: 'p1', name: 'Uluberia Plant',  code: 'PCUB', loc: 'ITC PCPB · West Bengal',      ic: '🏭', bg: '#CCFBF1' },
  { id: 'p2', name: 'Manpura Plant',   code: 'PCMP', loc: 'ITC PCPB · Himachal Pradesh', ic: '⚙️', bg: '#EDE9FE' },
  { id: 'p3', name: 'Haridwar Plant',  code: 'PCHD', loc: 'ITC PCPB · Uttarakhand',      ic: '🔧', bg: '#FEF3C7' },
]

export default function LoginPage() {
  const [plantId, setPlantId] = useState(null)
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [err,     setErr]     = useState('')
  const [loading, setLoading] = useState(false)

  async function doLogin() {
    if (!email || !pass) { setErr('Enter your email and password.'); return }
    setLoading(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    setLoading(false)
    if (error) { setErr(error.message); return }
  }

  const pl = PLANTS.find(p => p.id === plantId)

  if (!plantId) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-teal-900">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-10 h-10 bg-teal-400 rounded-2xl flex items-center justify-center text-white font-black text-xl">P</div>
          <div className="text-white text-2xl font-black">PlantCare <span className="text-teal-300">CMMS</span></div>
        </div>
        <p className="text-slate-400 text-center text-sm mb-8">ITC PCPB — Preventive Maintenance System</p>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="font-bold text-base mb-1">Choose your plant</div>
          <p className="text-xs text-slate-400 mb-4">Each plant is fully isolated — you will only see your own plant data.</p>
          {PLANTS.map(p => (
            <button key={p.id} onClick={() => setPlantId(p.id)}
              className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-2xl mb-3 text-left hover:border-teal-400 hover:bg-teal-50 transition-colors">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: p.bg }}>{p.ic}</div>
              <div>
                <div className="font-bold text-sm">{p.name}</div>
                <div className="text-xs text-slate-400">{p.loc}</div>
              </div>
              <span className="ml-auto text-teal-600 font-black">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-teal-900">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-10 h-10 bg-teal-400 rounded-2xl flex items-center justify-center text-white font-black text-xl">P</div>
          <div className="text-white text-2xl font-black">PlantCare <span className="text-teal-300">CMMS</span></div>
        </div>
        <p className="text-slate-400 text-center text-sm mb-8">Preventive Maintenance System</p>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 text-teal-800 rounded-full px-3 py-1.5 text-xs font-bold mb-5">
            {pl.ic} {pl.name} · {pl.code}
          </div>
          <div className="font-bold text-base mb-4">Sign in</div>
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5 mb-4">{err}</div>}
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()}
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="you@company.com" autoFocus/>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Password</label>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()}
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="••••••••"/>
          <button onClick={doLogin} disabled={loading}
            className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl py-3 text-sm transition-colors disabled:opacity-60">
            {loading ? 'Signing in…' : `Sign in to ${pl.name}`}
          </button>
          <button onClick={() => { setPlantId(null); setErr('') }}
            className="block w-full text-center text-teal-700 text-xs font-bold mt-4">
            ← Change plant
          </button>
        </div>
      </div>
    </div>
  )
}