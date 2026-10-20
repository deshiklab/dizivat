"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  CheckCircle2,
  Copy,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Plus,
  Send,
  Trash2,
  Webhook,
} from "lucide-react"
import { toast } from "sonner"
import { useCan } from "@/components/auth/me-provider"
import { PageHeader } from "@/components/common/page-header"
import { Pill } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BASE_PATH } from "@/lib/base-path"
import { fmtMoney } from "@/lib/format"
import type {
  PosApiToken,
  PosQueueEntry,
  PosRegister,
  PosScope,
  PosWebhook,
  PosWebhookDelivery,
  PosWebhookEvent,
} from "@/lib/types"

const apiUrl = (path: string) => `${BASE_PATH}/api/v1${path}`

type RegisterRow = PosRegister & {
  openShift: { id: string; no: string; openedAt: string; openingFloat: number } | null
  salesCount: number
  activeTokens: number
  queueCount: number
}

const ALL_SCOPES: PosScope[] = ["pos:catalog.read", "pos:stock.read", "pos:sales.write", "pos:queue.sync"]
const ALL_EVENTS: PosWebhookEvent[] = [
  "pos.sale.completed",
  "pos.sale.voided",
  "pos.shift.opened",
  "pos.shift.closed",
  "pos.settlement.reconciled",
]

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { title?: string })?.title || `Request failed (${res.status})`)
  }
  return data as T
}

