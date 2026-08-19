// Edge Function: create-user
// Runs on Supabase servers (NOT the browser), so it can safely hold the service-role key.
// It verifies the caller is a logged-in admin, then creates the new auth user + profile.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  function json(obj: unknown, status: number) {
    return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // 1) Identify the caller from their JWT
    const authHeader = req.headers.get('Authorization') || ''
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Not signed in.' }, 401)

    // 2) Confirm the caller is an admin
    const admin = createClient(url, serviceKey)
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.id).single()
    if (!callerProfile || callerProfile.role !== 'admin') return json({ error: 'Only admins can create users.' }, 403)

    // 3) Read the new-user details
    const body = await req.json()
    const { email, password, name, role, plant_id } = body
    if (!email || !password || !name || !role || !plant_id) return json({ error: 'Missing fields.' }, 400)
    if (!['admin', 'manager', 'technician'].includes(role)) return json({ error: 'Bad role.' }, 400)

    // 4) Create the auth user (pre-confirmed)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (createErr) return json({ error: createErr.message }, 400)

    // 5) Create their profile row
    const initials = name.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    const { error: profErr } = await admin.from('profiles').insert({
      id: created.user.id, email, name, role, plant_id, initials, color: '#0F766E',
    })
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: 'Profile create failed: ' + profErr.message }, 400)
    }

    return json({ ok: true, id: created.user.id }, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
