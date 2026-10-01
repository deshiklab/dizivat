"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs"
import { Download, KeyRound, MoreHorizontal, Pencil, Power, PowerOff, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Pill } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { RequirePerm, useMe } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { accessExpired, ROLES, type User } from "@/lib/auth/roles"
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format"
import { UserSheet } from "./user-sheet"
import { TempPasswordDialog } from "./temp-password-dialog"
import { RolesMatrix } from "./roles-matrix"

const FACETS = ["role", "status"] as const
const roleTone = { admin: "danger", approver: "info", operator: "neutral", viewer: "warning", vatOfficer: "success" } as const

export function UsersPage() {
  return <RequirePerm perm="users.manage" back="/"><UsersInner /></RequirePerm>
}

/** Users & roles (legacy Master Data › User). Admin only: invite, edit, reset password, (de)activate. */
function UsersInner() {
  const t = useTranslations("users")
  const tr = useTranslations("roles")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const me = useMe()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(["users", "roles"] as const).withDefault("users"))
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const [temp, setTemp] = React.useState<{ username: string; password: string } | null>(null)
  const q = useQuery({ queryKey: ["users", params], queryFn: () => api.users.list(params), placeholderData: keepPreviousData })
  // Role counts for the matrix header (all users, independent of the list filters)
  const all = useQuery({ queryKey: ["users", "all"], queryFn: () => api.users.list({ size: 500 }), enabled: tab === "roles" })
  const onPage = editId ? q.data?.data.find((u) => u.id === editId) : undefined
  const single = useQuery({ queryKey: ["user", editId], queryFn: () => api.users.get(editId!), enabled: !!editId && !!q.data && !onPage })
  const editing = editId ? onPage ?? single.data ?? null : null

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] })
  const toggle = useMutation({
    mutationFn: (u: User) => api.users.update(u.id, {
      name: u.name, designation: u.designation, email: u.email, mobile: u.mobile ?? "", department: u.department ?? "", role: u.role, active: !u.active,
    }),
    onSuccess: (u) => { refresh(); toast.success(u.active ? t("activated", { name: u.name }) : t("deactivated", { name: u.name })) },
    onError: (e) => toast.error(e instanceof ApiError && e.errors ? t(`error.${Object.values(e.errors)[0]![0]}`) : e.message),
  })
  const reset = useMutation({
    mutationFn: (u: User) => api.users.resetPassword(u.id).then((r) => ({ ...r, username: u.username })),
    onSuccess: (r) => { refresh(); setTemp({ username: r.username, password: r.tempPassword }) },
    onError: (e) => toast.error(e.message),
  })
  const askToggle = async (u: User) => {
    if (u.active && !(await confirm({ title: t("deactivateTitle", { name: u.name }), description: t("deactivateBody"), confirm: t("deactivate"), cancel: tc("keep"), destructive: true }))) return
    toggle.mutate(u)
  }
  const askReset = async (u: User) => {
    if (await confirm({ title: t("resetTitle", { name: u.name }), description: t("resetBody"), confirm: t("resetConfirm"), cancel: tc("cancel") })) reset.mutate(u)
  }

  const columns = React.useMemo<ColumnDef<User, unknown>[]>(() => [
    {
      id: "name", accessorKey: "name", meta: { label: t("col.name"), hideable: false }, header: t("col.name"),
      cell: ({ row }) => {
        const u = row.original
        return (
          <div className="flex min-w-48 items-center gap-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{u.initials}</span>
            <div className="grid min-w-0">
              <button type="button" className="truncate text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setEditId(u.id) }}>
                {u.name}{u.id === me.user.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t("you")}</span>}
              </button>
              <span className="truncate text-xs text-muted-foreground">@{u.username} · {u.designation}</span>
            </div>
          </div>
        )
      },
    },
    { id: "role", accessorKey: "role", meta: { label: t("col.role") }, header: t("col.role"), cell: ({ row }) => <><Pill tone={roleTone[row.original.role]}>{tr(row.original.role)}</Pill><AccessNote u={row.original} /></> },
    { id: "department", accessorKey: "department", meta: { label: t("col.department"), className: "min-w-28 max-w-36 whitespace-normal" /* wraps so the table fits 1440 px */ }, header: t("col.department"), cell: ({ row }) => row.original.department || "—" },
    { id: "email", accessorKey: "email", meta: { label: t("col.email") }, header: t("col.email"), cell: ({ row }) => <a href={`mailto:${row.original.email}`} onClick={(e) => e.stopPropagation()} className="block max-w-56 truncate hover:underline" title={row.original.email}>{row.original.email}</a> },
    { id: "mobile", accessorKey: "mobile", meta: { label: t("col.mobile") }, header: t("col.mobile"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{row.original.mobile || "—"}</span> },
    { id: "lastSignInAt", accessorKey: "lastSignInAt", meta: { label: t("col.lastSignIn") }, header: t("col.lastSignIn"), cell: ({ row }) => <span className="whitespace-nowrap">{row.original.lastSignInAt ? fmtDateTime(row.original.lastSignInAt, locale) : <span className="text-muted-foreground">{t("never")}</span>}</span> },
    {
      id: "status", accessorKey: "active", meta: { label: t("col.status") }, header: t("col.status"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.active ? <Pill tone="success">{t("active")}</Pill> : <Pill>{t("inactive")}</Pill>}
          {row.original.mustChangePassword && <Pill tone="warning" icon={KeyRound}>{t("pwPending")}</Pill>}
        </div>
      ),
    },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => {
        const u = row.original
        const self = u.id === me.user.id
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tc("actionsFor", { name: u.name })} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setEditId(u.id)}><Pencil /> {tc("edit")}</DropdownMenuItem>
              {!self && (
                <>
                  <DropdownMenuItem onClick={() => askReset(u)}><KeyRound /> {t("resetPassword")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant={u.active ? "destructive" : "default"} onClick={() => askToggle(u)}>
                    {u.active ? <><PowerOff /> {t("deactivate")}</> : <><Power /> {t("activate")}</>}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, tr, tc, me.user.id])

  const facetOpts = {
    role: ROLES.map((r) => ({ value: r, label: tr(r) })),
    status: ["active", "inactive"].map((v) => ({ value: v, label: t(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const active = q.data?.facets.status?.active ?? 0
  const roleCounts = React.useMemo(() => {
    const c: Record<string, number> = {}
    for (const u of all.data?.data ?? []) if (u.active) c[u.role] = (c[u.role] ?? 0) + 1
    return c
  }, [all.data])

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), active: fmtNum(active, locale) }) : t("subtitle")}
        actions={<Button onClick={() => setNew(true)}><UserPlus /> {t("new")}</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "users" | "roles")}>
        <TabsList className="mb-4">
          <TabsTrigger value="users">{t("tabUsers")}</TabsTrigger>
          <TabsTrigger value="roles">{t("tabRoles")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <DataTable<User>
            tableId="users" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
            loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
            page={state.page} size={state.size} sort={state.sort}
            onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
            getRowId={(r) => r.id} onRowClick={(r) => setEditId(r.id)} filtered={activeCount > 0}
            defaultHidden={["mobile"]}
            filters={
              <>
                <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
                <FacetFilter title={t("facet.role")} options={facetOpts.role} selected={state.role} onChange={(v) => set({ role: v })} counts={q.data?.facets.role} />
                <FacetFilter title={t("facet.status")} options={facetOpts.status} selected={state.status} onChange={(v) => set({ status: v })} counts={q.data?.facets.status} />
              </>
            }
            chips={<FilterChips chips={chips} onClearAll={clearAll} />}
            toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.users.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
            mobileCard={(u) => (
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{u.name}</span><span className="text-right"><Pill tone={roleTone[u.role]}>{tr(u.role)}</Pill><AccessNote u={u} /></span></div>
                <p className="truncate text-sm text-muted-foreground">@{u.username} · {u.designation}</p>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{u.lastSignInAt ? fmtDateTime(u.lastSignInAt, locale) : t("never")}</span>
                  {u.active ? <Pill tone="success">{t("active")}</Pill> : <Pill>{t("inactive")}</Pill>}
                </div>
              </div>
            )}
            emptyAction={activeCount > 0 ? <Button variant="outline" size="sm" onClick={clearAll}>{tt("clearAll")}</Button> : undefined}
          />
        </TabsContent>
        <TabsContent value="roles"><RolesMatrix counts={all.data ? roleCounts : undefined} /></TabsContent>
      </Tabs>
      <UserSheet open={isNew || !!editing} user={editing}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }}
        onInvited={(username, password) => setTemp({ username, password })} />
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
    </>
  )
}

/** R6.2: a VAT officer's access period — "until …" or "expired". */
function AccessNote({ u }: { u: User }) {
  const t = useTranslations("users")
  const locale = useLocale()
  if (u.role !== "vatOfficer") return null
  const expired = accessExpired(u)
  return <span className={expired ? "block text-xs font-medium text-destructive" : "block text-xs text-muted-foreground"}>{expired ? t("accessExpired") : t("accessUntil", { date: u.accessUntil ? fmtDate(u.accessUntil, locale) : "—" })}</span>
}
