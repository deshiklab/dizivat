/**
 * R6.2 demo data — RMG: the bonded exporter's UD register and export proceeds (PRC). All numbers are fictitious.
 */
import type { Item, Party, Realisation, Sale, UdRecord } from "../types"

const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+06:00`).toISOString()
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)

/**
 * AURORA KNIT (c10) — three UDs: the current one (83 % of its i21 quantity already supplied, so the register warns),
 * a fresh one for the next order, and last year's, now expired.
 */
export function seedUds(customers: Party[], items: Item[]): UdRecord[] {
  const c = customers.find((x) => x.id === "c10")
  if (!c) return []
  const line = (itemId: string, qty: number) => {
    const it = items.find((i) => i.id === itemId)!
    return { itemId, name: it.name, hsCode: it.hsCode, uom: it.unit, qty }
  }
  const base = { customerId: c.id, customerName: c.name, customerBin: c.bin, createdBy: "Farzana Akter" }
  const mk = (id: string, no: string, date: string, expiry: string, lc: string, buyer: string, lines: UdRecord["lines"], status: UdRecord["status"], note?: string): UdRecord => ({
    id, no, kind: "UD", date, expiry, masterLcNo: lc, buyer, lines, status, note, ...base,
    createdAt: at(addDays(date, 2), "11:20"), history: [{ at: at(addDays(date, 2), "11:20"), by: "Farzana Akter", action: "created" }],
  })
  return [
    mk("ud1", "BKMEA/UD/2025/11871", "2025-11-04", "2026-06-30", "EXP-LC-25-1187", "NORDLINE RETAIL AB", [line("i21", 80000)], "active", "Spring 2026 order — shipped; UD lapsed unused."),
    mk("ud2", "BKMEA/UD/2026/08812", "2026-08-16", "2027-02-28", "EXP-LC-26-0881", "HARBOUR & PINE INC", [line("i21", 60000), line("i20", 250)], "active", "Autumn 2026 knitwear order — blister packs and laminate for retail packaging."),
    mk("ud3", "BKMEA/UD/2026/09120", "2026-09-15", "2027-03-31", "EXP-LC-26-0912", "NORDLINE RETAIL AB", [line("i21", 100000), line("i20", 400)], "active"),
  ]
}

/**
 * Export proceeds: older direct exports are realised in full (PRC 45–90 days after shipment); the second-latest is
 * part-paid and the latest is unrealised — both past the 120-day limit, so the register flags them.
 */
export function seedRealisations(sales: Sale[]) {
  const banks = ["Eastern Bank PLC, Gulshan", "Dutch-Bangla Bank PLC, Motijheel", "The City Bank PLC, Principal Office"]
  const direct = sales.filter((s) => s.export && !s.export.deemed && s.process !== "Cancelled" && s.export.fcValue).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  direct.forEach((s, i) => {
    const e = s.export!
    const ship = e.billDate || s.issueDate
    const last = i === direct.length - 1, second = i === direct.length - 2
    if (last) return
    const part = second ? 0.7 : 1
    const date = addDays(ship, 45 + ((i * 17) % 46))
    const fc = Math.round(e.fcValue! * part * 100) / 100
    const rate = Math.round((e.exchangeRate! + ((i % 3) - 1) * 0.35) * 100) / 100
    const r: Realisation = {
      id: `prc-${s.id}-1`, date, bank: banks[i % banks.length], prcNo: `PRC/${date.slice(2, 4)}/${String(40211 + i * 7).padStart(6, "0")}`,
      fcAmount: fc, rate, bdt: Math.round(fc * rate * 100) / 100, by: "Farzana Akter", at: at(date, "14:30"),
      note: second ? "Buyer short-paid; balance under claim." : undefined,
    }
    e.realisations = [r]
  })
}
