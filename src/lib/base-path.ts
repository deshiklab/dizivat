/**
 * The app normally runs at "/". The static GitHub Pages demo is served from "/<repo>/" with trailing slashes.
 * `Link` and `useRouter` handle that themselves; use these helpers wherever a URL is built by hand
 * (window.location, copied links).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1"

/** In-app path → URL for a full-page navigation or a copied link. */
export function appUrl(path: string) {
  const i = path.indexOf("?")
  let p = i < 0 ? path : path.slice(0, i)
  const q = i < 0 ? "" : path.slice(i)
  if (STATIC_DEMO && !p.endsWith("/")) p += "/"
  return BASE_PATH + p + q
}

/** window.location.pathname without the base path (and without the demo's trailing slash). */
export function appPathname(pathname: string) {
  let p = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || "/" : pathname
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
  return p
}
