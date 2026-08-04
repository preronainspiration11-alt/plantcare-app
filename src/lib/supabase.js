import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://itzkbcwyxrvldvkgxcfa.supabase.co',
  'sb_publishable_mEymDkUn9Pgl3KVahDqiiw_qssAnB-F'
)

export async function signOut() {
  await supabase.auth.signOut()
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export async function fetchPlantUsers() {
  const { data, error } = await supabase.from('profiles').select('*').order('name')
  if (error) throw error
  return data
}

export async function fetchAssets() {
  const { data, error } = await supabase.from('assets').select('*').order('name')
  if (error) throw error
  return data
}

export async function fetchWorkOrders() {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, wo_tasks(*), wo_parts(*), wo_log(*)')
    .order('due_date', { ascending: true })
  if (error) throw error
  return data.map(w => ({
    ...w,
    wo_tasks: (w.wo_tasks || []).sort((a,b) => a.position - b.position),
    wo_log: (w.wo_log || []).sort((a,b) => a.created_at < b.created_at ? -1 : 1),
  }))
}

export async function createWorkOrder(wo) {
  const { tasks, log, ...fields } = wo
  const { data, error } = await supabase.from('work_orders').insert(fields).select().single()
  if (error) throw error
  const woId = data.id
  if (tasks && tasks.length) {
    await supabase.from('wo_tasks').insert(
      tasks.map((t,i) => ({ wo_id: woId, position: i, description: t.description, est_hrs: parseFloat(t.est_hrs)||null }))
    )
  }
  if (log && log.length) {
    await supabase.from('wo_log').insert(
      log.map(l => ({ wo_id: woId, author_name: l.author_name, body: l.body }))
    )
  }
  return woId
}

export async function updateWorkOrder(id, fields) {
  const { error } = await supabase.from('work_orders').update(fields).eq('id', id)
  if (error) throw error
}

export async function updateTask(taskId, fields) {
  const { error } = await supabase.from('wo_tasks').update(fields).eq('id', taskId)
  if (error) throw error
}

export async function addLogEntry(woId, authorId, authorName, body) {
  const { error } = await supabase.from('wo_log').insert({ wo_id: woId, author_id: authorId, author_name: authorName, body })
  if (error) throw error
}

export async function addPart(woId, name, qty) {
  const { error } = await supabase.from('wo_parts').insert({ wo_id: woId, name, qty })
  if (error) throw error
}

export async function fetchTaskGroups() {
  const { data, error } = await supabase.from('task_groups').select('*, task_group_items(*)').order('name')
  if (error) throw error
  return data.map(g => ({
    ...g,
    task_group_items: (g.task_group_items || []).sort((a,b) => a.position - b.position)
  }))
}

export async function fetchProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function saveProject(proj) {
  const { data, error } = await supabase.from('projects').upsert(proj).select().single()
  if (error) throw error
  return data
}

export async function fetchSchedules() {
  const { data, error } = await supabase.from('schedules').select('*').order('next_due')
  if (error) throw error
  return data
}

export async function saveSchedule(sched) {
  const { data, error } = await supabase.from('schedules').upsert(sched).select().single()
  if (error) throw error
  return data
}

export async function updateSchedule(id, fields) {
  const { error } = await supabase.from('schedules').update(fields).eq('id', id)
  if (error) throw error
}

export async function deleteSchedule(id) {
  const { error } = await supabase.from('schedules').delete().eq('id', id)
  if (error) throw error
}

export async function fetchWorkRequests() {
  const { data, error } = await supabase.from('work_requests').select('*, profiles(name, initials, color), assets(name)').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function saveWorkRequest(req) {
  const { data, error } = await supabase.from('work_requests').upsert(req).select().single()
  if (error) throw error
  return data
}

export async function fetchPurchaseRequests() {
  const { data, error } = await supabase.from('purchase_requests').select('*, profiles(name, initials)').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function savePurchaseRequest(req) {
  const { data, error } = await supabase.from('purchase_requests').upsert(req).select().single()
  if (error) throw error
  return data
}

export async function fetchUserGroups() {
  const { data, error } = await supabase.from('user_groups').select('*').order('name')
  if (error) throw error
  return data
}

export async function saveUserGroup(group) {
  const { data, error } = await supabase.from('user_groups').insert(group).select().single()
  if (error) throw error
  return data
}

export async function deleteUserGroup(id) {
  const { error } = await supabase.from('user_groups').delete().eq('id', id)
  if (error) throw error
}

export async function upsertAsset(asset) {
  const { data, error } = await supabase.from('assets').upsert(asset).select().single()
  if (error) throw error
  return data
}

export async function createUser(email, password, meta) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: meta } })
  if (error) throw error
  return data
}