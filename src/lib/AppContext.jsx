import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, fetchAssets, fetchWorkOrders, fetchPlantUsers,
         fetchTaskGroups, fetchProjects, fetchSchedules, fetchUserGroups } from './supabase'

// Hardcoded admin profile (no login for now). Swap for real auth later.
const PROFILE = { id: '1a29fe6b-6cb9-45c8-94aa-40e0f23c8b3a', plant_id: 'p1', name: 'Plant Admin', role: 'admin', initials: 'PA', color: '#0F766E' }

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const [assets, setAssets]         = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [users, setUsers]           = useState([])
  const [taskGroups, setTaskGroups] = useState([])
  const [projects, setProjects]     = useState([])
  const [schedules, setSchedules]   = useState([])
  const [workReqs, setWorkReqs]     = useState([])
  const [purchReqs, setPurchReqs]   = useState([])
  const [userGroups, setUserGroups] = useState([])
  const [flash, setFlash]           = useState('')
  const [loading, setLoading]       = useState(true)

  const profile = PROFILE
  const perms = { viewAll: true, edit: true, create: true, approve: true, manageAssets: true, manageTG: true, manageUsers: true }

  const refreshWOs        = useCallback(async () => { try { setWorkOrders(await fetchWorkOrders()) } catch (e) { console.error('WOs', e) } }, [])
  const refreshAssets     = useCallback(async () => { try { setAssets(await fetchAssets()) } catch (e) { console.error('assets', e) } }, [])
  const refreshUsers      = useCallback(async () => { try { setUsers(await fetchPlantUsers()) } catch (e) { console.error('users', e) } }, [])
  const refreshTGs        = useCallback(async () => { try { setTaskGroups(await fetchTaskGroups()) } catch (e) { console.error('tg', e) } }, [])
  const refreshProjects   = useCallback(async () => { try { setProjects(await fetchProjects()) } catch (e) { console.error('proj', e) } }, [])
  const refreshScheds     = useCallback(async () => { try { setSchedules(await fetchSchedules()) } catch (e) { console.error('sched', e) } }, [])
  const refreshUserGroups = useCallback(async () => { try { setUserGroups(await fetchUserGroups()) } catch (e) { console.error('ug', e) } }, [])
  const refreshWReqs      = useCallback(async () => {
    try { const { data } = await supabase.from('work_requests').select('*').order('created_at', { ascending: false }); setWorkReqs(data || []) }
    catch (e) { console.error('wreq', e) }
  }, [])
  const refreshPReqs      = useCallback(async () => {
    try { const { data } = await supabase.from('purchase_requests').select('*').order('created_at', { ascending: false }); setPurchReqs(data || []) }
    catch (e) { console.error('preq', e) }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshWOs(), refreshAssets(), refreshUsers(), refreshTGs(), refreshProjects(), refreshScheds(), refreshWReqs(), refreshPReqs(), refreshUserGroups()])
    setLoading(false)
  }, [])

  useEffect(() => { refreshAll() }, [])

  return (
    <Ctx.Provider value={{
      profile, perms, loading, flash, setFlash,
      assets, workOrders, users, taskGroups, projects, schedules, workReqs, purchReqs, userGroups,
      refreshWOs, refreshAssets, refreshUsers, refreshTGs, refreshProjects, refreshScheds,
      refreshWReqs, refreshPReqs, refreshUserGroups, refreshAll
    }}>
      {children}
    </Ctx.Provider>
  )
}