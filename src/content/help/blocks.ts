import type { Block } from "./types"

/** Terse constructors so article files read like prose. */
export const h = (text: string): Block => ({ t: "h", text })
export const p = (text: string): Block => ({ t: "p", text })
export const steps = (...items: string[]): Block => ({ t: "steps", items })
export const list = (...items: string[]): Block => ({ t: "list", items })
export const tip = (text: string): Block => ({ t: "tip", text })
export const note = (text: string): Block => ({ t: "note", text })
export const warn = (text: string): Block => ({ t: "warning", text })
export const table = (head: string[], ...rows: string[][]): Block => ({ t: "table", head, rows })
export const dl = (...items: [string, string][]): Block => ({ t: "dl", items })
export const img = (src: string, alt: string, caption?: string): Block => ({ t: "img", src, alt, caption })
