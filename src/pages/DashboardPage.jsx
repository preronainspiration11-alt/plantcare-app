import { useApp } from '../lib/AppContext'
import { KPICard, RingSVG, GaugeSVG, Card, CardHead, Badge } from '../components/ui'
import { fmtDate, spentHrs, PRIORITY_COLOR } from '../lib/utils'

export default function DashboardPage() {
  const { workOrders, users, assets } = useApp()
  const today = new Date().toISOString().slice(0,10)
  const open    = workOrders.filter(w => w.status !== 'Closed')
  const closed  = workOrders.filter(w => w.status === 'Closed')
  const overdue = open.filter(w => w.due_date && w.due_date < today)
  const onTime  = closed.filter(w => w.closed_on && w.closed_on <= w.due_date)
  const comp    = closed.length ? onTime.length / closed.length : 0
  const backlog = open.reduce((s,w) => s + (w.est_hrs||0), 0)
  const spent   = workOrders.reduce((s,w) => s + spentHrs(w), 0)
  const techs   = users.filter(u => u.role === 'technician')

  return (
    <div className="p-6">
      <h1 className="text-xl font-black mb-5">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="flex items-center gap-4 p-4 col-span-2">
          <div className="text-center">
            <GaugeSVG pct={comp}/>
            <div className="text-xs text-slate-400">closed on time</div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Schedule Compliance</div>
            <div className="text-xs text-slate-400">{onTime.length} of {closed.length} closed WOs met their due date</div>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-4 col-span-2">
          <RingSVG n={overdue.length} total={workOrders.length} color="#B91C1C"/>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Overdue Work Orders</div>
            <div className="text-xs text-slate-400">{overdue.length} of {workOrders.length} total WOs are overdue</div>
          </div>
        </Card>
        <KPICard title="Open work orders" value={open.length}             color="text-teal-700"/>
        <KPICard title="Closed"           value={closed.length}           color="text-slate-500"/>
        <KPICard title="Backlog (est)"    value={backlog.toFixed(1)+' h'}/>
        <KPICard title="Hours spent"      value={spent.toFixed(1)+' h'}   color="text-blue-700"/>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHead>Open work orders</CardHead>
          {open.length === 0
            ? <p className="px-4 py-6 text-sm text-slate-400">No open work orders.</p>
            : open.slice(0,8).map(w => {
                const a = assets.find(x => x.id === w.asset_id) || { name: '?' }
                const od = w.due_date && w.due_date < today
                return (
                  <div key={w.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 text-sm">
                    <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[w.priority] }}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">#{w.id} · {w.title}</div>
                      <div className="text-xs text-slate-400">{a.name} · due <span className={od ? 'text-red-600 font-bold' : ''}>{fmtDate(w.due_date)}</span></div>
                    </div>
                    <Badge variant={w.priority}>{w.priority}</Badge>
                  </div>
                )
              })
          }
        </Card>
        <Card>
          <CardHead>Workload by technician</CardHead>
          {techs.length === 0
            ? <p className="px-4 py-4 text-sm text-slate-400">No technicians in this plant yet.</p>
            : techs.map(t => {
                const o  = open.filter(w => w.assigned_to === t.id)
                const od = o.filter(w => w.due_date && w.due_date < today)
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 text-sm">
                    <div className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                         style={{ background: t.color||'#0F766E' }}>{t.initials||'?'}</div>
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-teal-700 font-bold">{o.length} open</span>
                    {od.length ? <span className="text-red-600 font-bold">{od.length} overdue</span> : <span className="text-slate-400">on track</span>}
                  </div>
                )
              })
          }
        </Card>
      </div>
    </div>
  )
}