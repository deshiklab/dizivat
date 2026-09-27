"use client"

import * as React from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

/** Promise-based confirm — replaces the prototype's 104 native confirm()/alert() calls. */
type Opts = { title: string; description?: string; confirm: string; cancel: string; destructive?: boolean }
const Ctx = React.createContext<(o: Opts) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(Opts & { resolve: (v: boolean) => void }) | null>(null)
  const ask = React.useCallback((o: Opts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  return (
    <Ctx.Provider value={ask}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title}</AlertDialogTitle>
            {state?.description && <AlertDialogDescription>{state.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>{state?.cancel}</AlertDialogCancel>
            <AlertDialogAction variant={state?.destructive ? "destructive" : "default"} onClick={() => close(true)}>{state?.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  )
}
export const useConfirm = () => React.useContext(Ctx)
