import { SearchX } from "lucide-react"

export function EmptyState({ title, hint, action, icon: Icon = SearchX }: { title: string; hint?: string; action?: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted"><Icon className="size-6 text-muted-foreground" aria-hidden /></span>
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
