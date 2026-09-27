"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { api, ApiError } from "@/lib/api/client"
import { itemInput } from "@/lib/schemas"
import type { ItemWithStock } from "@/lib/types"
import { HsLookup } from "./hs-lookup"

type In = z.input<typeof itemInput>
type Out = z.output<typeof itemInput>
const GROUPS = ["Raw Material", "Consumable", "Packing Materials", "Finished Goods"] as const
const UNITS = ["Kg", "Pcs", "Roll", "Meter"] as const
const blank: In = { name: "", hsCode: "", group: "Raw Material", unit: "Kg", sku: "", purchasePrice: 0, salePrice: 0, vatRate: 15, sdRate: 0, reorderLevel: 0, active: true }

/** Create/edit in a side sheet: keeps list context, ≤ 11 fields, validated with the shared zod schema. */
export function ItemSheet({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item?: ItemWithStock | null }) {
  const t = useTranslations("items")
  const tc = useTranslations("common")
  const tg = useTranslations("group")
  const qc = useQueryClient()
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(itemInput), defaultValues: blank, mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const [hs, vatRate, sdRate] = useWatch({ control, name: ["hsCode", "vatRate", "sdRate"] })
  React.useEffect(() => {
    if (open) reset(item ? { name: item.name, hsCode: item.hsCode, group: item.group, unit: item.unit, sku: item.sku, purchasePrice: item.purchasePrice, salePrice: item.salePrice, vatRate: item.vatRate, sdRate: item.sdRate, reorderLevel: item.reorderLevel, active: item.active } : blank)
  }, [open, item, reset])
  const save = useMutation({
    mutationFn: (v: Out) => (item ? api.items.update(item.id, v) : api.items.create(v)),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["items"] }); toast.success(item ? t("updated", { name: r.name }) : t("created", { name: r.name })); onOpenChange(false) },
    onError: (e) => { if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] })); else toast.error(e.message) },
  })
  const groupItems = GROUPS.map((g) => ({ value: g, label: tg(g.replace(/ /g, "")) }))
  const unitItems = UNITS.map((u) => ({ value: u, label: u }))
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{item ? t("editTitle") : t("newTitle")}</SheetTitle>
            <SheetDescription>{item ? `${item.sku} · ${item.name}` : t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="name" label={t("field.name")} required error={errors.name?.message} className="sm:col-span-2">{(a) => <Input autoFocus {...a} {...register("name")} />}</Field>
            <Field id="sku" label={t("field.sku")} required error={errors.sku?.message}>{(a) => <Input {...a} {...register("sku")} />}</Field>
            <Field id="hsCode" label={t("field.hsCode")} required error={errors.hsCode?.message} hint={t("hsHint")}>{(a) => <Input inputMode="numeric" maxLength={8} className="tabular" {...a} {...register("hsCode")} />}</Field>
            <HsLookup hs={hs} vatRate={vatRate} sdRate={sdRate} onUse={(vat, sd) => { setValue("vatRate", vat, { shouldDirty: true }); setValue("sdRate", sd, { shouldDirty: true }) }} />
            <Field id="group" label={t("field.group")} required>
              {(a) => <Controller control={control} name="group" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={groupItems}><SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{groupItems.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent></Select>
              )} />}
            </Field>
            <Field id="unit" label={t("field.unit")} required>
              {(a) => <Controller control={control} name="unit" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={unitItems}><SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{unitItems.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent></Select>
              )} />}
            </Field>
            <Field id="purchasePrice" label={t("field.purchasePrice")} error={errors.purchasePrice?.message}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("purchasePrice", { valueAsNumber: true })} />}</Field>
            <Field id="salePrice" label={t("field.salePrice")} error={errors.salePrice?.message}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("salePrice", { valueAsNumber: true })} />}</Field>
            <Field id="vatRate" label={t("field.vatRate")} error={errors.vatRate?.message}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("vatRate", { valueAsNumber: true })} />}</Field>
            <Field id="sdRate" label={t("field.sdRate")} error={errors.sdRate?.message}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("sdRate", { valueAsNumber: true })} />}</Field>
            <Field id="reorderLevel" label={t("field.reorder")} error={errors.reorderLevel?.message} hint={t("reorderHint")}>{(a) => <Input type="number" step="1" min={0} className="text-right tabular" {...a} {...register("reorderLevel", { valueAsNumber: true })} />}</Field>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
              <Label htmlFor="active">{t("field.active")}</Label>
              <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {tc("save")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
