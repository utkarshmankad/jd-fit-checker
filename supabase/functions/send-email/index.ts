import { Webhook } from 'npm:standardwebhooks@1'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'JobSnob <noreply@jobsnob.fyi>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://jobsnob.fyi'
// The secret shown in Supabase Dashboard -> Authentication -> Hooks when
// creating the "Send Email" hook comes formatted as "v1,whsec_XXXX" — the
// "v1," is Supabase's own versioning prefix, not part of the secret the
// standardwebhooks library expects. Passing the full string through made
// its base64 decoder throw on every request (500 on every signup/magic-
// link/recovery email). Strip down to just the whsec_ part.
// This function is deployed with --no-verify-jwt, since Auth Hook calls
// carry a signed webhook payload, not a user JWT — this signature check is
// what actually gates the endpoint instead, so it isn't open to anyone who
// finds the URL.
const RAW_HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET')!
const HOOK_SECRET = RAW_HOOK_SECRET.startsWith('v1,') ? RAW_HOOK_SECRET.slice(3) : RAW_HOOK_SECRET
const wh = new Webhook(HOOK_SECRET)

interface AuthHookPayload {
  user: {
    id: string
    email: string
    user_metadata?: Record<string, unknown>
  }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type:
      | 'signup'
      | 'magiclink'
      | 'recovery'
      | 'invite'
      | 'email_change_new'
      | 'email_change_current'
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

function buildConfirmUrl(payload: AuthHookPayload): string {
  const { token_hash, email_action_type, redirect_to } = payload.email_data
  const base = `${SITE_URL}/auth/confirm`
  const params = new URLSearchParams({
    token_hash,
    type: email_action_type,
    next: redirect_to || '/dashboard',
  })
  return `${base}?${params}`
}

function emailTemplate(title: string, heading: string, body: string, ctaUrl: string, ctaLabel: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <tr>
          <td style="background:#1B3A5C;padding:24px 32px">
            <p style="margin:0;color:#fff;font-size:18px;font-weight:700">JobSnob</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <h1 style="margin:0 0 12px;font-size:22px;color:#111">${heading}</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6">${body}</p>
            <a href="${ctaUrl}"
               style="display:inline-block;background:#1B3A5C;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600">
              ${ctaLabel}
            </a>
            <p style="margin:24px 0 0;font-size:12px;color:#aaa">
              Button not working? Copy this link:<br>
              <a href="${ctaUrl}" style="color:#1B3A5C;word-break:break-all">${ctaUrl}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0">
            <p style="margin:0;font-size:12px;color:#bbb">
              If you didn't request this email, you can safely ignore it.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildEmail(payload: AuthHookPayload): { subject: string; html: string } {
  const confirmUrl = buildConfirmUrl(payload)
  const type = payload.email_data.email_action_type

  switch (type) {
    case 'signup':
      return {
        subject: 'Confirm your JobSnob account',
        html: emailTemplate(
          'Confirm your account',
          'Confirm your email',
          'Click the button below to verify your email address and activate your account.',
          confirmUrl,
          'Confirm email'
        ),
      }
    case 'magiclink':
      return {
        subject: 'Your sign-in link for JobSnob',
        html: emailTemplate(
          'Sign in link',
          'Sign in to JobSnob',
          'Click the button below to sign in. This link expires in 1 hour and can only be used once.',
          confirmUrl,
          'Sign in'
        ),
      }
    case 'invite':
      return {
        subject: "You've been invited to JobSnob",
        html: emailTemplate(
          'Invitation',
          "You've been invited",
          'Click below to accept your invitation and set up your account.',
          confirmUrl,
          'Accept invitation'
        ),
      }
    case 'recovery':
      return {
        subject: 'Reset your JobSnob password',
        html: emailTemplate(
          'Reset password',
          'Reset your password',
          'Click the button below to choose a new password. This link expires in 1 hour.',
          confirmUrl,
          'Reset password'
        ),
      }
    case 'email_change_new':
    case 'email_change_current':
      return {
        subject: 'Confirm your new email for JobSnob',
        html: emailTemplate(
          'Confirm email change',
          'Confirm your new email',
          'Click below to confirm your email address change.',
          confirmUrl,
          'Confirm email change'
        ),
      }
    default:
      return {
        subject: 'Action required for JobSnob',
        html: emailTemplate(
          'Action required',
          'Action required',
          'Click the button below to continue.',
          confirmUrl,
          'Continue'
        ),
      }
  }
}

Deno.serve(async (req) => {
  const rawBody = await req.text()

  let payload: AuthHookPayload
  try {
    // Verifies webhook-id/webhook-timestamp/webhook-signature headers against
    // HOOK_SECRET (HMAC over the exact raw body) — this is the real auth
    // check for this endpoint. Throws on missing/invalid/expired signature.
    payload = wh.verify(rawBody, Object.fromEntries(req.headers)) as AuthHookPayload
  } catch (e) {
    console.error('Webhook signature verification failed:', e)
    return new Response('Unauthorized', { status: 401 })
  }

  const { subject, html } = buildEmail(payload)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [payload.user.email],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
