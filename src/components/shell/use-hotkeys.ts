"use client"
import * as React from "react"
import { useRouter, usePathname } from "@/i18n/navigation"
import { resolveNav } from "@/lib/nav"
import { useShell } from "./shell-context"
import { useCreateActions } from "./create-actions"

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox")
}

/**
 * One global key handler (the prototype bound ⌘K and "/" to two overlapping overlays).
 * ⌘K / Ctrl+K / "/"  → command palette · "?" → shortcut help · g+d/s/p/i → go to · n → new record in current module
 */
export function useGlobalHotkeys() {
  const router = useRouter()
  const creates = useCreateActions()
  const pathname = usePathname()
  const { setPaletteOpen, setHelpOpen } = useShell()
  const pending = React.useRef<number | null>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog]")) return
      if (pending.current) {
        const map: Record<string, string> = { d: "/", s: "/sales", p: "/purchases", i: "/inventory/items" }
        window.clearTimeout(pending.current); pending.current = null
        if (map[e.key]) { e.preventDefault(); router.push(map[e.key]) }
        return
      }
      if (e.key === "g") { pending.current = window.setTimeout(() => (pending.current = null), 1200); return }
      if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); return }
      if (e.key === "?") { e.preventDefault(); setHelpOpen(true); return }
      if (e.key === "n") {
        const nav = resolveNav(pathname)
        const g = nav?.group.key
        // In Master data the target depends on the page (customers vs vendors)
        const target = creates.find((c) => c.group === g && (g !== "masterData" || c.href.startsWith(nav?.item?.href ?? "")))?.href
        if (target) { e.preventDefault(); router.push(target) }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [router, pathname, setPaletteOpen, setHelpOpen, creates])
}