export function PosDevicesPage() {
  const t = useTranslations("posDevicesPage")
  const locale = useLocale()
  const qc = useQueryClient()
  const can = useCan()

  const [tab, setTab] = useState<"registers" | "tokens" | "queue" | "webhooks">("registers")

  // Register modal
  const [regModal, setRegModal] = useState(false)
  const [regCode, setRegCode] = useState("REG-03")
  const [regName, setRegName] = useState("Konabari Express Counter 3")
  const [regBranchId, setRegBranchId] = useState("b1")
  const [regTerminalId, setRegTerminalId] = useState("TERM-DBBL-0103")

  // Token modal
  const [tokModal, setTokModal] = useState(false)
  const [tokName, setTokName] = useState("Handheld Zebra Scanner #3")
  const [tokRegId, setTokRegId] = useState("reg1")
  const [tokScopes, setTokScopes] = useState<PosScope[]>(ALL_SCOPES)
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)

  // Webhook modal
  const [whModal, setWhModal] = useState(false)
  const [whName, setWhName] = useState("Warehouse OMS Webhook")
  const [whUrl, setWhUrl] = useState("https://oms.kanchanjhara-apparel.example/hooks/pos")
  const [whEvents] = useState<PosWebhookEvent[]>(ALL_EVENTS)

  const registersQ = useQuery({
    queryKey: ["pos", "registers"],
    queryFn: () => fetchJson<RegisterRow[]>("/pos/registers"),
  })

  const tokensQ = useQuery({
    queryKey: ["pos", "tokens"],
    queryFn: () => fetchJson<Omit<PosApiToken, "tokenHash">[]>("/pos/tokens"),
  })

  const queueQ = useQuery({
    queryKey: ["pos", "queue"],
    queryFn: () =>
      fetchJson<{
        registers: { id: string; code: string; name: string; lastSeqNo: number; lastSeenAt?: string }[]
        entries: PosQueueEntry[]
      }>("/pos/queue"),
  })

  const webhooksQ = useQuery({
    queryKey: ["pos", "webhooks"],
    queryFn: () => fetchJson<{ webhooks: PosWebhook[]; deliveries: PosWebhookDelivery[] }>("/pos/webhooks"),
  })

  const createRegMut = useMutation({
    mutationFn: () =>
      fetchJson<PosRegister>("/pos/registers", {
        method: "POST",
        body: JSON.stringify({
          code: regCode.trim(),
          name: regName.trim(),
          branchId: regBranchId,
          cashAccountId: "ac6",
          cardAccountId: "ac1",
          bkashAccountId: "ac4",
          nagadAccountId: "ac5",
          terminalId: regTerminalId.trim(),
          active: true,
        }),
      }),
    onSuccess: (r) => {
      toast.success(`Created register ${r.code}`)
      setRegModal(false)
      void qc.invalidateQueries({ queryKey: ["pos", "registers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createTokMut = useMutation({
    mutationFn: () =>
      fetchJson<{ token: Omit<PosApiToken, "tokenHash">; secret: string }>("/pos/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: tokName.trim(),
          registerId: tokRegId,
          scopes: tokScopes,
        }),
      }),
    onSuccess: ({ token, secret }) => {
      toast.success(`Issued token "${token.name}"`)
      setIssuedSecret(secret)
      void qc.invalidateQueries({ queryKey: ["pos", "tokens"] })
      void qc.invalidateQueries({ queryKey: ["pos", "registers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revokeTokMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/pos/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Token revoked")
      void qc.invalidateQueries({ queryKey: ["pos", "tokens"] })
      void qc.invalidateQueries({ queryKey: ["pos", "registers"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const syncQueueMut = useMutation({
    mutationFn: async () => {
      const reg1 = queueQ.data?.registers.find((r) => r.id === "reg1") ?? { id: "reg1", lastSeqNo: 2 }
      const nextSeq = reg1.lastSeqNo + 1
      return fetchJson<{
        registerCode: string
        lastSeqNo: number
        processed: number
        results: { seqNo: number; invoiceNo: string; status: string }[]
      }>("/pos/external/queue", {
        method: "POST",
        body: JSON.stringify({
          registerId: "reg1",
          events: [
            {
              seqNo: nextSeq,
              idempotencyKey: `reg1-seq-${nextSeq}`,
              clientCreatedAt: new Date().toISOString(),
              sale: {
                customerName: "Offline Queue Customer",
                lines: [{ itemId: "i17", qty: 2 }],
                tenders: [{ method: "cash", accountId: "ac6", amount: 828 }],
              },
            },
          ],
        }),
      })
    },
    onSuccess: (res) => {
      const first = res.results[0]
      toast.success(`Synced offline seq #${first?.seqNo} → ${first?.invoiceNo}`)
      void qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createWhMut = useMutation({
    mutationFn: () =>
      fetchJson<PosWebhook>("/pos/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: whName.trim(),
          url: whUrl.trim(),
          events: whEvents,
          active: true,
        }),
      }),
    onSuccess: (wh) => {
      toast.success(`Added webhook "${wh.name}"`)
      setWhModal(false)
      void qc.invalidateQueries({ queryKey: ["pos", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const testWhMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson<PosWebhookDelivery>(`/pos/webhooks/${encodeURIComponent(id)}/test`, {
        method: "POST",
      }),
    onSuccess: (d) => {
      toast.success(`Delivered signed ping (${d.signature.slice(0, 18)}…)`)
      void qc.invalidateQueries({ queryKey: ["pos", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteWhMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/pos/webhooks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Webhook removed")
      void qc.invalidateQueries({ queryKey: ["pos", "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          can("settings.manage") ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRegModal(true)} data-testid="pos-new-register-btn">
                <Plus className="mr-1.5 size-4" />
                {t("newRegister")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIssuedSecret(null)
                  setTokModal(true)
                }}
                data-testid="pos-issue-token-btn"
              >
                <KeyRound className="mr-1.5 size-4" />
                {t("issueToken")}
              </Button>
              <Button size="sm" onClick={() => setWhModal(true)} data-testid="pos-new-webhook-btn">
                <Webhook className="mr-1.5 size-4" />
                {t("newWebhook")}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface p-2.5" role="tablist">
        {(["registers", "tokens", "queue", "webhooks"] as const).map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={tab === k}
            variant={tab === k ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab(k)}
            data-testid={`pos-devices-tab-${k}`}
          >
            {k === "registers" && <MonitorSmartphone className="mr-1.5 size-4" />}
            {k === "tokens" && <KeyRound className="mr-1.5 size-4" />}
            {k === "queue" && <Layers className="mr-1.5 size-4" />}
            {k === "webhooks" && <Webhook className="mr-1.5 size-4" />}
            {t(`tabs.${k}`)}
          </Button>
        ))}
      </div>

      {/* TAB 1: REGISTERS */}
      {tab === "registers" && (
        <section className="rounded-lg border bg-surface p-4" aria-label={t("tabs.registers")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("col.code")}</th>
                  <th className="py-2 pr-3">{t("col.regNameBranch")}</th>
                  <th className="py-2 pr-3">{t("col.terminalId")}</th>
                  <th className="py-2 pr-3">{t("col.accounts")}</th>
                  <th className="py-2 pr-3">{t("col.openShift")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.lastSeq")}</th>
                  <th className="py-2 text-right">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(registersQ.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b" data-testid={`pos-register-row-${r.code}`}>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-primary">{r.code}</td>
                    <td className="py-2.5 pr-3 text-xs">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-muted-foreground">{r.branchName}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{r.terminalId ?? "—"}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-muted-foreground">
                      {[r.cashAccountId, r.cardAccountId, r.bkashAccountId, r.nagadAccountId]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      {r.openShift ? (
                        <Pill tone="success">{r.openShift.no}</Pill>
                      ) : (
                        <Pill tone="neutral">{t("closed")}</Pill>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs font-semibold">#{r.lastSeqNo}</td>
                    <td className="py-2.5 text-right">
                      <Pill tone={r.active ? "success" : "danger"}>
                        {r.active ? t("active") : t("inactive")}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 2: SCOPED API TOKENS */}
      {tab === "tokens" && (
        <section className="space-y-3 rounded-lg border bg-surface p-4" aria-label={t("tabs.tokens")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("col.name")}</th>
                  <th className="py-2 pr-3">{t("col.register")}</th>
                  <th className="py-2 pr-3">{t("col.prefix")}</th>
                  <th className="py-2 pr-3">{t("col.scopes")}</th>
                  <th className="py-2 pr-3">{t("col.status")}</th>
                  <th className="py-2 text-right">{t("col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {(tokensQ.data ?? []).map((tk) => (
                  <tr key={tk.id} className="border-b" data-testid={`pos-token-row-${tk.id}`}>
                    <td className="py-2.5 pr-3 text-xs font-medium">{tk.name}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{tk.registerCode}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{tk.prefix}…</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {tk.scopes.map((sc) => (
                          <span key={sc} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                            {sc}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Pill tone={tk.active ? "success" : "danger"}>
                        {tk.active ? t("active") : t("revoked")}
                      </Pill>
                    </td>
                    <td className="py-2.5 text-right">
                      {tk.active && can("settings.manage") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => revokeTokMut.mutate(tk.id)}
                          data-testid={`pos-revoke-token-${tk.id}`}
                        >
                          {t("revokeToken")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: OFFLINE SEQUENCE QUEUE */}
      {tab === "queue" && (
        <section className="space-y-4 rounded-lg border bg-surface p-4" aria-label={t("tabs.queue")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {(queueQ.data?.registers ?? []).map((r) => (
                <span key={r.id} className="rounded-md border bg-muted/50 px-3 py-1.5 font-mono">
                  <strong>{r.code}</strong> · {t("watermark", { seq: r.lastSeqNo })}
                </span>
              ))}
            </div>
            {can("doc.create") && (
              <Button
                size="sm"
                onClick={() => syncQueueMut.mutate()}
                disabled={syncQueueMut.isPending}
                data-testid="pos-simulate-queue-sync"
              >
                <Activity className="mr-1.5 size-4" />
                {t("simulateOfflineSync")}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("col.seqNo")}</th>
                  <th className="py-2 pr-3">{t("col.register")}</th>
                  <th className="py-2 pr-3">{t("col.idempotencyKey")}</th>
                  <th className="py-2 pr-3">{t("col.issuedInvoice")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.netTotal")}</th>
                  <th className="py-2 text-right">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(queueQ.data?.entries ?? []).map((q) => (
                  <tr key={q.id} className="border-b" data-testid={`pos-queue-seq-${q.seqNo}`}>
                    <td className="py-2.5 pr-3 font-mono font-bold">#{q.seqNo}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{q.registerCode}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{q.idempotencyKey}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-primary">{q.invoiceNo}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">{fmtMoney(q.netTotal, locale)}</td>
                    <td className="py-2.5 text-right">
                      <Pill tone="success">{q.status}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: WEBHOOKS & DELIVERIES */}
      {tab === "webhooks" && (
        <div className="space-y-4">
          <section className="rounded-lg border bg-surface p-4" aria-label={t("registeredWebhooks")}>
            <h2 className="mb-3 text-sm font-semibold">{t("registeredWebhooks")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">{t("col.name")}</th>
                    <th className="py-2 pr-3">{t("col.endpointUrl")}</th>
                    <th className="py-2 pr-3">{t("col.events")}</th>
                    <th className="py-2 text-right">{t("col.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(webhooksQ.data?.webhooks ?? []).map((wh) => (
                    <tr key={wh.id} className="border-b" data-testid={`pos-webhook-row-${wh.id}`}>
                      <td className="py-2.5 pr-3 text-xs font-semibold">{wh.name}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{wh.url}</td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {wh.events.map((ev) => (
                            <span key={ev} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                              {ev}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        {can("settings.manage") && (
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => testWhMut.mutate(wh.id)}
                              data-testid={`pos-webhook-test-${wh.id}`}
                            >
                              <Send className="mr-1 size-3.5" />
                              {t("testWebhook")}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label={t("revokeToken")}
                              onClick={() => deleteWhMut.mutate(wh.id)}
                            >
                              <Trash2 className="size-4 text-danger" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border bg-surface p-4" aria-label={t("recentDeliveries")}>
            <h2 className="mb-3 text-sm font-semibold">{t("recentDeliveries")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">{t("col.event")}</th>
                    <th className="py-2 pr-3">{t("col.ref")}</th>
                    <th className="py-2 pr-3">{t("col.webhook")}</th>
                    <th className="py-2 pr-3">{t("col.signature")}</th>
                    <th className="py-2 text-right">{t("col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(webhooksQ.data?.deliveries ?? []).map((d) => (
                    <tr key={d.id} className="border-b" data-testid={`pos-delivery-row-${d.ref}`}>
                      <td className="py-2 pr-3 font-mono text-xs font-semibold">{d.event}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{d.ref}</td>
                      <td className="py-2 pr-3 text-xs">{d.webhookName}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                        {d.signature.slice(0, 28)}…
                      </td>
                      <td className="py-2 text-right">
                        <Pill tone="success">{d.status}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* DIALOG 1: NEW REGISTER */}
      <Dialog open={regModal} onOpenChange={setRegModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newRegister")}</DialogTitle>
            <DialogDescription>{t("registerDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <Label htmlFor="pos-reg-code">{t("regCode")}</Label>
              <Input
                id="pos-reg-code"
                value={regCode}
                onChange={(e) => setRegCode(e.target.value)}
                className="mt-1 font-mono"
                data-testid="pos-reg-code-input"
              />
            </div>
            <div>
              <Label htmlFor="pos-reg-name">{t("regName")}</Label>
              <Input
                id="pos-reg-name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="mt-1"
                data-testid="pos-reg-name-input"
              />
            </div>
            <div>
              <Label htmlFor="pos-reg-branch">{t("branch")}</Label>
              <select
                id="pos-reg-branch"
                value={regBranchId}
                onChange={(e) => setRegBranchId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="b1">B1</option>
                <option value="b3">B3</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pos-reg-term">{t("terminalId")}</Label>
              <Input
                id="pos-reg-term"
                value={regTerminalId}
                onChange={(e) => setRegTerminalId(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createRegMut.mutate()}
              disabled={createRegMut.isPending}
              data-testid="pos-save-register-btn"
            >
              {t("newRegister")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: ISSUE SCOPED API TOKEN */}
      <Dialog open={tokModal} onOpenChange={setTokModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("issueToken")}</DialogTitle>
            <DialogDescription>{t("tokenDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <Label htmlFor="pos-tok-name">{t("tokenLabel")}</Label>
              <Input
                id="pos-tok-name"
                value={tokName}
                onChange={(e) => setTokName(e.target.value)}
                className="mt-1"
                data-testid="pos-tok-name-input"
              />
            </div>
            <div>
              <Label htmlFor="pos-tok-reg">{t("boundRegister")}</Label>
              <select
                id="pos-tok-reg"
                value={tokRegId}
                onChange={(e) => setTokRegId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                {(registersQ.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="font-medium">{t("scopes")}</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {ALL_SCOPES.map((sc) => {
                  const checked = tokScopes.includes(sc)
                  return (
                    <label key={sc} className="flex items-center gap-2 rounded border p-2 font-mono text-[11px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setTokScopes((prev) =>
                            e.target.checked ? [...prev, sc] : prev.filter((x) => x !== sc),
                          )
                        }
                      />
                      {sc}
                    </label>
                  )
                })}
              </div>
            </div>

            {issuedSecret && (
              <div
                className="space-y-1.5 rounded-md border border-success bg-success-soft p-3"
                data-testid="pos-issued-secret"
              >
                <div className="flex items-center justify-between font-semibold text-success">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-4" /> {t("secretTitle")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(issuedSecret)
                      toast.success("Copied token secret")
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <div className="break-all font-mono text-xs font-bold">{issuedSecret}</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => createTokMut.mutate()}
              disabled={createTokMut.isPending || tokScopes.length === 0}
              data-testid="pos-confirm-issue-token"
            >
              {t("issueToken")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: NEW WEBHOOK */}
      <Dialog open={whModal} onOpenChange={setWhModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newWebhook")}</DialogTitle>
            <DialogDescription>{t("webhookDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <Label htmlFor="pos-wh-name">{t("webhookName")}</Label>
              <Input id="pos-wh-name" value={whName} onChange={(e) => setWhName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="pos-wh-url">{t("targetUrl")}</Label>
              <Input
                id="pos-wh-url"
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createWhMut.mutate()}
              disabled={createWhMut.isPending}
              data-testid="pos-save-webhook-btn"
            >
              {t("newWebhook")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
