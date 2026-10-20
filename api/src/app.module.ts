import { Controller, Get, Global, Inject, Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { sql } from "drizzle-orm"
import { ACCESS_LOGGER, AuthGuard, SessionService } from "./common/auth"
import { db } from "./db/client"
import { AccountingConfigController, AccountingConfigService, AccountTransfersController, AssetClassService, AssetClassesController, AssetService, AssetsController, BalanceSheetController, BankStatementsController, BankStatementsService, CashFlowController, ChartController, ChequesController, ChequeEventsService, CloseController, JournalController, JournalService, LedgerController, MoneyAccountsController, MoneyAccountsService, MoneyDocsService, OpenInvoicesController, PaymentsController, ProfitLossController, ReceiptsController, StatementController, TransfersService, TrialBalanceController } from "./modules/accounting"
import { AuditController, AuditService } from "./modules/audit"
import { BackupsController, BackupsService } from "./modules/backups"
import { ScheduleController, ScheduleService } from "./modules/schedule"
import { BatchesController, BatchesService } from "./modules/batches"
import { DerivedService, ItemLedgerController, LotsController, StockController, SubcontractController } from "./modules/derived"
import { AuthController, MeController, UsersController, UsersService } from "./modules/identity"
import { CustomersController, PartiesService, VendorsController } from "./modules/parties"
import { ItemsController, ItemsService, MasterItemsController } from "./modules/items"
import { DamageController, StockService, TransfersController } from "./modules/stock"
import { CreditNotesController, DebitNotesController, NotesService } from "./modules/notes"
import { OpeningsController, OpeningsService } from "./modules/openings"
import { BomsController, BomsService, ProductionConfigController, ProductionConfigService } from "./modules/production"
import { PurchasesController, PurchasesService } from "./modules/purchases"
import { SalesController, VerifyController, SalesService } from "./modules/sales"
import { WorkOrdersController, WorkOrdersService } from "./modules/workorders"
import { CompanyController, TariffController, UnitsController, UnitsService } from "./modules/reference"
import { UdFitController, UdsController, UdsService } from "./modules/uds"
import { BondUdsController, BondUdsService } from "./modules/bonduds"
import { LateFilingsController, ReturnAmendmentsController, ReturnAppsService } from "./modules/returnapps"
import { PrcBatchesController, ProceedsController, ProceedsService } from "./modules/proceeds"
import { ClaimsService, DrawbackClaimsController } from "./modules/claims"
import { BondController, ExportsController, PenaltyController, RegistersService, SdEligibleController } from "./modules/registers"
import { AdjustmentsController, AdjustmentsService, TreasuryController, TreasuryService, VdsController, VdsEligibleController, VdsService } from "./modules/vat"
import { ComplianceController, PeriodsController, ReturnSubFormController, ReturnsController, ReturnsService, VatSettingsController } from "./modules/returns"
import { BooksService, DashboardController, ImportController, MushakController, NotificationsController, SaleServicesController, SearchController, ServicesController } from "./modules/books"
import { PosController, PosService } from "./modules/pos"
import { SEED_VERSION } from "./boot"

export const VERSION = "0.20.0"
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
  BankStatementsController,
  // R9.1: the transfers between the company's own accounts, and the cheque register with its lifecycle actions
  AccountTransfersController, ChequesController,
  // R9.2: the general ledger — the chart, the journal register with the manual JE- documents, the account ledger
  ChartController, JournalController, LedgerController,
  // R9.3/R9.4: the statements, the close, and the fixed assets
  TrialBalanceController, ProfitLossController, BalanceSheetController, CashFlowController, CloseController,
  AssetsController, AssetClassesController,
  // R8.3: the reminder and delivery schedule — settings, schedules, log, documents, the tick
  ScheduleController,
  StockController, ItemLedgerController, LotsController, SubcontractController,
  SalesController, VerifyController,
  // `vat/vds/eligible` is registered before `vat/vds/:id`: Express matches a dynamic segment first otherwise, and
  // "eligible" would be read as a certificate number
  TreasuryController, VdsEligibleController, VdsController, AdjustmentsController,
  // the return: `vat/returns/:period/notes/:note` after the return's own routes, and the periods, the compliance
  // centre and the NBR settings last
  ReturnsController, ReturnSubFormController, PeriodsController, ComplianceController, VatSettingsController,
  // R6.2: the exporters' declarations. `vat/uds/fit` is registered before `vat/uds/:id`: Express matches a dynamic
  // segment first otherwise, and "fit" would be read as a declaration id
  UdFitController, UdsController,
  // R6.5: our own UDs / UP with their bond settlement. `vat/bond-uds/:id/settle` cannot be mistaken for an id —
  // it carries one more segment — so one controller holds the four endpoints
  BondUdsController,
  LateFilingsController,
  ReturnAmendmentsController,
  // R6.6 (proceeds): the register + matcher, and the bank-file batches with their reversal
  ProceedsController, PrcBatchesController,
  // R6.5's second half (drawback claims): the DEDO register with its action steps
  DrawbackClaimsController, BondController, ExportsController, PenaltyController, SdEligibleController,
  // the readers: the Mushak books, the dashboard, the search, the notifications, the service codes and the bulk
  // import — nothing among them stores a row of its own
  MushakController, DashboardController, SearchController, NotificationsController,
  ServicesController, SaleServicesController, ImportController,
  // R10: POS integration (counter POS, shifts X/Z, terminal settlement reconciliation, external API, labels)
  PosController,
]

