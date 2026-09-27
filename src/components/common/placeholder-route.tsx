import { notFound } from "next/navigation"
import { NAV } from "@/lib/nav"
import { ComingSoon } from "./coming-soon"

/** Renders the roadmap page for a not-yet-built nav route, or 404 if the path is unknown. */
export function PlaceholderRoute({ path }: { path: string }) {
  for (const g of NAV) for (const it of g.items) if (it.href === path && !it.ready) return <ComingSoon path={path} />
  notFound()
}
export const isPlaceholder = (path: string) => NAV.some((g) => g.items.some((i) => i.href === path && !i.ready))
