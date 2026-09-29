"use client"

import * as React from "react"

export type Accent = "blue" | "emerald" | "violet" | "orange"
export type Density = "compact" | "cozy" | "comfortable"
export type TextSize = "md" | "lg" | "xl"
interface Prefs { accent: Accent; density: Density; text: TextSize }
const KEY = "dizivat-prefs"
const DEFAULTS: Prefs = { accent: "blue", density: "cozy", text: "md" }

/** Inline, render-blocking script: applies saved prefs before first paint (no flash). */
export const prefsScript = `try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}"),d=document.documentElement;d.dataset.accent=p.accent||"blue";d.dataset.density=p.density||"cozy";d.dataset.text=p.text||"md"}catch(e){}`

const Ctx = React.createContext<Prefs & { set: (p: Partial<Prefs>) => void }>({ ...DEFAULTS, set: () => {} })

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<Prefs>(DEFAULTS)
  React.useEffect(() => {
    try { setPrefs({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }) } catch {}
  }, [])
  const set = React.useCallback((p: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p }
      localStorage.setItem(KEY, JSON.stringify(next))
      const d = document.documentElement
      d.dataset.accent = next.accent; d.dataset.density = next.density; d.dataset.text = next.text
      return next
    })
  }, [])
  return <Ctx.Provider value={{ ...prefs, set }}>{children}</Ctx.Provider>
}
export const usePrefs = () => React.useContext(Ctx)
