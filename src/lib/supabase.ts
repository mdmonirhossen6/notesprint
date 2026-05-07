import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file.')
}

if (supabaseAnonKey.startsWith('sb_publishable_')) {
  console.error('ERROR: It looks like you are using a Stripe Publishable Key instead of a Supabase Anon Key. Please check your .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
