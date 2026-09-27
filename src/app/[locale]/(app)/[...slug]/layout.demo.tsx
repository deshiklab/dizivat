import { slugParams } from "@/lib/demo/static-params"

/**
 * Static GitHub Pages demo only: the ".demo.tsx" extension is a route file only in that build (see next.config.ts),
 * so the server build keeps this segment fully dynamic.
 */
export const generateStaticParams = () => slugParams()

export default function DemoParamsLayout({ children }: { children: React.ReactNode }) {
  return children
}
