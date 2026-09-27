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

const nextConfig: NextConfig = staticDemo
  ? {
      output: "export",
      basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      // "demo.tsx" files (generateStaticParams layouts) are routes in this build only; no .ts → no route handlers/middleware
      pageExtensions: ["demo.tsx", "tsx", "jsx"],
      poweredByHeader: false,
    }
  : {
      // Allow the sandbox preview host to use dev HMR.
      allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
      poweredByHeader: false,
    }

export default withNextIntl(nextConfig)
