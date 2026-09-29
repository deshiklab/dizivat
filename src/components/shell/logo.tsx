/** DiziVAT mark: a "D" with a tick-dot — the product initial on the brand colour. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M8.5 8.5h6.6c4.7 0 8 3.1 8 7.5s-3.3 7.5-8 7.5H8.5v-15Zm3.1 2.9v9.2h3.4c2.9 0 4.9-1.9 4.9-4.6s-2-4.6-4.9-4.6h-3.4Z" fill="var(--primary-foreground)" />
      <circle cx="25.5" cy="23" r="2" fill="var(--primary-foreground)" />
    </svg>
  )
}
