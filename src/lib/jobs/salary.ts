import type { SalaryRange } from '@/types'

const RANGE = /(?:salary|compensation|pay|base pay|base salary|ctc)?\s*[:\-]?\s*(?:(USD|INR|GBP|EUR|CAD|AUD)\s*)?([$£€₹])?\s*(\d[\d,.]*)(\s*(?:k|m|lakh|lakhs|lac|lacs|crore|crores))?\s*(?:-|–|—|to)\s*(?:(USD|INR|GBP|EUR|CAD|AUD)\s*)?([$£€₹])?\s*(\d[\d,.]*)(\s*(?:k|m|lakh|lakhs|lac|lacs|crore|crores))?\s*(?:per\s*)?(year|annum|annual|month|hour|hr|day)?/gi

const CURRENCIES: Record<string, string> = { '$': 'USD', '₹': 'INR', '£': 'GBP', '€': 'EUR' }

export function extractSalaryRange(text: string): SalaryRange | null {
  for (const match of text.matchAll(RANGE)) {
    const nearby = text.slice(Math.max(0, match.index! - 45), Math.min(text.length, match.index! + match[0].length + 45)).toLowerCase()
    if (!/(salary|compensation|pay|ctc|package|range|base|annual|annum|per year|per month|per hour|\/yr|\/hr|lakh|lac|crore|[$£€₹])/.test(nearby)) continue
    const currency = (match[1] || match[5] || CURRENCIES[match[2]] || CURRENCIES[match[6]] || '').toUpperCase() || null
    const periodRaw = (match[9] || '').toLowerCase()
    const period: SalaryRange['period'] = /hour|hr/.test(periodRaw) ? 'hour' : /month/.test(periodRaw) ? 'month' : /day/.test(periodRaw) ? 'day' : 'year'
    return { raw: match[0].trim(), currency, minimum: match[3].replace(/,/g, ''), maximum: match[7].replace(/,/g, ''), period }
  }
  return null
}