@Global()
@Module({
  providers: [
    SessionService, AuditService, UsersService, UnitsService, PartiesService, ItemsService, StockService, SalesService,
    PurchasesService, NotesService, OpeningsService, BatchesService, BomsService, ProductionConfigService,
    WorkOrdersService, MoneyAccountsService, MoneyDocsService, BankStatementsService, AccountingConfigService,
    TreasuryService, VdsService, AdjustmentsService, ReturnsService, BooksService, DerivedService, BackupsService, ScheduleService, UdsService, BondUdsService, ReturnAppsService, ProceedsService, ClaimsService, RegistersService,
    TransfersService, ChequeEventsService, JournalService, AssetService, AssetClassService, PosService, { provide: ACCESS_LOGGER, useExisting: AuditService }, { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    SessionService, AuditService, UsersService, UnitsService, PartiesService, ItemsService, StockService, SalesService,
    PurchasesService, NotesService, OpeningsService, BatchesService, BomsService, ProductionConfigService,
    WorkOrdersService, MoneyAccountsService, MoneyDocsService, BankStatementsService, AccountingConfigService,
    TreasuryService, VdsService, AdjustmentsService, ReturnsService, BooksService, DerivedService, BackupsService, ScheduleService,
    UdsService, BondUdsService, ReturnAppsService, ProceedsService, ClaimsService, RegistersService,
    TransfersService, ChequeEventsService, JournalService, AssetService, AssetClassService, PosService,
  ],
})
class CoreModule {}

/** Git commit of the running build: Render sets RENDER_GIT_COMMIT at runtime; the Docker image bakes GIT_COMMIT
 *  (CI build-arg). The deploy pipeline waits until the live health reports the commit it just tested. */
const COMMIT = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim() || null

@Controller("api/v1/health")
class HealthController {
  /** Public liveness + database check (Render health check). */
  @Get()
  async health() {
    const t = Date.now()
    await db.execute(sql`select 1`)
    // compatRoutes stays in the shape at 0: the compat route table itself went native in R6.7, and its
    // snapshot followed in the finale — there is no compat fallback layer to count any more
    return { ok: true, version: VERSION, commit: COMMIT, seed: SEED_VERSION, db: { ok: true, ms: Date.now() - t }, modules: { native: NATIVE_CONTROLLERS.length, compatRoutes: 0 }, uptime: Math.round(process.uptime()) }
  }
}

@Module({ controllers: [...NATIVE_CONTROLLERS, HealthController] })
class NativeModule {}

/** Last, so its catch-all only sees what no native controller handles. */
@Module({ imports: [CoreModule, NativeModule] })
export class AppModule {}
