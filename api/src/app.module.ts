import { Controller, Get, Global, Inject, Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { sql } from "drizzle-orm"
import { AuthGuard, SessionService } from "./common/auth"
import { db } from "./db/client"
import { AuditController, AuditService } from "./modules/audit"
import { CompatController, CompatService } from "./modules/compat"
import { AuthController, MeController, UsersController, UsersService } from "./modules/identity"
import { CompanyController, TariffController, UnitsController, UnitsService } from "./modules/reference"
import { SEED_VERSION } from "./boot"

export const VERSION = "0.9.0"
const NATIVE_CONTROLLERS = [AuthController, MeController, UsersController, CompanyController, UnitsController, TariffController, AuditController]

@Global()
@Module({
  providers: [SessionService, AuditService, UsersService, UnitsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService, AuditService, UsersService, UnitsService],
})
class CoreModule {}

@Controller("api/v1/health")
class HealthController {
  constructor(@Inject(CompatService) private readonly compat: CompatService) {}

  /** Public liveness + database check (Render health check). */
  @Get()
  async health() {
    const t = Date.now()
    await db.execute(sql`select 1`)
    return { ok: true, version: VERSION, seed: SEED_VERSION, db: { ok: true, ms: Date.now() - t }, modules: { native: NATIVE_CONTROLLERS.length, compatRoutes: this.compat.size }, uptime: Math.round(process.uptime()) }
  }
}

@Module({ controllers: [...NATIVE_CONTROLLERS, HealthController] , providers: [CompatService], exports: [CompatService] })
class NativeModule {}

/** Last, so its catch-all only sees what no native controller handles. */
@Module({ controllers: [CompatController] })
class CompatModule {}

@Module({ imports: [CoreModule, NativeModule, CompatModule] })
export class AppModule {}
