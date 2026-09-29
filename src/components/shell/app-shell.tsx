"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { TopBar } from "./top-bar"
import { StatusFooter } from "./status-footer"
import { MobileNav } from "./mobile-nav"
import { CommandPalette, useTrackRecent } from "./command-palette"
import { ShortcutsDialog } from "./shortcuts-dialog"
import { LazyPasswordDialog } from "./password-dialog-lazy"
import { ShellCtx } from "./shell-context"
import { ConfirmProvider } from "@/components/common/confirm"
import { useGlobalHotkeys } from "./use-hotkeys"

function Hotkeys() { useGlobalHotkeys(); useTrackRecent(); return null }

export function AppShell({ children, defaultOpen }: { children: React.ReactNode; defaultOpen: boolean }) {
  const t = useTranslations("shell")
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [pwOpen, setPwOpen] = React.useState(false)
  return (
    <ShellCtx.Provider value={{ paletteOpen, setPaletteOpen, helpOpen, setHelpOpen, pwOpen, setPwOpen }}>
      <ConfirmProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">{t("skipToContent")}</a>
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-background">
          <TopBar />
          <main id="main" tabIndex={-1} className="flex-1 px-3 pt-4 pb-24 outline-none md:px-6 md:pb-8">{children}</main>
          <StatusFooter />
        </SidebarInset>
        <MobileNav />
        <CommandPalette />
        <ShortcutsDialog />
        <LazyPasswordDialog />
        <Hotkeys />
      </SidebarProvider>
      </ConfirmProvider>
    </ShellCtx.Provider>
  )
}
