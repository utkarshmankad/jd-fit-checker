interface LogoProps {
  size?: number
  className?: string
}

// Rounded badge + checkmark — reads as "screened / verified fit" at any
// size, down to favicon scale. Single navy fill, no gradients/strokes so it
// stays crisp when shrunk.
export function LogoMark({ size = 28, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#1B3A5C" />
      <path
        d="M9.5 16.5L14 21L23 11"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface WordmarkProps {
  markSize?: number
  textClassName?: string
  className?: string
}

export default function Logo({ markSize = 24, textClassName = 'font-bold text-lg text-gray-900 dark:text-gray-100', className = '' }: WordmarkProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={markSize} />
      <span className={textClassName}>JD Fit Checker</span>
    </span>
  )
}
