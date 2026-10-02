// Three bundles:
//  dist/main.js   — the NestJS app (node_modules stay external)
//  dist/compat.js — the not-yet-ported mock route handlers from ../src, fully bundled; required at boot
//                   only after the saved state has been restored into the globals they read.
//  dist/restore.js — R6.3 backup restore + restore drill (see docs/BACKUP_RESTORE.md)
import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const here = fileURLToPath(new URL(".", import.meta.url))
const api = join(here, "..")
execFileSync(process.execPath, [join(here, "gen-compat-routes.mjs")], { stdio: "inherit" })

// "@/…" (and the session-user shim) resolve through api/tsconfig.json paths, applied to every file incl. ../src
const alias = { "server-only": join(api, "src/compat/empty.ts") }
const common = {
  platform: "node", target: "node20", format: "cjs", bundle: true, sourcemap: true, logLevel: "warning",
  tsconfig: join(api, "tsconfig.json"), alias, legalComments: "none",
}
await build({ ...common, entryPoints: [join(api, "src/main.ts")], outfile: join(api, "dist/main.js"), packages: "external",
  // ../src files import zod from the root node_modules at type level; at runtime they must use the API's copy
  external: ["./compat.js"] })
await build({ ...common, entryPoints: [join(api, "src/compat/entry.ts")], outfile: join(api, "dist/compat.js"),
  nodePaths: [join(api, "node_modules")] })
// R6.3: backup restore / restore drill (node dist/restore.js --source … --target …); starts dist/main.js for --boot
await build({ ...common, entryPoints: [join(api, "src/restore.ts")], outfile: join(api, "dist/restore.js"), packages: "external" })
console.log("built dist/main.js + dist/compat.js + dist/restore.js")
