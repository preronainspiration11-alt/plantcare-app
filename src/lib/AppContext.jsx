import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, fetchProfile, fetchAssets, fetchTaskGroups, fetchWorkOrders,
         fetchSchedules, fetchWorkRequests, fetchPurchaseRequests,
         fetchProjects, fetchPlantUsers, fetchUserGroups } from './supabase'

const AppCtx = createContext(null)

export function AppProvider({ children,mockProfile }) {
  const [session,    setSession]    = useState(mockProfile ? 'mock' : undefined)
  const [profile,    setProfile]    = useState(mockProfile || null)
  const [loading,    setLoading]    = useState(mockProfile ? false : true)
  const [flash,      setFlash]      = useState('')
  const [users,      setUsers]      = useState([])
  const [userGroups, setUserGroups] = useState([])
  const [assets,     setAssets]     = useState([])
  const [taskGroups, setTaskGroups] = useState([])
  const [projects,   setProjects]   = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [schedules,  setSchedules]  = useState([])
  const [workReqs,   setWorkReqs]   = useState([])
  const [purchReqs,  setPurchReqs]  = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session) setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || session === 'mock') return
    async function load() {
      setLoading(true)
      try {
        const prof = await fetchProfile(session.user.id)
        setProfile(prof)
        await refreshAll()
      } catch (e) {
        console.error('load error', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [session?.user?.id])

  const refreshAll = useCallback(async () => {
    const [u, ug, a, tg, pr, wo, sc, wr, purr] = await Promise.all([
      fetchPlantUsers(), fetchUserGroups(), fetchAssets(), fetchTaskGroups(),
      fetchProjects(), fetchWorkOrders(), fetchSchedules(),
      fetchWorkRequests(), fetchPurchaseRequests()
    ])
    setUsers(u); setUserGroups(ug); setAssets(a); setTaskGroups(tg)
    setProjects(pr); setWorkOrders(wo); setSchedules(sc)
    setWorkReqs(wr); setPurchReqs(purr)
  }, [])

  const refreshWOs      = useCallback(async () => { setWorkOrders(await fetchWorkOrders()) }, [])
  const refreshWReqs    = useCallback(async () => { setWorkReqs(await fetchWorkRequests()) }, [])
  const refreshPReqs    = useCallback(async () => { setPurchReqs(await fetchPurchaseRequests()) }, [])
  const refreshScheds   = useCallback(async () => { setSchedules(await fetchSchedules()) }, [])
  const refreshTGs      = useCallback(async () => { setTaskGroups(await fetchTaskGroups()) }, [])
  const refreshProjects = useCallback(async () => { setProjects(await fetchProjects()) }, [])
  const refreshAssets   = useCallback(async () => { setAssets(await fetchAssets()) }, [])
  const refreshUsers    = useCallback(async () => { setUsers(await fetchPlantUsers()); setUserGroups(await fetchUserGroups()) }, [])

  useEffect(() => {
    if (mockProfile) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (!session) setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const value = {
    session, profile, loading, flash, setFlash,
    users, userGroups, assets, taskGroups, projects,
    workOrders, schedules, workReqs, purchReqs,
    refreshAll, refreshWOs, refreshWReqs, refreshPReqs,
    refreshScheds, refreshTGs, refreshProjects, refreshAssets, refreshUsers,
    perms: profile ? {
      viewAll:      profile.role !== 'technician',
      edit:         profile.role !== 'technician',
      create:       profile.role !== 'technician',
      approve:      ['admin','manager'].includes(profile.role),
      manageAssets: ['admin','manager'].includes(profile.role),
      manageTG:     ['admin','manager'].includes(profile.role),
      manageUsers:  profile.role === 'admin',
    } : {},
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export const useApp = () => useContext(AppCtx)