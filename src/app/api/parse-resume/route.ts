import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/utils/crypto'

const PARSE_PROMPT = `Extract structured information from this resume. Return ONLY a valid JSON object with these exact keys:
- preferred_tech_stack: string[] (programming languages, frameworks, tools used in jobs or listed as skills)
- target_industries: string[] (industries the candidate has worked in, e.g. fintech, SaaS, healthtech, e-commerce)
- title_floor: string (their current/highest seniority level: Junior, Mid, Senior, Lead, Staff, Principal, Manager, Director, VP, etc. — pick one word)
- geography_allowed: string[] (locations they have worked in or mentioned, e.g. India, USA, Remote)
- tech_stack_dealbreakers: string[] (always [])
- company_type_excluded: string[] (always [])
- role_type_excluded: string[] (always [])
- min_company_size: null
- max_company_size: null

Return only the raw JSON object. No markdown, no code fences, no explanation.`

type ParsedProfile = {
  preferred_tech_stack: string[]
  target_industries: string[]
  title_floor: string
  geography_allowed: string[]
  tech_stack_dealbreakers: string[]
  company_type_excluded: string[]
  role_type_excluded: string[]
  min_company_size: number | null
  max_company_size: number | null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Accept multipart/form-data with a `file` field
  let resumeText: string
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
        const buffer = Buffer.from(await file.arrayBuffer())
        const data = await pdfParse(buffer)
        resumeText = data.text
      } else {
        resumeText = await file.text()
      }
    } else {
      // Legacy JSON path
      const body = await request.json() as { resume_text?: string }
      resumeText = body.resume_text?.trim() ?? ''
    }
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 400 })
  }

  if (!resumeText.trim()) {
    return NextResponse.json({ error: 'Resume is empty or could not be read' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('api_key_encrypted, api_provider')
    .eq('id', user.id)
    .single()

  if (!profile?.api_key_encrypted) {
    return NextResponse.json(
      { error: 'No API key configured. Add your AI provider key in the AI provider section first.' },
      { status: 400 }
    )
  }

  let apiKey: string
  try {
    apiKey = decrypt(profile.api_key_encrypted as string)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt API key' }, { status: 500 })
  }

  const provider = profile.api_provider ?? 'anthropic'
  let rawText: string

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{ role: 'user', content: `${PARSE_PROMPT}\n\nResume:\n${resumeText}` }],
      }),
    })

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return NextResponse.json(
        { error: err.error?.message ?? `Anthropic API error (${res.status})` },
        { status: res.status }
      )
    }

    const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
    rawText = data.content.find((b) => b.type === 'text')?.text ?? ''
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PARSE_PROMPT },
          { role: 'user', content: `Resume:\n${resumeText}` },
        ],
      }),
    })

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return NextResponse.json(
        { error: err.error?.message ?? `OpenAI API error (${res.status})` },
        { status: res.status }
      )
    }

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    rawText = data.choices[0]?.message?.content ?? ''
  }

  rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: ParsedProfile
  try {
    parsed = JSON.parse(rawText) as ParsedProfile
  } catch {
    return NextResponse.json({ error: 'AI returned unparseable response. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ parsed })
}
