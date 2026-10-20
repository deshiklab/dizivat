"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CircleAlert, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api/client"
import { mapTariffRows, readSheet } from "@/lib/sheet"
import type { TariffImportResult } from "@/lib/types"

interface Loaded { source: string; rows: Record<string, unknown>[]; unknown: string[]; missing: string[]; columns: string[] }

/**
 * R7.1 — import the official NBR tariff for a fiscal year (CSV or .xlsx, read in the browser). The server
 * validates every row and previews the diff (dry run); applying replaces that year's rows and makes it the
 * year the app looks at. `master.edit`.
 */
export function TariffImportDialog({ open, onOpenChange, currentFy }: { open: boolean; onOpenChange: (v: boolean) => void; currentFy?: string }) {
  const t = useTranslations("tariff")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const [fy, setFy] = React.useState("")
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [readError, setReadError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<TariffImportResult | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { if (open && !fy) setFy(nextFy(currentFy)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setLoaded(null); setResult(null); setReadError(null); if (fileRef.current) fileRef.current.value = "" }
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset() }

  const onFile = async (f: File | undefined) => {
    setResult(null); setReadError(null)
    if (!f) return
    try {
      const m = mapTariffRows(await readSheet(f))
      if (!m.rows.length) { setLoaded(null); setReadError(t("imp.noRows")); return }
      setLoaded({ source: f.name, ...m })
    } catch {
      setLoaded(null); setReadError(t("imp.readFailed"))
    }
  }

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.tariff.import({ fiscalYear: fy, rows: loaded!.rows, dryRun }),
    onSuccess: (r) => {
      setResult(r)
      if (!r.dryRun && r.applied) {
        qc.invalidateQueries({ queryKey: ["tariff"] })
        toast.success(t("imp.applied", { n: r.applied, fy: r.activeFy }))
        close(false)
      }
    },
    onError: (e) => { if (e instanceof ApiError && e.status !== 422) toast.error(e.message) },
  })

  const issues = result?.issues ?? []
  const s = result?.summary

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="size-4" aria-hidden /> {t("imp.title")}</DialogTitle>
          <DialogDescription>{t("imp.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tariff-fy">{t("imp.fy")}</Label>
            <Input id="tariff-fy" value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2026-27" className="w-36" aria-invalid={!!fy && !/^\d{4}-\d{2}$/.test(fy)} />
            <p className="text-xs text-muted-foreground">{t("imp.fyHelp")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tariff-file">{t("imp.file")}</Label>
            <input ref={fileRef} id="tariff-file" type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="justify-start">
              <FileUp aria-hidden /> {loaded ? loaded.source : t("imp.choose")}
            </Button>
            <a href={api.tariff.sampleUrl()} download className="text-xs underline-offset-2 hover:underline">{t("imp.template")}</a>
          </div>
          {readError && <p className="flex items-start gap-2 text-sm text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {readError}</p>}
          {loaded && (
            <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm">
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0" aria-hidden />
              {loaded.missing.length
                ? t("imp.missing", { fields: loaded.missing.join(", ") })
                : t("imp.loaded", { n: loaded.rows.length, columns: loaded.columns.length })
                  + (loaded.unknown.length ? " " + t("imp.unknown", { n: loaded.unknown.length }) : "")}
            </p>
          )}
          {s && (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              <p className="font-medium">{t("imp.preview", { fy: result!.fiscalYear })}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular">
                {([["added", s.added], ["updated", s.updated], ["unchanged", s.unchanged], ["removed", s.removed]] as const)
                  .map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{t(`imp.${k}`)}</dt><dd>{v}</dd></div>)}
              </dl>
              {issues.length > 0 && (
                <ul className="mt-1 grid max-h-36 gap-1 overflow-y-auto text-xs">
                  {issues.slice(0, 50).map((x, i) => (
                    <li key={i} className="flex items-start gap-2 text-danger"><CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("imp.issue", { row: x.row, field: x.field, message: x.message })}</li>
                  ))}
                  {issues.length > 50 && <li className="text-muted-foreground">… {t("imp.moreIssues", { n: issues.length - 50 })}</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{tc("cancel")}</Button>
          <Button variant="outline" disabled={!loaded || !/^\d{4}-\d{2}$/.test(fy) || run.isPending} onClick={() => run.mutate(true)}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("imp.validate")}
          </Button>
          <Button disabled={!loaded || !/^\d{4}-\d{2}$/.test(fy) || run.isPending || issues.length > 0} onClick={() => run.mutate(false)}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("imp.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 2026-27 → 2027-28 (the budget each June publishes the year that follows the active one). */
function nextFy(current?: string): string {
  const m = /^(\d{4})-\d{2}$/.exec(current ?? "")
  if (!m) return ""
  return `${Number(m[1]) + 1}-${String((Number(m[1]) + 1) % 100).padStart(2, "0")}`
}
