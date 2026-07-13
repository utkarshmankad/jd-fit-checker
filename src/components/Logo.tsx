interface LogoProps {
  size?: number
  className?: string
}

// Rounded badge + a bold serif "S" monogram — reads as a seal of approval /
// discerning judgment (the "Snob" part), not just a generic checkmark. Single
// navy fill, no gradients/strokes so it stays crisp when shrunk to favicon
// scale.
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
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="19"
        fontWeight="700"
        fill="white"
      >
        S
      </text>
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
      <span className={textClassName}>JobSnob</span>
    </span>
  )
}
