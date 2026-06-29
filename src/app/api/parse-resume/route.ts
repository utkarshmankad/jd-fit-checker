import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/utils/crypto'

const MAX_FILE_BYTES = 5 * 1024 * 1024        // 5 MB
const MAX_TEXT_CHARS = 50_000                  // ~25 pages of text

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

function validatePdfBytes(buf: Buffer): string | null {
  // Must start with PDF magic bytes
  if (!buf.slice(0, 5).toString('ascii').startsWith('%PDF-')) {
    return 'File does not appear to be a valid PDF'
  }
  // Reject PDFs containing embedded JavaScript (/JS or /JavaScript actions)
  const raw = buf.toString('latin1')
  if (/\/JavaScript\s*\(/.test(raw) || /\/JS\s*\(/.test(raw) || /\/AA\s*<</.test(raw)) {
    return 'PDF contains active content and cannot be processed'
  }
  return null
}

function validateTextContent(text: string): string | null {
  // Reject if overwhelmingly binary / non-printable (>15% non-ASCII-printable chars)
  const nonPrintable = (text.match(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g) ?? []).length
  if (nonPrintable / text.length > 0.15) {
    return 'File content appears to be binary or corrupt'
  }
  // Reject suspiciously large text (could be an attempt to overflow the AI context)
  if (text.length > MAX_TEXT_CHARS) {
    return `File text exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters — please trim your resume`
  }
  return null
}

async function extractText(file: File): Promise<{ text: string; error?: string }> {
  const bytes = file.size
  if (bytes > MAX_FILE_BYTES) {
    return { text: '', error: `File too large (max 5 MB, got ${(bytes / 1024 / 1024).toFixed(1)} MB)` }
  }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const pdfError = validatePdfBytes(buffer)
    if (pdfError) return { text: '', error: pdfError }

    try {
      // Use lib path to avoid pdf-parse v1 test-file access issue in serverless
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
        buf: Buffer,
        opts?: Record<string, unknown>
      ) => Promise<{ text: string }>
      const data = await pdfParse(buffer, { max: 0 })
      return { text: data.text }
    } catch (e) {
      return { text: '', error: `PDF parsing failed: ${e instanceof Error ? e.message : 'unknown error'}` }
    }
  }

  // Plain text / markdown
  const text = await file.text()
  return { text }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let resumeText: string

  try {
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      const { text, error } = await extractText(file)
      if (error) return NextResponse.json({ error }, { status: 400 })
      resumeText = text
    } else {
      const body = await request.json() as { resume_text?: string }
      resumeText = body.resume_text?.trim() ?? ''
    }
  } catch {
    return NextResponse.json({ error: 'Failed to read uploaded file' }, { status: 400 })
  }

  resumeText = resumeText.trim()
  if (!resumeText) {
    return NextResponse.json({ error: 'Resume is empty or could not be read' }, { status: 400 })
  }

  const textError = validateTextContent(resumeText)
  if (textError) return NextResponse.json({ error: textError }, { status: 400 })

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

  function aiErrorMessage(status: number): string {
    if (status === 401) return 'Invalid key — check you copied it correctly'
    if (status === 429) return 'Key is valid but rate limited — try again in a moment'
    return `API error (${status})`
  }

  if (provider === 'anthropic') {
    let res: Response
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
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
    } catch {
      return NextResponse.json({ error: 'Could not reach the API provider' }, { status: 503 })
    }

    if (!res.ok) {
      return NextResponse.json({ error: aiErrorMessage(res.status) }, { status: res.status })
    }

    const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
    rawText = data.content.find((b) => b.type === 'text')?.text ?? ''
  } else {
    let res: Response
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
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
    } catch {
      return NextResponse.json({ error: 'Could not reach the API provider' }, { status: 503 })
    }

    if (!res.ok) {
      return NextResponse.json({ error: aiErrorMessage(res.status) }, { status: res.status })
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
