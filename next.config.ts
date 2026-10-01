import { readFileSync } from "node:fs"
import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

/**
 * NEXT_PUBLIC_STATIC_DEMO=1 builds the static GitHub Pages demo into out/ (see .github/workflows/pages.yml):
 * no middleware and no route handlers (only .tsx files are routes); the mock API runs in the browser instead
 * (src/lib/demo). The site is written to out/. Note: this build also reuses .next, so run `npm run build`
 * again before `npm start` afterwards.
 */
const staticDemo = process.env.NEXT_PUBLIC_STATIC_DEMO === "1"
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined
// SKIP_BUILD_TYPECHECK=1: skip next build's own type-check worker (low-memory boxes run `npm run typecheck` separately; CI keeps it)
const typescript = { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" }
// LOW_MEM_BUILD=1: single compile worker + webpack memory optimisations (2 GB dev boxes); CI builds at full speed
const experimental = process.env.LOW_MEM_BUILD === "1" ? { webpackMemoryOptimizations: true, cpus: 1 } : undefined

/**
 * API_UPSTREAM=http://127.0.0.1:4000 (R5, branch r5-nestjs): /api/v1/* is proxied to the NestJS + PostgreSQL API
 * instead of the in-process mock handlers. Read at BUILD time (rewrites are compiled into the route manifest).
 * STANDALONE=1: self-contained server in .next/standalone for the Docker image.
 */
const upstream = process.env.API_UPSTREAM?.replace(/\/$/, "")
const standalone = process.env.STANDALONE === "1"
// Footer build info: package version and where the data lives (inlined at build time)
const env = {
  NEXT_PUBLIC_APP_VERSION: (JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as { version: string }).version,
  NEXT_PUBLIC_DATA_MODE: upstream ? "postgres" : "mock",
}

const nextConfig: NextConfig = staticDemo
  ? {
      output: "export",
      env,
      typescript,
      experimental,
      basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      // "demo.tsx" files (generateStaticParams layouts) are routes in this build only; no .ts → no route handlers/middleware
      pageExtensions: ["demo.tsx", "tsx", "jsx"],
      poweredByHeader: false,
    }
  : {
      // Allow the sandbox preview host to use dev HMR.
      env,
      typescript,
      experimental,
      // "server.tsx" files are routes in this build only: the [...slug] catch-all (in-shell 404 for unknown URLs).
      // The static demo has nothing to prerender there — unknown paths get out/404.html instead.
      pageExtensions: ["server.tsx", "tsx", "ts", "jsx", "js"],
      allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
      poweredByHeader: false,
      ...(standalone ? { output: "standalone" as const } : {}),
      // beforeFiles: checked before the app's own route handlers, so the backend wins over the mock
      ...(upstream ? { rewrites: async () => ({ beforeFiles: [{ source: "/api/v1/:path*", destination: `${upstream}/api/v1/:path*` }], afterFiles: [], fallback: [] }) } : {}),
    }

export default withNextIntl(nextConfig)
