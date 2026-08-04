import { NavLink } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { Avatar } from './ui'
import { signOut } from '../lib/supabase'

const PLANTS = {
  p1: { name: 'Uluberia Plant', ic: '🏭' },
  p2: { name: 'Manpura Plant',  ic: '⚙️' },
  p3: { name: 'Haridwar Plant', ic: '🔧' },
}

export default function Sidebar({ onClose }) {
  const { profile, perms, workReqs, purchReqs } = useApp()
  if (!profile) return null

  const pendW = workReqs.filter(r => r.status === 'Pending').length
  const pendP = purchReqs.filter(r => r.status === 'Pending').length
  const pl    = PLANTS[profile.plant_id] || {}

  const Item = ({ to, icon, label, badge, sub }) => (
    <NavLink to={to} onClick={onClose}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium mb-0.5 transition-colors
         ${sub ? 'ml-4' : ''}
         ${isActive ? 'bg-teal-900/40 text-teal-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`
      }>
      <span className="w-4 text-center text-base">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? <span className="bg-amber-500 text-white text-xs font-black rounded-full px-1.5 py-0.5">{badge}</span> : null}
    </NavLink>
  )

  return (
    <aside className="bg-slate-900 text-slate-300 w-60 flex-shrink-0 flex flex-col h-screen">
      <div className="px-4 py-3.5 border-b border-slate-800 flex items-center gap-2.5 flex-shrink-0">
        <div className="w-8 h-8 bg-teal-500 rounded-xl flex items-center justify-center text-white font-black text-base">P</div>
        <div>
          <div className="text-white font-black text-sm leading-tight">PlantCare</div>
          <div className="text-slate-500 text-xs">{pl.ic} {pl.name}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="text-xs uppercase tracking-widest text-slate-600 font-bold px-3 py-2">Dashboard</div>
        <Item to="/"                 icon="▦" label="Dashboard"/>
        <Item to="/work-orders"      icon="☰" label="Work Orders"/>
        <Item to="/assigned-wos"     icon="☰" label="Assigned Work Orders"/>
        <Item to="/assets"           icon="🌳" label="All Assets"/>
        <Item to="/facilities"       icon="🏭" label="Facilities"  sub/>
        <Item to="/equipment"        icon="🔩" label="Equipment"   sub/>
        <Item to="/tools"            icon="🧰" label="Tools"       sub/>
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-2">
          <Avatar initials={profile.initials || '?'} color={profile.color || '#0F766E'} size="sm"/>
          <div className="min-w-0">
            <div className="text-white text-xs font-bold truncate">{profile.name}</div>
            <div className="text-slate-500 text-xs">{profile.role}</div>
          </div>
        </div>
        <button onClick={signOut} className="w-full border border-slate-700 rounded-xl py-1.5 text-slate-400 text-xs hover:bg-slate-800 transition-colors">
          Log off
        </button>
      </div>
    </aside>
  )
}