export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9 23V9h7.2c3 0 5 1.8 5 4.4 0 2-1.1 3.4-2.9 4l3.4 5.6h-3.5l-3-5.1H12V23H9Zm3-7.7h4c1.3 0 2.1-.8 2.1-1.9s-.8-1.9-2.1-1.9h-4v3.8Z" fill="var(--primary-foreground)" />
      <circle cx="24" cy="23" r="2" fill="var(--primary-foreground)" />
    </svg>
  )
}
