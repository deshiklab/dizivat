import { companyInput } from "@/lib/schemas"
import { company } from "@/lib/mock/company"
import { diff, recordAudit } from "@/lib/mock/audit"
import { delay } from "@/lib/mock/query"
import { json, problem, withAuth, zodProblem } from "../_lib"
import { usedBranchIds } from "@/lib/mock/db"

const FIELDS = [
  "name", "vatSlab", "bin", "tin", "mobile", "phone", "email", "address",
  "owner.name", "owner.nid", "owner.mobile", "owner.designation",
  "signatory.name", "signatory.designation", "signatory.mobile", "signatory.email", "signatory.nid",
]

/** Everyone signed in can read the profile (it prints on every Mushak form); only settings.manage can change it. */
export const GET = withAuth(null, async () => {
  await delay(150)
  return json(company)
})

export const PUT = withAuth("settings.manage", async (req, _ctx, user) => {
  const parsed = companyInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  // Branches holding documents / stock keep existing and keep a stock-holding category
  const used = usedBranchIds()
  const removed = company.branches.filter((b) => used.has(b.id) && !parsed.data.branches.some((x) => x.id === b.id))
  if (removed.length) return problem(409, `${removed.map((b) => b.name).join(", ")} has documents and stock history — it cannot be removed.`)
  const toOffice: Record<string, string[]> = {}
  parsed.data.branches.forEach((b, i) => { if (b.id && used.has(b.id) && b.category === "office") toOffice[`branches.${i}.category`] = ["branchInUse"] })
  if (Object.keys(toOffice).length) return problem(422, "Validation failed", toOffice)
  const before = structuredClone(company)
  const branches = parsed.data.branches.map((b, i) => ({ ...b, id: b.id || `b${Date.now().toString(36)}${i}`, code: b.code || undefined }))
  Object.assign(company, parsed.data, { branches, phone: parsed.data.phone || undefined, updatedAt: new Date().toISOString(), updatedBy: user.name })
  const changes = diff(before, company, FIELDS)
  const names = (c: typeof company) => c.branches.map((b) => `${b.name}${b.code ? ` (${b.code})` : ""}`).join("; ")
  if (names(before) !== names(company) || JSON.stringify(before.branches.map((b) => b.address)) !== JSON.stringify(company.branches.map((b) => b.address)))
    changes.push({ field: "branches", from: names(before), to: names(company) })
  if (changes.length) recordAudit({ actor: user, entity: "company", ref: company.name, action: "updated", changes })
  return json(company)
})
