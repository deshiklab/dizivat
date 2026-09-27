"use client"

/**
 * Dashboard charts (recharts ≈ 100 KB gz). Loaded with next/dynamic after first paint (S4-03),
 * so KPIs, tables and navigation are interactive before the chart library arrives.
 * Animation is off: the charts already appear after first paint, and a static draw keeps screenshots deterministic.
 */
import { useLocale } from "next-intl"
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fmtCompact, fmtMoney } from "@/lib/format"

export interface SeriesRow { label: string; sales: number; purchases: number; outputVat: number; inputVat: number }

function useChartStyle() {
  const locale = useLocale()
  const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 }, formatter: (v: unknown) => `৳ ${fmtMoney(Number(v), locale)}` }
  const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false }
  return { tip, axis, compact: (v: number) => fmtCompact(v, locale) }
}

export function SalesPurchasesChart({ data, labels }: { data: SeriesRow[]; labels: { sales: string; purchases: string } }) {
  const { tip, axis, compact } = useChartStyle()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={compact} />
        <Tooltip {...tip} cursor={{ fill: "var(--muted)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="sales" isAnimationActive={false} name={labels.sales} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="purchases" isAnimationActive={false} name={labels.purchases} fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function VatTrendChart({ data, labels }: { data: SeriesRow[]; labels: { outputVat: string; inputVat: string } }) {
  const { tip, axis, compact } = useChartStyle()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={compact} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="outputVat" isAnimationActive={false} name={labels.outputVat} stroke="var(--chart-1)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="inputVat" isAnimationActive={false} name={labels.inputVat} stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
