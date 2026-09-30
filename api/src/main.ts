/**
 * DiziVAT API (NestJS + PostgreSQL). Runs behind the Next.js frontend, which rewrites /api/v1/* here.
 *   node dist/main.js                 migrate, seed on first start / restore, listen on API_HOST:API_PORT
 *   node dist/main.js --migrate-only  apply migrations and exit
 *   node dist/main.js --reset         drop all data, re-seed the demo data set, exit
 */
import "reflect-metadata"
import { join } from "node:path"
import { Logger } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import express from "express"
import { AppModule, VERSION } from "./app.module"
import { bootState } from "./boot"
import { ProblemFilter } from "./common/http"
import { usingDevSecret } from "./common/session"
import { db, pool } from "./db/client"

async function main() {
  const log = new Logger("DiziVAT")
  const args = new Set(process.argv.slice(2))
  if (args.has("--reset")) {
    await db.execute(sql`drop schema if exists public cascade`)
    await db.execute(sql`drop schema if exists drizzle cascade`)
    await db.execute(sql`create schema public`)
  }
  await migrate(db, { migrationsFolder: join(__dirname, "../drizzle") })
  log.log("migrations applied")
  if (args.has("--migrate-only")) return pool.end()
  if (args.has("--reset")) {
    await bootState((m) => log.log(m))
    return pool.end()
  }
  if (usingDevSecret()) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production")
    log.warn("SESSION_SECRET not set — using the development secret")
  }
  await bootState((m) => log.log(m))

  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn", "log"] })
  const http = app.getHttpAdapter().getInstance() as express.Express
  http.set("trust proxy", true)
  http.disable("x-powered-by")
  // Raw bodies: native handlers parse JSON the way the mock did; compat handlers get the bytes untouched
  app.use(express.raw({ type: () => true, limit: "10mb" }))
  app.useGlobalFilters(new ProblemFilter())
  app.enableShutdownHooks()
  const port = Number(process.env.API_PORT ?? 4000), host = process.env.API_HOST ?? "127.0.0.1"
  await app.listen(port, host)
  log.log(`DiziVAT API ${VERSION} listening on http://${host}:${port}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
