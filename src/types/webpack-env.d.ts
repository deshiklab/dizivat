// webpack's require.context, used by the static demo runtime (src/lib/demo/runtime.ts)
declare namespace NodeJS {
  interface RequireContext {
    keys(): string[]
    (id: string): unknown
    resolve(id: string): string
    id: string
  }
  interface Require {
    context(directory: string, useSubdirectories?: boolean, regExp?: RegExp, mode?: "sync" | "eager" | "weak" | "lazy" | "lazy-once"): RequireContext
  }
}
