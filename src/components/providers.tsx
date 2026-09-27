"use client"

// First: in the static GitHub Pages demo this answers /api/v1 in the browser (no-op otherwise)
import "@/lib/demo/boot"
import * as React from "react"
import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { PrefsProvider } from "./prefs"

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } })
  )
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={qc}>
        <NuqsAdapter>
          <TooltipProvider delay={300}>
            <PrefsProvider>
              {children}
              <Toaster position="bottom-right" closeButton visibleToasts={3} />
            </PrefsProvider>
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
