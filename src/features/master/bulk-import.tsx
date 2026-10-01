"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckCircle2, CircleAlert, FileSpreadsheet, Loader2, PackagePlus, ShieldCheck, Upload, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PageHeader } from "@/components/common/page-header"
import { RequirePerm } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { fmtHs, fmtNum } from "@/lib/format"
import { RMG_CATALOG, catalogRows, type CatalogItem } from "@/lib/rmg-catalog"
import { IMPORT_FIELDS, mapRows, readSheet, templateCsv } from "@/lib/sheet"
import type { ImportEntity, ImportResult } from "@/lib/types"

const ENTITIES: ImportEntity[] = ["items", "customers", "vendors"]
const CATS: CatalogItem["category"][] = ["packaging", "labels", "trims", "fabric", "garment"]
const LIST_HREF: Record<ImportEntity, string> = { items: "/inventory/items", customers: "/master/customers", vendors: "/master/vendors" }

interface Loaded { source: string; rows: Record<string, unknown>[]; unknown: string[]; missing: string[]; columns: string[] }

/**
 * R6.2 (NBR enlistment — bulk upload): items, customers and vendors from a CSV or Excel (.xlsx) sheet. The file is read
 * in the browser; the server validates every row (dry run) and then creates all of them in one go, or none.
 * Records that already exist (same SKU / BIN / name) are skipped. RMG companies can start from the built-in catalogue.
 */
export function BulkImportPage() {
  return (
    <RequirePerm perm="master.edit" back="/master/customers">
      <BulkImport />
    </RequirePerm>
  )
}

