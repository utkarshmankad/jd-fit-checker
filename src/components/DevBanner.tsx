'use client'

export function DevBanner() {
  // NEXT_PUBLIC_ vars are inlined at build time — available identically on
  // server and client, no need for state/effect to read them.
  if (process.env.NEXT_PUBLIC_SHOW_DEV_BANNER !== 'true') return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: '#7C3AED',
        color: 'white',
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: '11px',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        letterSpacing: '0.05em',
      }}
    >
      ⚠️ DEV / PREPROD — jobsnob — Not production —{' '}
      <span style={{ opacity: 0.65 }}>
        {process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '').slice(0, 24)}
        ...
      </span>
    </div>
  )
}
