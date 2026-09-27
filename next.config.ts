import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const nextConfig: NextConfig = {
  // Allow the sandbox preview host to use dev HMR.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
  poweredByHeader: false,
}

export default withNextIntl(nextConfig)
