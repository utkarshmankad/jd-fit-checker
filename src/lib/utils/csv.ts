// Neutralizes formula-injection ("CSV injection") payloads before a field
// is written into a CSV a user might open in Excel/Sheets. A string
// starting with =, +, -, @, tab, or CR is interpreted as a formula by
// those apps regardless of how the CSV itself quotes the field — the
// field's own quoting only protects CSV structure, not this. Prefixing
// with a single quote forces it to be read as literal text.
//
// Fields here are attacker-influenced: job_title/company can come from a
// scraped third-party job posting's own <title>, not just the user's own
// input, so any user pasting a malicious URL can end up with a poisoned
// export even though they never typed the payload themselves.
export function sanitizeCsvField(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
