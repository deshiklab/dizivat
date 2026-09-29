// Finishes the static GitHub Pages demo in out/ (run after `next build` with NEXT_PUBLIC_STATIC_DEMO=1):
//  • index.html — the middleware isn't available, so pick the locale in the browser (Bengali browsers → /bn/)
//  • 404.html   — bilingual not-found page with a way back
//  • .nojekyll  — serve the _next/ folder as-is
import { existsSync, writeFileSync } from "node:fs"

const base = process.env.NEXT_PUBLIC_BASE_PATH || ""
if (!existsSync("out/en/index.html")) {
  console.error("out/en/index.html missing: run the static demo build first")
  process.exit(1)
}

const page = (title, body, head = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>${head}
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fa;color:#0f1b2d}
main{max-width:30rem;padding:2rem;text-align:center}a{color:#1d5fd1;font-weight:600}h1{font-size:1.4rem;margin:.2rem 0 .6rem}p{margin:.4rem 0}</style>
</head><body><main>${body}</main></body></html>
`

writeFileSync("out/index.html", page("DiziVAT", `<p>Opening <a href="${base}/en/">DiziVAT</a> …</p>`,
  `<script>(function(){var l=(navigator.languages||[navigator.language||""]).join(",");location.replace("${base}/"+(/(^|,)bn/i.test(l)?"bn":"en")+"/")})()</script>
<noscript><meta http-equiv="refresh" content="0;url=${base}/en/"></noscript>`))

writeFileSync("out/404.html", page("Page not found · DiziVAT", `
<p style="font-size:2.5rem;margin:0">404</p>
<h1>Page not found</h1><p>This page doesn't exist in the demo.</p>
<h1 lang="bn">পৃষ্ঠাটি পাওয়া যায়নি</h1><p lang="bn">এই পৃষ্ঠাটি ডেমোতে নেই।</p>
<p><a href="${base}/en/">Go to the dashboard</a> · <a lang="bn" href="${base}/bn/">ড্যাশবোর্ডে যান</a></p>`))

writeFileSync("out/.nojekyll", "")
console.log(`Static demo ready in out/ (base path "${base || "/"}")`)
