import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  let dbEnvironment = 'unknown'
  try {
    const { data } = await supabase
      .from('_environment')
      .select('value')
      .eq('key', 'name')
      .single()
    dbEnvironment = data?.value ?? 'production (no _environment table)'
  } catch {
    dbEnvironment = 'production (no _environment table)'
  }

  return Response.json({
    status: 'ok',
    app: 'jd-fit-checker',
    environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'unknown',
    app_name: process.env.NEXT_PUBLIC_APP_NAME,
    app_url: process.env.NEXT_PUBLIC_APP_URL,
    supabase_project:
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace('https://', '').slice(0, 24) + '...',
    db_environment: dbEnvironment,
    screening_api: process.env.NEXT_PUBLIC_SCREENING_API_URL,
    dev_banner: process.env.NEXT_PUBLIC_SHOW_DEV_BANNER,
    timestamp: new Date().toISOString(),
  })
}
