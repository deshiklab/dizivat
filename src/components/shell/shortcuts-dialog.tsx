"use client"

import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { useShell } from "./shell-context"

const LIST: [string[], string][] = [
  [["⌘", "K"], "palette"], [["/"], "palette"], [["?"], "help"], [["⌘", "B"], "sidebar"],
  [["g", "d"], "goDashboard"], [["g", "s"], "goSales"], [["g", "p"], "goPurchases"], [["g", "i"], "goItems"],
  [["n"], "newRecord"], [["Esc"], "closeOverlay"],
]

export function ShortcutsDialog() {
  const { helpOpen, setHelpOpen } = useShell()
  const t = useTranslations("shortcuts")
  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 text-sm">
          {LIST.map(([keys, k], i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
              <dt>{t(k)}</dt>
              <dd className="flex gap-1">{keys.map((x) => <Kbd key={x}>{x}</Kbd>)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
