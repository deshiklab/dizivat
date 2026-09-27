import type { AppNotification, AuditEvent, Company, DashboardData, Item, ItemLedger, ItemWithStock, ListParams, Page, Party, PartyRow, Purchase, Sale, SearchHit, TariffLine } from "../types"
import type { CompanyInput, ItemInput, PartyInput, PasswordChange, PurchaseInput, SaleInput, UserInput } from "../schemas"
import type { Me, Preferences, SavedView, User } from "../auth/roles"
import { appPathname, appUrl } from "../base-path"

/**
 * Typed API client. Today it calls the Next.js mock handlers at /api/v1;
 * set NEXT_PUBLIC_API_BASE to the Symfony gateway (e.g. https://vat.pul.com.bd/api/v1) to switch.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1"

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string[]>) { super(message) }
}

export function qs(params: ListParams = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...init?.headers } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // Session expired mid-use → back to sign-in, returning here afterwards
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      const [, locale = "en", ...rest] = appPathname(window.location.pathname).split("/")
      const next = "/" + rest.join("/") + window.location.search
      window.location.assign(appUrl(`/${locale}/login?reason=expired&next=${encodeURIComponent(next)}`))
    }
    throw new ApiError(res.status, body.title ?? res.statusText, body.errors)
  }
  return res.json()
}

export type ListResult<T> = Page<T> & { facetLabels?: Record<string, Record<string, string>> }

type Party$ = "customers" | "vendors"
const parties = (kind: Party$) => ({
  /** Active parties for pickers */
  options: (q = "") => req<Party[]>(`/${kind}${qs({ q })}`),
  list: (p: ListParams) => req<ListResult<PartyRow>>(`/${kind}${qs({ ...p, view: "table" })}`),
  get: (id: string) => req<PartyRow>(`/${kind}/${id}`),
  create: (b: PartyInput) => req<Party>(`/${kind}`, { method: "POST", body: JSON.stringify(b) }),
  update: (id: string, b: PartyInput) => req<Party>(`/${kind}/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  remove: (id: string) => req<{ ok: true }>(`/${kind}/${id}`, { method: "DELETE" }),
  restore: (id: string) => req<Party>(`/${kind}/${id}/restore`, { method: "POST" }),
  csvUrl: (p: ListParams) => `${BASE}/${kind}${qs({ ...p, view: "table", page: undefined, size: undefined, format: "csv" })}`,
})

export type CancelBody = { process: "Cancelled"; reason: string } | { process: "Approved" }

export const api = {
  auth: {
    login: (b: { username: string; password: string; remember?: boolean }) => req<Me>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
    logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  },
  me: {
    get: () => req<Me>("/me"),
    savePrefs: (p: Preferences) => req<Preferences>("/me/preferences", { method: "PUT", body: JSON.stringify(p) }),
    views: (table: string) => req<SavedView[]>(`/me/views${qs({ table })}`),
    saveView: (table: string, v: SavedView) => req<SavedView[]>("/me/views", { method: "POST", body: JSON.stringify({ table, ...v }) }),
    deleteView: (table: string, name: string) => req<SavedView[]>(`/me/views${qs({ table, name })}`, { method: "DELETE" }),
    changePassword: (b: PasswordChange) => req<Me>("/me/password", { method: "PUT", body: JSON.stringify(b) }),
  },
  users: {
    list: (p: ListParams) => req<ListResult<User>>(`/users${qs(p)}`),
    get: (id: string) => req<User>(`/users/${id}`),
    invite: (b: UserInput) => req<{ user: User; tempPassword: string }>("/users", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: Omit<UserInput, "username">) => req<User>(`/users/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    resetPassword: (id: string) => req<{ tempPassword: string }>(`/users/${id}/reset-password`, { method: "POST" }),
    csvUrl: (p: ListParams) => `${BASE}/users${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  company: {
    get: () => req<Company>("/company"),
    update: (b: CompanyInput) => req<Company>("/company", { method: "PUT", body: JSON.stringify(b) }),
  },
  tariff: {
    list: (p: ListParams) => req<ListResult<TariffLine> & { fy: string }>(`/tariff${qs({ ...p, view: "table" })}`),
    lookup: (hs: string) => req<TariffLine>(`/tariff${qs({ hs })}`),
    csvUrl: (p: ListParams) => `${BASE}/tariff${qs({ ...p, view: "table", page: undefined, size: undefined, format: "csv" })}`,
  },
  audit: {
    list: (p: ListParams) => req<ListResult<AuditEvent>>(`/audit${qs(p)}`),
    csvUrl: (p: ListParams) => `${BASE}/audit${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  notifications: {
    list: () => req<{ items: AppNotification[]; unread: number }>("/notifications"),
    read: (b: { ids: string[] } | { all: true }) => req<{ items: AppNotification[]; unread: number }>("/notifications/read", { method: "POST", body: JSON.stringify(b) }),
  },
  dashboard: () => req<DashboardData>("/dashboard"),
  search: (q: string) => req<SearchHit[]>(`/search${qs({ q })}`),
  sales: {
    list: (p: ListParams) => req<ListResult<Sale>>(`/sales${qs(p)}`),
    get: (id: string) => req<Sale>(`/sales/${id}`),
    create: (b: SaleInput) => req<Sale>("/sales", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: SaleInput) => req<Sale>(`/sales/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<Sale>(`/sales/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/sales/${id}`, { method: "DELETE" }),
    restore: (id: string) => req<Sale>(`/sales/${id}/restore`, { method: "POST" }),
    bulkApprove: (ids: string[]) => req<{ done: string[]; skipped: string[] }>("/sales/bulk", { method: "POST", body: JSON.stringify({ ids, action: "approve" }) }),
    csvUrl: (p: ListParams) => `${BASE}/sales${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  purchases: {
    list: (p: ListParams) => req<ListResult<Purchase>>(`/purchases${qs(p)}`),
    get: (id: string) => req<Purchase>(`/purchases/${id}`),
    create: (b: PurchaseInput) => req<Purchase>("/purchases", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: PurchaseInput) => req<Purchase>(`/purchases/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<Purchase>(`/purchases/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/purchases/${id}`, { method: "DELETE" }),
    restore: (id: string) => req<Purchase>(`/purchases/${id}/restore`, { method: "POST" }),
    bulkApprove: (ids: string[]) => req<{ done: string[]; skipped: string[] }>("/purchases/bulk", { method: "POST", body: JSON.stringify({ ids, action: "approve" }) }),
    csvUrl: (p: ListParams) => `${BASE}/purchases${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  items: {
    list: (p: ListParams) => req<ListResult<ItemWithStock>>(`/items${qs(p)}`),
    create: (b: ItemInput) => req<ItemWithStock>("/items", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: ItemInput) => req<ItemWithStock>(`/items/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    get: (id: string) => req<ItemWithStock>(`/items/${id}`),
    ledger: (id: string) => req<ItemLedger>(`/items/${id}/ledger`),
    csvUrl: (p: ListParams) => `${BASE}/items${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  customers: parties("customers"),
  vendors: parties("vendors"),
}

export type { Item }
