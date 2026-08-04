export function Badge({ variant = 'status', children }) {
  const cls = {
    High:    'bg-red-100 text-red-800',
    Medium:  'bg-amber-100 text-amber-800',
    Low:     'bg-green-100 text-green-800',
    status:  'bg-slate-100 text-slate-600',
    type:    'bg-indigo-50 text-indigo-700',
    pending: 'bg-amber-100 text-amber-800',
    ok:      'bg-green-100 text-green-800',
    rej:     'bg-red-100 text-red-800',
  }[variant] || 'bg-slate-100 text-slate-600'
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${cls}`}>{children}</span>
}

export function Btn({ variant = 'line', children, className = '', ...props }) {
  const cls = {
    teal:  'bg-teal-700 text-white hover:bg-teal-800',
    line:  'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50',
    ghost: 'border border-teal-700 text-teal-700 bg-white hover:bg-teal-50',
    red:   'border border-red-300 text-red-600 bg-white hover:bg-red-50',
    dark:  'bg-slate-800 text-white hover:bg-slate-700',
  }[variant] || ''
  return <button {...props} className={`rounded-xl px-3.5 py-2 text-sm font-bold cursor-pointer transition-colors ${cls} ${className}`}>{children}</button>
}

export function Card({ children, className = '' }) {
  return <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`}>{children}</div>
}

export function CardHead({ children, action }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 font-bold text-sm">
      <span>{children}</span>
      {action && <span>{action}</span>}
    </div>
  )
}

export function Lbl({ children }) {
  return <div className="text-xs uppercase tracking-wide text-slate-400 font-bold mb-1">{children}</div>
}

export function KPICard({ title, value, sub, color = 'text-slate-900' }) {
  return (
    <Card className="p-4">
      <Lbl>{title}</Lbl>
      <div className={`text-3xl font-black mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </Card>
  )
}

export function RingSVG({ n, total, color }) {
  const R = 48, C = 2 * Math.PI * R
  const pct = total ? n / total : 0
  return (
    <svg width={112} height={112} viewBox="0 0 120 120">
      <circle cx={60} cy={60} r={R} fill="none" stroke="#E2E8F0" strokeWidth={13}/>
      <circle cx={60} cy={60} r={R} fill="none" stroke={color} strokeWidth={13} strokeLinecap="round"
        strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 60 60)"/>
      <text x={60} y={56} textAnchor="middle" fontSize={24} fontWeight={700} fill="#0F172A">{n}</text>
      <text x={60} y={75} textAnchor="middle" fontSize={11} fill="#64748B">of {total}</text>
    </svg>
  )
}

export function GaugeSVG({ pct }) {
  const R = 46, C = Math.PI * R
  return (
    <svg width={120} height={72} viewBox="0 0 120 72">
      <path d="M 14 62 A 46 46 0 0 1 106 62" fill="none" stroke="#E2E8F0" strokeWidth={12} strokeLinecap="round"/>
      <path d="M 14 62 A 46 46 0 0 1 106 62" fill="none" stroke="#1D4ED8" strokeWidth={12} strokeLinecap="round"
        strokeDasharray={`${C * pct} ${C}`}/>
      <text x={60} y={58} textAnchor="middle" fontSize={20} fontWeight={700} fill="#0F172A">{Math.round(pct * 100)}%</text>
    </svg>
  )
}

export function HBar({ label, value, max, color = '#0F766E' }) {
  const pct = max ? Math.round(value / max * 100) : 0
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-sm">
      <span className="w-44 flex-shrink-0 text-slate-500 truncate">{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden">
        <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: color }}/>
      </div>
      <span className="w-10 text-right font-bold text-slate-700">{value}</span>
    </div>
  )
}

export function ProgressBar({ done, total }) {
  const pct = total ? done / total * 100 : 0
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-3">
      <div className="h-full bg-teal-600 rounded-full transition-all" style={{ width: `${pct}%` }}/>
    </div>
  )
}

export function Avatar({ initials, color, size = 'md' }) {
  const sz = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' }[size]
  return (
    <div className={`rounded-full text-white font-bold flex items-center justify-center flex-shrink-0 ${sz}`}
         style={{ background: color }}>
      {initials}
    </div>
  )
}

export function Note({ variant = 'grey', children }) {
  const cls = {
    grey:  'bg-slate-50 border-slate-200 text-slate-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red:   'bg-red-50 border-red-200 text-red-700',
  }[variant]
  return <div className={`text-sm rounded-xl p-3 mb-3 border ${cls}`}>{children}</div>
}

export function Modal({ title, sub, eyebrow, onClose, footer, children, maxWidth = 'max-w-3xl' }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-2xl w-full ${maxWidth} max-h-[92vh] flex flex-col shadow-2xl`}>
        <div className="px-5 pt-5 pb-4 border-b border-slate-200">
          <button onClick={onClose} className="float-right text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
          {eyebrow && <div className="text-xs uppercase tracking-wide text-slate-400 font-bold">{eyebrow}</div>}
          <div className="text-lg font-black mt-1">{title}</div>
          {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-5">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-2 flex-wrap">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Field({ label, children, full }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <Lbl>{label}</Lbl>
      {children}
    </div>
  )
}

export function Input({ className = '', ...props }) {
  return <input {...props} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400 ${className}`}/>
}

export function Select({ children, className = '', ...props }) {
  return (
    <select {...props} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50 disabled:text-slate-400 ${className}`}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...props }) {
  return <textarea {...props} className={`w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white resize-y focus:outline-none focus:ring-2 focus:ring-teal-600 ${className}`}/>
}

export function Pill({ on, children }) {
  return (
    <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${on ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-600'}`}>
      {children}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"/>
    </div>
  )
}