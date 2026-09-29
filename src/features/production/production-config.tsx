"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDateTime } from "@/lib/format"
import type { ConsumptionMethod, ProductionProcedure } from "@/lib/types"

const PROCEDURES: ProductionProcedure[] = ["directStock", "workOrder"]
const METHODS: ConsumptionMethod[] = ["standard", "actual"]

/** Production configuration (legacy "Production Config"): batch procedure and consumption method. */
export function ProductionConfigPage() {
  const t = useTranslations("prodConfig")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const editable = can("settings.manage")
  const q = useQuery({ queryKey: ["productionConfig"], queryFn: api.production.config })
  const [procedure, setProcedure] = React.useState<ProductionProcedure>("directStock")
  const [consumption, setConsumption] = React.useState<ConsumptionMethod>("standard")
  const restore = React.useCallback(() => { if (q.data) { setProcedure(q.data.procedure); setConsumption(q.data.consumption) } }, [q.data])
  React.useEffect(restore, [restore])
  const dirty = !!q.data && (q.data.procedure !== procedure || q.data.consumption !== consumption)
  const save = useMutation({
    mutationFn: () => api.production.saveConfig({ procedure, consumption }),
    onSuccess: (d) => { qc.setQueryData(["productionConfig"], d); qc.invalidateQueries({ queryKey: ["audit"] }); toast.success(t("saved")) },
    onError: (e) => toast.error(e.message),
  })

  const group = <V extends string>(name: string, legend: string, values: V[], value: V, onChange: (v: V) => void) => (
    <fieldset className="grid gap-2" disabled={!editable}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <RadioGroup name={name} disabled={!editable} value={value} onValueChange={(v) => onChange(v as V)} className="grid gap-2 sm:grid-cols-2">
        {values.map((v) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-70">
            <RadioGroupItem value={v} className="mt-0.5" />
            <span className="grid gap-0.5"><span className="text-sm font-medium">{t(`${name}.${String(v)}`)}</span><span className="text-xs text-muted-foreground">{t(`${name}Hint.${String(v)}`)}</span></span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  )

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
          <CardDescription>{q.data?.updatedAt ? t("lastChanged", { by: q.data.updatedBy ?? "—", at: fmtDateTime(q.data.updatedAt, locale) }) : t("cardSub")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {q.isLoading ? <Skeleton className="h-48" /> : (
            <>
              {group("procedure", t("procedureLabel"), PROCEDURES, procedure, setProcedure)}
              {group("consumption", t("consumptionLabel"), METHODS, consumption, setConsumption)}
              {!editable && <p className="text-sm text-muted-foreground">{t("readOnly")}</p>}
            </>
          )}
        </CardContent>
        {editable && (
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" disabled={!dirty || save.isPending} onClick={restore}><RotateCcw /> {t("restore")}</Button>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("save")}</Button>
          </CardFooter>
        )}
      </Card>
    </>
  )
}
