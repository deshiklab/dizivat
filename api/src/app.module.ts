import { Controller, Get, Global, Inject, Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { sql } from "drizzle-orm"
import { ACCESS_LOGGER, AuthGuard, SessionService } from "./common/auth"
import { db } from "./db/client"
import { AccountingConfigController, AccountingConfigService, MoneyAccountsController, MoneyAccountsService, MoneyDocsService, OpenInvoicesController, PaymentsController, ReceiptsController, StatementController } from "./modules/accounting"
import { AuditController, AuditService } from "./modules/audit"
import { BackupsController, BackupsService } from "./modules/backups"
import { BatchesController, BatchesService } from "./modules/batches"
import { DerivedService, ItemLedgerController, LotsController, StockController, SubcontractController } from "./modules/derived"
import { CompatController, CompatService } from "./modules/compat"
import { AuthController, MeController, UsersController, UsersService } from "./modules/identity"
import { CustomersController, PartiesService, VendorsController } from "./modules/parties"
import { ItemsController, ItemsService, MasterItemsController } from "./modules/items"
import { DamageController, StockService, TransfersController } from "./modules/stock"
import { CreditNotesController, DebitNotesController, NotesService } from "./modules/notes"
import { OpeningsController, OpeningsService } from "./modules/openings"
import { BomsController, BomsService, ProductionConfigController, ProductionConfigService } from "./modules/production"
import { PurchasesController, PurchasesService } from "./modules/purchases"
import { SalesController, SalesService } from "./modules/sales"
import { WorkOrdersController, WorkOrdersService } from "./modules/workorders"
import { CompanyController, TariffController, UnitsController, UnitsService } from "./modules/reference"
import { AdjustmentsController, AdjustmentsService, TreasuryController, TreasuryService, VdsController, VdsEligibleController, VdsService } from "./modules/vat"
import { ComplianceController, PeriodsController, ReturnSubFormController, ReturnsController, ReturnsService, VatSettingsController } from "./modules/returns"
import { SEED_VERSION } from "./boot"

export const VERSION = "0.15.0"
const NATIVE_CONTROLLERS = [
  AuthController, MeController, UsersController, CompanyController, UnitsController, TariffController, AuditController, BackupsController,
  CustomersController, VendorsController, ItemsController, MasterItemsController, TransfersController, DamageController,
  PurchasesController,
  CreditNotesController,
  DebitNotesController,
  OpeningsController,
  BatchesController,
  BomsController, ProductionConfigController, WorkOrdersController,
  MoneyAccountsController, ReceiptsController, PaymentsController, OpenInvoicesController, StatementController, AccountingConfigController,
  StockController, ItemLedgerController, LotsController, SubcontractController,
  SalesController,
  // `vat/vds/eligible` is registered before `vat/vds/:id`: Express matches a dynamic segment first otherwise, and
  // "eligible" would be read as a certificate number
  TreasuryController, VdsEligibleController, VdsController, AdjustmentsController,
  // the return: `vat/returns/:period/notes/:note` after the return's own routes, and the periods, the compliance
  // centre and the NBR settings last
  ReturnsController, ReturnSubFormController, PeriodsController, ComplianceController, VatSettingsController,
]

@Global()
@Module({
  providers: [
    SessionService, AuditService, UsersService, UnitsService, PartiesService, ItemsService, StockService, SalesService,
    PurchasesService, NotesService, OpeningsService, BatchesService, BomsService, ProductionConfigService,
    WorkOrdersService, MoneyAccountsService, MoneyDocsService, AccountingConfigService,
    TreasuryService, VdsService, AdjustmentsService, ReturnsService, DerivedService, CompatService, BackupsService, { provide: ACCESS_LOGGER, useExisting: AuditService }, { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    SessionService, AuditService, UsersService, UnitsService, PartiesService, ItemsService, StockService, SalesService,
    PurchasesService, NotesService, OpeningsService, BatchesService, BomsService, ProductionConfigService,
    WorkOrdersService, MoneyAccountsService, MoneyDocsService, AccountingConfigService,
    TreasuryService, VdsService, AdjustmentsService, ReturnsService, DerivedService, CompatService, BackupsService,
  ],
})
class CoreModule {}

/** Git commit of the running build: Render sets RENDER_GIT_COMMIT at runtime; the Docker image bakes GIT_COMMIT
 *  (CI build-arg). The deploy pipeline waits until the live health reports the commit it just tested. */
const COMMIT = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim() || null

@Controller("api/v1/health")
class HealthController {
  constructor(@Inject(CompatService) private readonly compat: CompatService) {}

  /** Public liveness + database check (Render health check). */
  @Get()
  async health() {
    const t = Date.now()
    await db.execute(sql`select 1`)
    return { ok: true, version: VERSION, commit: COMMIT, seed: SEED_VERSION, db: { ok: true, ms: Date.now() - t }, modules: { native: NATIVE_CONTROLLERS.length, compatRoutes: this.compat.size }, uptime: Math.round(process.uptime()) }
  }
}

@Module({ controllers: [...NATIVE_CONTROLLERS, HealthController] })
class NativeModule {}

/** Last, so its catch-all only sees what no native controller handles. */
@Module({ controllers: [CompatController] })
class CompatModule {}

@Module({ imports: [CoreModule, NativeModule, CompatModule] })
export class AppModule {}
