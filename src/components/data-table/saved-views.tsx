"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Bookmark, BookmarkPlus, Link2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePathname, useRouter } from "@/i18n/navigation"

interface View { name: string; query: string }

/** Named filter/sort presets per list, stored on the user's server profile (/api/v1/me/views) + share link. */
export function SavedViews({ tableId, builtIn = [] }: { tableId: string; builtIn?: View[] }) {
  const t = useTranslations("table")
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const qk = ["me", "views", tableId]
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const { data: views = [] } = useQuery({ queryKey: qk, queryFn: () => api.me.views(tableId), staleTime: 5 * 60_000 })
  const onErr = (e: Error) => toast.error(e.message)
  const saveM = useMutation({ mutationFn: (v: View) => api.me.saveView(tableId, v), onSuccess: (list) => qc.setQueryData(qk, list), onError: onErr })
  const delM = useMutation({ mutationFn: (v: View) => api.me.deleteView(tableId, v.name).then((list) => ({ list, v })), onError: onErr,
    onSuccess: ({ list, v }) => { qc.setQueryData(qk, list); toast(t("viewDeleted", { name: v.name }), { action: { label: t("undo"), onClick: () => saveM.mutate(v) } }) } })
  // One-time migration of Sprint-1 browser-stored views to the server profile
  React.useEffect(() => {
    const key = `rbs-views-${tableId}`
    try {
      const old: View[] = JSON.parse(localStorage.getItem(key) || "[]")
      localStorage.removeItem(key)
      old.forEach((v) => saveM.mutate(v))
    } catch {}
  }, [tableId]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = () => { const sp = new URLSearchParams(window.location.search); sp.delete("page"); return sp.toString() }
  const apply = (q: string) => router.replace(q ? `${pathname}?${q}` : pathname)
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const n = name.trim()
    saveM.mutate({ name: n, query: current() }, { onSuccess: () => { setOpen(false); setName(""); toast.success(t("viewSaved", { name: n })) } })
  }
  const share = async () => {
    await navigator.clipboard?.writeText(window.location.href).catch(() => {})
    toast.success(t("linkCopied"))
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <Bookmark /> <span className="hidden lg:inline">{t("views")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {builtIn.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("quickViews")}</DropdownMenuLabel>
              {builtIn.map((v) => <DropdownMenuItem key={v.name} onClick={() => apply(v.query)}>{v.name}</DropdownMenuItem>)}
            </DropdownMenuGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("myViews")}</DropdownMenuLabel>
            {views.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noViews")}</div>}
            {views.map((v) => (
              <DropdownMenuItem key={v.name} onClick={() => apply(v.query)} className="group/v">
                <span className="flex-1 truncate">{v.name}</span>
                <button type="button" aria-label={t("deleteView", { name: v.name })} className="rounded p-0.5 opacity-60 hover:bg-background hover:text-destructive hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); delM.mutate(v) }}>
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}><BookmarkPlus /> {t("saveView")}</DropdownMenuItem>
          <DropdownMenuItem onClick={share}><Link2 /> {t("copyLink")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("saveView")}</DialogTitle>
              <DialogDescription>{t("saveViewHint")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="view-name">{t("viewName")}</Label>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={40} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={saveM.isPending}>{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
