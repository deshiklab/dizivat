import { companyInput } from "@/lib/schemas"
import { company } from "@/lib/mock/company"
import { diff, recordAudit } from "@/lib/mock/audit"
import { delay } from "@/lib/mock/query"
import { json, withAuth, zodProblem } from "../_lib"

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
