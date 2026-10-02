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
  const line = (itemId: string, qty: number, value: number) => {
    const it = items.find((i) => i.id === itemId)!
    return { itemId, name: it.name, hsCode: it.hsCode, uom: it.unit, qty, value }
  }
  const base = { customerId: c.id, customerName: c.name, customerBin: c.bin, createdBy: "Farzana Akter" }
  const mk = (id: string, no: string, date: string, expiry: string, lc: string, buyer: string, lines: UdRecord["lines"], status: UdRecord["status"], note?: string, masterLcValue?: number): UdRecord => ({
    id, no, kind: "UD", date, expiry, masterLcNo: lc, buyer, lines, status, note, masterLcValue, currency: "USD", ...base,
    createdAt: at(addDays(date, 2), "11:20"), history: [{ at: at(addDays(date, 2), "11:20"), by: "Farzana Akter", action: "created" }],
  })
  const uds = [
    mk("ud1", "BKMEA/UD/2025/11871", "2025-11-04", "2026-06-30", "EXP-LC-25-1187", "NORDLINE RETAIL AB", [line("i21", 8000, 34_400)], "active", "Spring 2026 order — shipped; UD lapsed unused.", 412_000),
    mk("ud2", "BKMEA/UD/2026/08812", "2026-08-16", "2027-02-28", "EXP-LC-26-0881", "HARBOUR & PINE INC", [line("i21", 6000, 25_800), line("i20", 250, 1_250)], "active", "Autumn 2026 knitwear order — single jersey body fabric and rib collars.", 268_500),
    mk("ud3", "BKMEA/UD/2026/09120", "2026-09-15", "2027-03-31", "EXP-LC-26-0912", "NORDLINE RETAIL AB", [line("i21", 10000, 43_000), line("i20", 400, 2_000)], "active", undefined, 455_000),
  ]
  // R6.3: amendment history (BKMEA amendment certificates)
  const amend = (u: UdRecord, date: string, reason: string, lines: NonNullable<UdRecord["amendments"]>[number]["lines"], lc?: [number, number]) => {
    const when = at(date, "15:30")
    ;(u.amendments ??= []).push({ no: u.amendments.length + 1, date, reason, by: "Farzana Akter", at: when, lines, ...(lc ? { masterLcValueFrom: lc[0], masterLcValueTo: lc[1] } : {}) })
    u.history!.push({ at: when, by: "Farzana Akter", action: "edited", note: `Amendment ${u.amendments.length} — ${reason}` })
    u.updatedAt = when
  }
  amend(uds[0], "2026-01-20", "Buyer reduced the spring order from 46,000 to 37,000 pcs — fabric requirement revised.", [{ itemId: "i21", name: uds[0].lines[0].name, uom: "Kg", qtyFrom: 10_000, qtyTo: 8_000, valueFrom: 43_000, valueTo: 34_400 }], [515_000, 412_000])
  amend(uds[1], "2026-09-05", "Buyer added 4,000 pcs to the autumn order (LC amendment no. 1) — body fabric increased.", [{ itemId: "i21", name: uds[1].lines[0].name, uom: "Kg", qtyFrom: 5_000, qtyTo: 6_000, valueFrom: 21_500, valueTo: 25_800 }], [224_000, 268_500])
  return uds
}

/**
 * Export proceeds: older direct exports are realised in full (PRC 45–90 days after shipment). Of the latest four:
 * the 4th-latest is part-paid and the 3rd-latest unrealised — both past the 120-day limit, so the register flags them
 * overdue; the 2nd-latest is part-paid and the latest unrealised, both still inside the window.
 */
export function seedRealisations(sales: Sale[]) {
  const banks = ["Eastern Bank PLC, Gulshan", "Dutch-Bangla Bank PLC, Motijheel", "The City Bank PLC, Principal Office"]
  const direct = sales.filter((s) => s.export && !s.export.deemed && s.process !== "Cancelled" && s.export.fcValue).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  direct.forEach((s, i) => {
    const e = s.export!
    const ship = e.billDate || s.issueDate
    const fromEnd = direct.length - 1 - i
    if (fromEnd === 0 || fromEnd === 2) return // unrealised: latest (in window) and 3rd-latest (overdue)
    const second = fromEnd === 1 || fromEnd === 3
    const part = fromEnd === 1 ? 0.7 : fromEnd === 3 ? 0.6 : 1
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
