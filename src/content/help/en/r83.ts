import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

/** R8.3 article: the statutory reminder schedule and the standing report deliveries. */
export default {
  "reminders-and-delivery": {
    title: "Reminders and report delivery",
    summary: "Decide how many days ahead each statutory deadline is reminded, and which standing reports reach whom on their own schedule — the VAT digest monthly, the receivables digest weekly.",
    keywords: ["reminders", "schedule", "deadline", "notification", "bell", "cron", "tick", "vat digest", "receivables digest", "delivery", "report", "monthly", "weekly", "recipients", "9.1", "tr-6", "vds", "lead time"],
    body: [
      h("What the schedule does"),
      p("Three statutory deadlines recur every month: the **Mushak 9.1 return** itself (due the 15th, or the next working day), the **treasury deposit (TR-6)** that has to precede it, and the **VDS certificates (Mushak 6.6)** the period's purchases still owe. The reminder settings say how many days ahead each is reminded — and once a lead time arrives, its reminder is stored and takes over that deadline in the notification bell, so it stays until it is read or its subject is gone (the return is filed, the certificates issued)."),
      p("Beside the reminders, delivery schedules carry the standing reports: the **VAT digest** (the 9.1 figures of the month just closed, frozen at delivery time) and the **receivables digest** (every open customer invoice, aged the way the party statements age them, plus the top debtors). Each delivery is logged with the very figures the recipients saw — a past report can be re-printed exactly as it arrived."),
      h("Setting the lead times"),
      steps(
        "Open [Reminders & report delivery](/master/schedule). The three deadline cards show the current settings.",
        "Tick a deadline on or off and set its **lead times in days** — `14, 7, 1` reads as two weeks out, one week out and the day before. Each lead time fires its own reminder, so an approaching deadline escalates.",
        "Save. Everyone who files or reviews returns sees the reminders in their notification bell.",
      ),
      note("Until the first lead time fires, the calendar's own three-week window keeps showing the deadline — a default installation behaves exactly as before the schedule existed."),
      h("Scheduling a report"),
      steps(
        "Under **Report delivery**, choose **New schedule**.",
        "Pick the report, the cadence (monthly on a day of the month, or weekly on a weekday) and the recipients.",
        "Save. The register shows when it next runs; a schedule can be paused (Active off) or deleted at any time.",
      ),
      table(["Report", "Cadence", "What it carries"],
        ["VAT digest", "Monthly, day of the month", "Output VAT, input credit, net and payable, deposits, shortfall and closing balance of the month just closed — plus the TR-6 deposits and VDS certificates on record"],
        ["Receivables digest", "Weekly, weekday", "Open customer invoices and their total, the ageing buckets, customer advances and the top debtors"],
      ),
      h("Running the day"),
      p("**Run now** fires the reminders whose lead time has arrived and delivers the reports whose day has come. It is the same tick a cron line performs once a day in production —"),
      list(
        "`5 1 * * * curl -X POST -H \"Authorization: Bearer …\" https://…/api/v1/schedule/tick` (07:00 Asia/Dhaka),",
        "idempotent per day: a reminder is keyed by its deadline, due date and lead time, a delivery by its schedule and day, so running it twice — or after the cron already ran — changes nothing.",
      ),
      p("Recipients see a delivery notification in their bell, and the log keeps every delivered report with its figures. Downloads are CSV; the printable HTML re-prints the frozen document."),
      warn("A delivered report is a snapshot, not a live view: it shows the books as they stood when the tick ran, which is the point — what the recipient saw then is what the log can prove now."),
      tip("Related: [The monthly VAT return](help:vat-return-9-1), [Treasury deposits (TR-6)](help:treasury-tr6), [VDS certificates](help:vds-certificates), [Navigation and notifications](help:navigation)."),
    ],
  },
} satisfies Record<string, ArticleText>
