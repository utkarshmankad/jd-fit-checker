import { createHmac } from 'node:crypto'

// The admin_session cookie holds this HMAC, never ADMIN_SECRET itself — a
// cookie leak (XSS, log capture, browser sync) shouldn't hand over the
// actual login password.
export function sessionToken(secret: string): string {
  return createHmac('sha256', secret).update('admin-session').digest('hex')
}