function BulkImport() {
  const t = useTranslations("imp")
  const tv = useTranslations("validation")
  const locale = useLocale()
  const qc = useQueryClient()
  const [entity, setEntity] = React.useState<ImportEntity>("items")
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [readError, setReadError] = React.useState<string | null>(null)
  const [cats, setCats] = React.useState<CatalogItem["category"][]>(["packaging", "labels", "trims"])
  const fileRef = React.useRef<HTMLInputElement>(null)
  const resetAll = () => { setLoaded(null); setResult(null); setReadError(null); if (fileRef.current) fileRef.current.value = "" }

  const onFile = async (f: File | undefined) => {
    setResult(null); setReadError(null)
    if (!f) return
    try {
      const table = await readSheet(f)
      const m = mapRows(entity, table)
      if (!m.rows.length) { setLoaded(null); setReadError(t("noRows")); return }
      setLoaded({ source: f.name, ...m })
    } catch (e) {
      setLoaded(null)
      setReadError(t(e instanceof Error && (e.message === "unsupported" || e.message === "notXlsx") ? e.message : "readFailed"))
    }
  }
  const useCatalog = () => {
    const picked = RMG_CATALOG.filter((c) => cats.includes(c.category))
    setResult(null); setReadError(null)
    setLoaded({ source: t("catalogSource", { n: picked.length }), rows: catalogRows(picked), unknown: [], missing: [], columns: IMPORT_FIELDS.items.filter((f) => f !== "active") })
  }
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.import.run({ entity, dryRun, rows: loaded!.rows }),
    onSuccess: (r) => {
      setResult(r)
      if (!r.dryRun && r.created) {
        qc.invalidateQueries({ queryKey: [entity] }); qc.invalidateQueries({ queryKey: ["items"] })
        toast.success(t("created", { n: r.created, count: r.created }))
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) toast.error(Object.values(e.errors).flat().map((m) => (tv.has(m) ? tv(m) : t.has(`err.${m}`) ? t(`err.${m}`) : m)).join(" · "))
      else toast.error(e.message)
    },
  })
  const msg = (m: string) => (tv.has(m) ? tv(m) : t.has(`err.${m}`) ? t(`err.${m}`) : m)
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(entity))}`
  const preview = loaded?.rows.slice(0, 10) ?? []
  const cols = loaded?.columns ?? []
  const validated = result?.dryRun && result.issues.length === 0
  const done = result && !result.dryRun && result.issues.length === 0

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t("step1")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <RadioGroup value={entity} onValueChange={(v) => { setEntity(v as ImportEntity); resetAll() }} className="grid gap-2 sm:grid-cols-3" aria-label={t("entity")}>
                {ENTITIES.map((e) => (
                  <label key={e} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5">
                    <RadioGroupItem value={e} className="mt-0.5" />
                    <span className="grid gap-0.5"><span className="text-sm font-medium">{t(`e.${e}`)}</span><span className="text-xs text-muted-foreground">{t(`eHint.${e}`)}</span></span>
                  </label>
                ))}
              </RadioGroup>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} id="imp-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
                <Button onClick={() => fileRef.current?.click()}><Upload /> {t("choose")}</Button>
                <Button variant="outline" render={<a href={template} download={`dizivat-${entity}-template.csv`} />}><Download /> {t("template")}</Button>
                <span className="text-xs text-muted-foreground">{t("formats")}</span>
              </div>
              {readError && <p role="alert" className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="size-4" aria-hidden /> {readError}</p>}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">{t("columns")}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{IMPORT_FIELDS[entity].join(" · ")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t(`colsHint.${entity}`)}</p>
              </details>
            </CardContent>
          </Card>

          {loaded && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-4" aria-hidden /> {t("step2")}</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm">{t("loaded", { source: loaded.source, n: loaded.rows.length, count: loaded.rows.length })}</p>
                {loaded.missing.length > 0 && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{t("missingCols", { cols: loaded.missing.join(", ") })}</p>}
                {loaded.unknown.length > 0 && <p className="rounded-md bg-warning-soft p-3 text-xs">{t("unknownCols", { cols: loaded.unknown.join(", ") })}</p>}
                <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("preview")}>
                  <table className="w-full min-w-[640px] text-xs">
                    <caption className="sr-only">{t("preview")}</caption>
                    <thead><tr className="border-b bg-muted/50 text-left text-muted-foreground"><th scope="col" className="px-2 py-1.5 font-medium">#</th>{cols.map((c) => <th key={c} scope="col" className="px-2 py-1.5 font-medium">{c}</th>)}</tr></thead>
                    <tbody>{preview.map((r, i) => <tr key={i} className="border-b last:border-0"><td className="px-2 py-1 text-muted-foreground tabular">{i + 2}</td>{cols.map((c) => <td key={c} className="max-w-56 truncate px-2 py-1">{c === "hsCode" && r[c] ? fmtHs(String(r[c])) : String(r[c] ?? "")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                {loaded.rows.length > preview.length && <p className="text-xs text-muted-foreground">{t("previewMore", { n: loaded.rows.length - preview.length })}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={run.isPending || loaded.missing.length > 0} onClick={() => run.mutate(true)}>{run.isPending && run.variables === true ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t("validate")}</Button>
                  <Button disabled={run.isPending || !validated || loaded.missing.length > 0} onClick={() => run.mutate(false)}>{run.isPending && run.variables === false ? <Loader2 className="animate-spin" /> : <PackagePlus />} {t("import", { n: Math.max(0, (result?.valid ?? 0) - (result?.duplicates ?? 0)) })}</Button>
                  <Button variant="ghost" onClick={resetAll}>{t("clear")}</Button>
                </div>
                {!validated && !done && <p className="text-xs text-muted-foreground">{t("validateFirst")}</p>}
              </CardContent>
            </Card>
          )}

          {result && (
            <Card aria-live="polite">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base">{result.issues.length ? <CircleAlert className="size-4 text-destructive" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />} {done ? t("doneTitle") : t("resultTitle")}</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">{t("r.total")}</dt><dd className="text-lg font-semibold tabular">{fmtNum(result.total, locale)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t("r.valid")}</dt><dd className="text-lg font-semibold tabular">{fmtNum(result.valid, locale)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t("r.duplicates")}</dt><dd className="text-lg font-semibold tabular">{fmtNum(result.duplicates, locale)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{done ? t("r.created") : t("r.issues")}</dt><dd className="text-lg font-semibold tabular">{fmtNum(done ? result.created : result.issues.length, locale)}</dd></div>
                </dl>
                {done && <p>{t("doneBody", { n: result.created })} <Link href={LIST_HREF[entity]} className="font-medium text-primary hover:underline">{t("openList")}</Link></p>}
                {validated && <p className="text-success">{t("readyBody", { n: result.valid - result.duplicates })}</p>}
                {result.issues.length > 0 && (
                  <>
                    <p className="text-destructive">{t("issuesBody")}</p>
                    <div className="max-h-80 overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={t("issuesTable")}>
                      <table className="w-full text-xs">
                        <caption className="sr-only">{t("issuesTable")}</caption>
                        <thead className="sticky top-0 bg-muted"><tr className="text-left text-muted-foreground"><th scope="col" className="px-2 py-1.5 font-medium">{t("col.row")}</th><th scope="col" className="px-2 py-1.5 font-medium">{t("col.field")}</th><th scope="col" className="px-2 py-1.5 font-medium">{t("col.problem")}</th></tr></thead>
                        <tbody>{result.issues.map((x, i) => <tr key={i} className="border-t"><td className="px-2 py-1 tabular">{x.row}</td><td className="px-2 py-1 font-mono">{x.field}</td><td className="px-2 py-1">{msg(x.message)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="grid content-start gap-4">
          {entity === "items" && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t("catalogTitle")}</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p className="text-muted-foreground">{t("catalogBody", { n: RMG_CATALOG.length })}</p>
                <fieldset className="grid gap-2">
                  <legend className="sr-only">{t("catalogCats")}</legend>
                  {CATS.map((c) => (
                    <div key={c} className="flex items-center gap-2">
                      <Checkbox id={`cat-${c}`} checked={cats.includes(c)} onCheckedChange={(on) => setCats((x) => (on ? [...x, c] : x.filter((y) => y !== c)))} />
                      <Label htmlFor={`cat-${c}`} className="font-normal">{t(`cat.${c}`)} <span className="text-muted-foreground tabular">({RMG_CATALOG.filter((x) => x.category === c).length})</span></Label>
                    </div>
                  ))}
                </fieldset>
                <Button variant="outline" disabled={!cats.length} onClick={useCatalog}><PackagePlus /> {t("useCatalog")}</Button>
                <p className="text-xs text-muted-foreground">{t("catalogNote")}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("rulesTitle")}</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid list-disc gap-1.5 pl-4 text-xs text-muted-foreground">
                <li>{t("rule1")}</li><li>{t("rule2")}</li><li>{t("rule3")}</li><li>{t("rule4")}</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  )
}
