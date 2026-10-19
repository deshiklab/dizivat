"""R9.1 end-to-end checks (treasury): transfers between the company's own accounts — the register, the draft →
approve → cancel lifecycle, the balances every page derives moving with it (and back), the pair-of-accounts lock,
the closed-books rule — and the cheque register: the derived rows (received / issued), the post-dated view, the
present → clear and bounce lifecycle with its rules, the notification a bounce rings, the audit trail, CSV
exports, role gating and Bangla. Run on a fresh server (it creates documents)."""
import asyncio
import datetime, os, re, sys
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
os.makedirs(OUT, exist_ok=True)
API = BASE + "/api/v1"
TODAY = "2026-09-25"
results, failures = [], []
def ok(m): results.append(("PASS", m)); print("PASS", m)
def fail(section, e):
    import traceback
    msg = f"section {section}: {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"
    failures.append(msg); print("FAIL", msg); traceback.print_exc(limit=1)
def watch(pg, errs):
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)[:200]))
    pg.on("console", lambda m: errs.append(m.text[:240]) if m.type == "error" else None)
VP = {"width": 1440, "height": 900}
# the demo data set is authored around September 2026; the API's "today" is the runner's real clock.
# Every derived read below pins its window to the demo's month-end; the default-date checks use the clock.
ASOF = "2026-09-30"
REAL_TODAY = datetime.date.today().isoformat()

async def settle(pg):
    await pg.wait_for_timeout(60)
    await pg.evaluate("Promise.race([Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1500))])")
    await pg.wait_for_timeout(100)

def is_json(r): return r.headers.get("content-type", "").startswith(("application/json", "application/problem"))
async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def post(ctx, path, data):
    r = await ctx.request.post(API + path, data=data); return r.status, (await r.json() if is_json(r) else None)
async def put(ctx, path, data):
    r = await ctx.request.put(API + path, data=data); return r.status, (await r.json() if is_json(r) else None)
async def patch(ctx, path, data):
    r = await ctx.request.patch(API + path, data=data); return r.status, (await r.json() if is_json(r) else None)
async def del_(ctx, path):
    r = await ctx.request.delete(API + path); return r.status, (await r.json() if is_json(r) else None)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP)
        admin = await login_ctx(b, "admin", viewport=VP)
        oper = await login_ctx(b, "kamal", viewport=VP)
        view = await login_ctx(b, "auditor", viewport=VP)
        pg = await appr.new_page(); watch(pg, errs)

        # ── 1. The transfers register and its seeded demo ────────────
        try:
            tx = await jget(appr, "/accounting/transfers?size=20")
            assert tx["total"] >= 3, tx["total"]
            seeded = {t["no"]: t for t in tx["data"]}
            assert "TX-09260001" in seeded and "TX-09260002" in seeded, list(seeded)
            assert seeded["TX-09260001"]["process"] == "Approved" and seeded["TX-09260001"]["fromAccount"].startswith("Cash in hand")
            assert seeded["TX-09260002"]["charge"] == 250 and seeded["TX-09260003"]["process"] == "Created"
            assert tx["totals"]["amount"] == sum(t["amount"] for t in tx["data"]) and "fromAccount" in tx["facets"], tx["facets"].keys()
            ok("transfers register: the seeded demo (deposit, withdrawal with charge, draft top-up) with facets and totals")
            one = await jget(appr, f"/accounting/transfers/{seeded['TX-09260002']['id']}")
            assert one["toAccount"].startswith("Cash in hand") and one["history"], one
            ok("one transfer by id: the document with its history")
        except Exception as e: fail(1, e)

        # ── 2. A transfer moves both derived balances — and back ─────
        try:
            accts = {a["id"]: a for a in (await jget(appr, "/accounting/accounts?size=20"))["data"]}
            before = {i: accts[i]["balance"] for i in ("ac2", "ac4")}
            st, d = await post(appr, "/accounting/transfers", {"process": "Approved", "date": "2026-09-22", "fromAccountId": "ac2", "toAccountId": "ac4", "amount": 250000, "charge": 550, "reference": "E2E-TX-A", "note": "e2e: wallet top-up"})
            assert st == 201 and d["no"].startswith("TX-0926") and d["process"] == "Approved", (st, d)
            accts = {a["id"]: a for a in (await jget(appr, "/accounting/accounts?size=20"))["data"]}
            assert abs(accts["ac4"]["balance"] - (before["ac4"] + 250000)) < 0.005, (before, accts["ac4"])
            assert abs(accts["ac2"]["balance"] - (before["ac2"] - 250550)) < 0.005, (before, accts["ac2"])
            ok(f"approved {d['no']}: ac4 +250000 / ac2 −250550 — the charge leaves one side without reaching the other")
            st, d2 = await patch(appr, f"/accounting/transfers/{d['id']}", {"process": "Cancelled", "reason": "e2e: wrong account pair, redoing"})
            assert st == 200 and d2["process"] == "Cancelled" and d2["cancelReason"], (st, d2)
            accts = {a["id"]: a for a in (await jget(appr, "/accounting/accounts?size=20"))["data"]}
            assert abs(accts["ac4"]["balance"] - before["ac4"]) < 0.005 and abs(accts["ac2"]["balance"] - before["ac2"]) < 0.005
            ok("cancelling restores both balances")
        except Exception as e: fail(2, e)

        # ── 3. The rules: pair lock, same account, drafts, delete ────
        try:
            st, draft = await post(appr, "/accounting/transfers", {"process": "Created", "date": "2026-09-23", "fromAccountId": "ac1", "toAccountId": "ac3", "amount": 4200})
            assert st == 201 and draft["process"] == "Created", (st, draft)
            st, d = await put(appr, f"/accounting/transfers/{draft['id']}", {"process": "Created", "date": "2026-09-23", "fromAccountId": "ac3", "toAccountId": "ac1", "amount": 4200})
            assert st == 409, (st, d)
            st, d = await put(appr, f"/accounting/transfers/{draft['id']}", {"process": "Approved", "date": "2026-09-23", "fromAccountId": "ac1", "toAccountId": "ac3", "amount": 4300})
            assert st == 200 and d["amount"] == 4300 and d["process"] == "Approved", (st, d)
            st, d = await post(appr, "/accounting/transfers", {"process": "Created", "date": "2026-09-23", "fromAccountId": "ac1", "toAccountId": "ac1", "amount": 10})
            assert st == 422 and d["errors"]["toAccountId"] == ["sameAccount"], (st, d)
            st, d = await del_(appr, f"/accounting/transfers/{draft['id']}")
            assert st == 409, (st, d)  # approved — cancel instead
            st, draft2 = await post(appr, "/accounting/transfers", {"process": "Created", "date": "2026-09-23", "fromAccountId": "ac5", "toAccountId": "ac4", "amount": 77})
            st, d = await del_(appr, f"/accounting/transfers/{draft2['id']}")
            assert st == 200, (st, d)
            gone = await jget(appr, f"/accounting/transfers?q={draft2['no']}")
            assert gone["total"] == 0
            ok("rules: pair locked on edit, same account 422, edit-and-approve, delete only drafts (id retired)")
        except Exception as e: fail(3, e)

        # ── 4. The register page ─────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/accounting/transfers", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Account transfers")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            row = pg.get_by_text("TX-09260001").first
            await expect(row).to_be_visible()
            await pg.get_by_role("button", name=re.compile("New transfer", re.I)).click()
            await expect(pg.locator("#fromAccountId")).to_be_visible()
            await pg.locator("#fromAccountId").click()
            await pg.get_by_role("option", name=re.compile("DUTCH-BANGLA")).first.click()
            await pg.locator("#toAccountId").click()
            await pg.get_by_role("option", name=re.compile("BRAC BANK")).first.click()
            await pg.locator("#amount").fill("1000")
            await expect(pg.get_by_text("Where it lands")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/91_transfers_form.png")
            await pg.get_by_role("button", name="Cancel").last.click()
            await settle(pg)
            await row.click()
            await expect(pg.get_by_text("TX-09260001").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/91_transfers_sheet.png")
            csv = await (await appr.request.get(API + "/accounting/transfers?format=csv")).text()
            assert "Transfer No" in csv[:80] and "TX-09260001" in csv
            ok("transfers page: register, new-transfer form with the lands-as summary, sheet, CSV")
        except Exception as e: fail(4, e)

        # ── 5. The cheque register and its lifecycle ─────────────────
        try:
            reg = await jget(appr, "/accounting/cheques?size=30")
            assert reg["total"] >= 5, reg["total"]
            kinds = {r["kind"] for r in reg["data"]}
            assert kinds == {"issued", "received"}, kinds
            statuses = {r["status"] for r in reg["data"]}
            assert "bounced" in statuses and "cleared" in statuses and "presented" in statuses and "outstanding" in statuses, statuses
            bounced = next(r for r in reg["data"] if r["status"] == "bounced")
            assert bounced["reason"] and bounced["bouncedOn"] and bounced["moneyNo"].startswith("MR-"), bounced
            cleared = next(r for r in reg["data"] if r["status"] == "cleared")
            assert cleared["presentedOn"] and cleared["clearedOn"] and cleared["moneyNo"].startswith("PV-"), cleared
            ok("cheque register derives: received/issued, all four statuses, reasons and dates folded from the events")
            # a post-dated instrument: a new cheque receipt dated after today, approved like any other
            st, pd_doc = await post(appr, "/accounting/receipts", {"partyId": "c5", "date": TODAY, "method": "cheque", "accountId": "ac1",
                "chequeNo": "E2E-PD-91001", "chequeDate": "2026-10-20", "chequeBank": "E2E BANK", "reference": "", "amount": 12345.67,
                "charge": 0, "allocations": [], "note": "e2e: post-dated instrument", "process": "Approved"})
            assert st == 201 and pd_doc["process"] == "Approved", (st, pd_doc)
            reg2 = await jget(appr, "/accounting/cheques?postDated=true")
            assert reg2["total"] >= 1 and all(r["postDated"] for r in reg2["data"]), reg2
            pd_row = next(r for r in reg2["data"] if r["no"] == "E2E-PD-91001")
            assert pd_row["kind"] == "received" and pd_row["status"] == "outstanding"
            # present → clear on an outstanding one; the rules refuse the rest
            open_ = next(r for r in reg["data"] if r["status"] == "outstanding" and r["kind"] == "issued" and not r["postDated"])
            st, d = await post(appr, f"/accounting/cheques/{open_['id']}/action", {"action": "cleared", "date": TODAY})
            assert st == 409, (st, d)
            st, d = await post(appr, f"/accounting/cheques/{open_['id']}/action", {"action": "presented", "date": open_["chequeDate"]})
            assert st == 201 and d["status"] == "presented" and d["presentedOn"] == open_["chequeDate"], (st, d)
            st, d = await post(appr, f"/accounting/cheques/{open_['id']}/action", {"action": "cleared", "date": TODAY})
            assert st == 201 and d["status"] == "cleared" and d["clearedOn"] == TODAY, (st, d)
            st, d = await post(appr, f"/accounting/cheques/{open_['id']}/action", {"action": "bounced", "date": TODAY, "reason": "Refer to drawer — e2e"})
            assert st == 409, (st, d)  # cleared is final
            other = next(r for r in reg["data"] if r["status"] == "outstanding" and r["id"] != open_["id"] and not r["postDated"])
            st, d = await post(appr, f"/accounting/cheques/{other['id']}/action", {"action": "bounced", "date": TODAY, "reason": "short"})
            assert st == 422 and d["errors"]["reason"] == ["required"], (st, d)
            st, d = await post(appr, f"/accounting/cheques/{pd_row['id']}/action", {"action": "presented", "date": TODAY})
            assert st == 422 and d["errors"]["date"] == ["beforeChequeDate"], (st, d)
            ok("lifecycle: clear needs a presentation; present→clear works; final is final; bounce needs a ≥10-char reason; a post-dated cheque refuses to be presented early")
        except Exception as e: fail(5, e)

        # ── 6. The bounce rings the bell, the audit sees it all ──────
        try:
            bells = await jget(admin, "/notifications")
            hit = next((n for n in bells["items"] if n["id"] == f"cheque:{bounced['id']}"), None)
            assert hit and hit["msg"] == "chequeBounced" and hit["values"]["no"] == bounced["no"] and hit["tone"] == "danger", hit
            assert hit["href"] == "/accounting/cheques"
            audit = await jget(admin, "/audit?entity=cheque&size=10")
            assert audit["total"] >= 2 and {e["action"] for e in audit["data"]} >= {"presented", "cleared"}, audit["data"]
            taudit = await jget(admin, "/audit?entity=moneyTransfer&size=10")
            assert taudit["total"] >= 3 and {e["action"] for e in taudit["data"]} >= {"created", "approved", "cancelled"}, taudit["data"]
            ok("the bounced cheque rings the bell; the audit trail carries the transfer and cheque lifecycles")
        except Exception as e: fail(6, e)

        # ── 7. The register page + post-dated view + Bangla ──────────
        try:
            await pg.goto(BASE + "/en/accounting/cheques", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Cheque register")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/91_cheques.png")
            pd = await jget(appr, "/accounting/cheques?postDated=true")
            assert pd["total"] >= 1 and all(r["postDated"] for r in pd["data"]), pd
            await pg.locator("tbody tr").first.click()
            await expect(pg.get_by_text("Lifecycle")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/91_cheque_sheet.png")
            csv = await (await appr.request.get(API + "/accounting/cheques?format=csv")).text()
            assert "Cheque No" in csv[:60] and "Status" in csv and "Bounced on" in csv
            bn = await login_ctx(b, "admin", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            await bp.goto(BASE + "/bn/accounting/cheques", wait_until="networkidle"); await bp.wait_for_timeout(400)
            await bp.goto(BASE + "/bn/accounting/transfers", wait_until="networkidle"); await bp.wait_for_timeout(400)
            await settle(bp); await bp.screenshot(path=f"{OUT}/91_cheques_bn.png")
            await bn.close()
            ok("cheque page: register, sheet with the lifecycle timeline, post-dated view, CSV, Bangla")
        except Exception as e: fail(7, e)

        # ── 8. Role gating ───────────────────────────────────────────
        try:
            st, _ = await post(view, "/accounting/transfers", {"process": "Created", "date": TODAY, "fromAccountId": "ac1", "toAccountId": "ac2", "amount": 1})
            assert st == 403, st
            st, _ = await post(view, f"/accounting/cheques/{bounced['id']}/action", {"action": "presented", "date": TODAY})
            assert st == 403, st
            r = await oper.request.get(API + "/accounting/cheques")
            assert r.status == 200  # reading is for everyone signed in
            ok("role gating: the viewer can neither create a transfer nor act on a cheque; reading is open")
        except Exception as e: fail(8, e)

        # ── 9. R9.2: the chart of accounts and the trial balance ────
        je_made = None
        try:
            chart = await jget(appr, "/accounting/chart")
            assert len(chart) >= 35, len(chart)
            by_code = {a["code"]: a for a in chart}
            assert by_code["1100"]["name"] == "Accounts receivable" and by_code["1100"]["entries"] > 0
            assert by_code["2110"]["name"] == "VAT payable" and by_code["5950"]["group"] == "Tax costs"
            banks = [a for a in chart if a["code"].startswith("1020.")]
            assert banks and all(a["moneyAccountId"] for a in banks), banks[:2]
            # the keystone: every entry is balanced by construction, so the two sides of the chart agree
            dr = round(sum(a["debit"] for a in chart), 2); cr = round(sum(a["credit"] for a in chart), 2)
            assert abs(dr - cr) < 0.01 and dr > 1e8, (dr, cr)
            untouched = [a["code"] for a in chart if a["entries"] == 0 and "." not in a["code"]]
            assert "1210" in untouched and "5400" in untouched, untouched  # SD-on-imports and rent: the demo posts none
            seeded_manual = [a for a in chart if a["code"] in ("1300", "5500")]
            assert all(a["entries"] > 0 for a in seeded_manual), seeded_manual  # the seeded JEs post here
            ok(f"chart: {len(chart)} accounts, trial balance ৳{dr:,.2f} == ৳{cr:,.2f} to the poisha")
        except Exception as e: fail(9, e)

        # ── 10. R9.2: the journal register — derived + manual, one fold ─
        try:
            jr = await jget(appr, "/accounting/journal?size=1")
            assert jr["total"] >= 400 and jr["totals"]["debit"] == jr["totals"]["credit"], (jr["total"], jr["totals"])
            assert set(jr["facets"]["source"].keys()) >= {"sale", "purchase", "receipt", "payment", "treasury", "vdsPurchase", "vdsSales", "adjustment", "opening", "openingBalance", "creditNote", "debitNote", "transfer", "manual"}, jr["facets"]["source"].keys()
            manual = await jget(appr, "/accounting/journal?source=manual")
            assert manual["total"] == 2 and {r["no"] for r in manual["data"]} == {"JE-08260001", "JE-09260001"}, manual["data"]
            rent = next(r for r in manual["data"] if r["no"] == "JE-08260001")
            assert rent["debit"] == 450000 and rent["process"] == "Approved" and "1300" in rent["accounts"]
            ar = await jget(appr, "/accounting/journal?account=1100&size=500")
            assert ar["total"] > 100 and all("1100" in r["accounts"] for r in ar["data"]), ar["total"]
            csv = await (await appr.request.get(API + "/accounting/journal?format=csv&size=5")).text()
            assert csv.lstrip("\ufeff").splitlines()[0].startswith("Date,Entry,Memo,Source"), csv[:80]
            ok(f"journal register: {jr['total']} postings, every source kind present, manual JEs, account filter, CSV")
        except Exception as e: fail(10, e)

        # ── 11. R9.2: the manual JE lifecycle and its rules ───────────
        try:
            bad_lines = [{"account": "5500", "debit": 100}, {"account": "2200", "credit": 90}]
            st, _ = await post(appr, "/accounting/journal", {"date": TODAY, "memo": "Not balanced", "lines": bad_lines, "process": "Created"})
            assert st == 422, st
            st, _ = await post(appr, "/accounting/journal", {"date": TODAY, "memo": "Unknown account", "lines": [{"account": "9999", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 422, st
            st, _ = await post(appr, "/accounting/journal", {"date": TODAY, "memo": "Both sides on one line", "lines": [{"account": "5500", "debit": 1, "credit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 422, st
            st, _ = await post(appr, "/accounting/journal", {"date": "2026-06-15", "memo": "Books are closed", "lines": [{"account": "5500", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 422, st
            st, _ = await post(appr, "/accounting/journal", {"date": "2026-10-15", "memo": "From the future", "lines": [{"account": "5500", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 422, st
            # a draft posts nothing; approving posts it; cancelling takes it back out
            before = (await jget(appr, "/accounting/chart")); dr0 = round(sum(a["debit"] for a in before), 2)
            st, made = await post(appr, "/accounting/journal", {"date": "2026-09-20", "memo": "Audit fee accrual for the year", "lines": [{"account": "5600", "debit": 150000}, {"account": "2200", "credit": 150000}], "process": "Created"})
            assert st == 201 and made["process"] == "Created" and made["no"].startswith("JE-09"), (st, made)
            je_made = made
            assert (await jget(appr, "/accounting/journal?q=Audit fee accrual"))["total"] == 0  # drafts post nothing
            st, app_ = await patch(appr, f"/accounting/journal/{made['id']}", {"process": "Approved"})
            assert st == 200 and app_["process"] == "Approved"
            posted = (await jget(appr, "/accounting/journal?q=Audit fee accrual"))
            assert posted["total"] == 1 and posted["data"][0]["debit"] == 150000
            during = await jget(appr, "/accounting/chart")
            assert round(sum(a["debit"] for a in during), 2) == round(dr0 + 150000, 2)  # the trial balance grew by exactly the entry
            # an edit is refused past the draft; cancel with a reason takes it out
            st, _ = await put(appr, f"/accounting/journal/{made['id']}", {"date": "2026-09-20", "memo": "x", "lines": [{"account": "5500", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 409, st
            st, canc = await patch(appr, f"/accounting/journal/{made['id']}", {"process": "Cancelled", "reason": "The auditor billed less — a smaller accrual follows."})
            assert st == 200 and canc["process"] == "Cancelled"
            assert (await jget(appr, "/accounting/journal?q=Audit fee accrual"))["total"] == 0
            after = await jget(appr, "/accounting/chart")
            assert round(sum(a["debit"] for a in after), 2) == dr0
            # a second draft edits, then deletes — the JE- series never repeats
            st, two = await post(appr, "/accounting/journal", {"date": "2026-09-21", "memo": "A draft to edit and delete", "lines": [{"account": "5500", "debit": 500}, {"account": "2200", "credit": 500}], "process": "Created"})
            assert st == 201, st
            st, edited = await put(appr, f"/accounting/journal/{two['id']}", {"date": "2026-09-21", "memo": "A draft, edited", "lines": [{"account": "5500", "debit": 600}, {"account": "2200", "credit": 600}], "process": "Created"})
            assert st == 200 and edited["memo"] == "A draft, edited" and edited["lines"][0]["debit"] == 600, edited
            st, _ = await del_(appr, f"/accounting/journal/{two['id']}")
            assert st == 200
            st, _ = await patch(appr, f"/accounting/journal/{made['id']}", {"process": "Cancelled", "reason": "already cancelled, refuse"})
            assert st == 409, st
            # the audit trail saw it all
            aud = await jget(appr, "/audit?entity=journal&size=10")
            assert aud["total"] >= 4, aud["total"]
            ok("manual JE: 5 refused bodies, draft→approve (+৳150,000 on the trial balance)→cancel (−৳150,000), edit, delete, audit")
        except Exception as e: fail(11, e)

        # ── 12. R9.2: one account's ledger ────────────────────────────
        try:
            led = await jget(appr, "/accounting/ledger?account=1100")
            assert led["account"]["code"] == "1100" and led["rows"], led["account"]
            assert abs(led["closing"] - led["rows"][-1]["balance"]) < 0.01
            # the receivable is an asset: closing = opening + the movements (the signed running balance)
            assert abs((led["opening"] + sum(r["debit"] - r["credit"] for r in led["rows"])) - led["closing"]) < 0.01, (led["opening"], led["closing"])
            # a window: the opening is what moved before `from`, the closing carries it forward
            w = await jget(appr, "/accounting/ledger?account=1100&from=2026-09-01&to=2026-09-30")
            assert w["from"] == "2026-09-01" and all("2026-09-01" <= r["date"] <= "2026-09-30" for r in w["rows"])
            chart = await jget(appr, "/accounting/chart")
            ar = next(a for a in chart if a["code"] == "1100")
            assert abs(led["closing"] - ar["balance"]) < 0.01, (led["closing"], ar["balance"])  # the ledger and the chart agree
            r404 = await appr.request.get(API + "/accounting/ledger?account=9999")
            assert r404.status == 404
            r422 = await appr.request.get(API + "/accounting/ledger")
            assert r422.status == 422
            ok("ledger: opening → movements → closing, window bounds, agrees with the chart, 404/422")
        except Exception as e: fail(12, e)

        # ── 13. R9.2: the pages — chart, journal, ledger, Bangla ──────
        try:
            await pg.goto(BASE + "/en/accounting/chart", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Chart of accounts")).to_be_visible()
            await expect(pg.get_by_text("Trial balance")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/92_chart.png")
            await pg.goto(BASE + "/en/accounting/journal", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Journal")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            # open a seeded manual entry — the sheet shows the lines and the history
            seeded = await jget(appr, "/accounting/journal?source=manual&size=1")
            await pg.goto(BASE + f"/en/accounting/journal?view={seeded['data'][0]['id']}", wait_until="networkidle")
            await expect(pg.get_by_text("Recorded by")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/92_journal_sheet.png")
            await pg.goto(BASE + "/en/accounting/ledger?account=2110", wait_until="networkidle")
            await expect(pg.get_by_text("VAT payable").first).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/92_ledger.png")
            bn = await login_ctx(b, "admin", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            for path in ("/bn/accounting/chart", "/bn/accounting/journal", "/bn/accounting/ledger?account=1100"):
                await bp.goto(BASE + path, wait_until="networkidle"); await bp.wait_for_timeout(300)
            await settle(bp); await bp.screenshot(path=f"{OUT}/92_gl_bn.png")
            await bn.close()
            st, _ = await post(view, "/accounting/journal", {"date": TODAY, "memo": "Viewer may not", "lines": [{"account": "5500", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 403, st
            assert je_made and je_made["no"].startswith("JE-")
            ok("pages: chart with the trial-balance foot, journal + manual sheet, ledger, Bangla, role gating")
        except Exception as e: fail(13, e)

        # ── 14. R9.3: the statements and the close ────────────────────
        try:
            # pinned past the seeded 09-30 accrual (dated after the demo's clock) — the chart folds the whole
            # journal, so the tie needs an asOf that sees every entry; the default-date reads are checked below
            tb = await jget(appr, f"/accounting/reports/trial-balance?asOf={ASOF}")
            assert tb["rows"] and abs(tb["totals"]["debit"] - tb["totals"]["credit"]) < 0.005, tb["totals"]
            chart = await jget(appr, "/accounting/chart")
            foot = round(sum(max(a["debit"] - a["credit"], 0) for a in chart), 2)
            assert abs(tb["totals"]["debit"] - foot) < 0.01, (tb["totals"], foot)  # the trial balance is the chart's net-side foot
            tb2 = await jget(appr, "/accounting/reports/trial-balance?asOf=2025-12-31")
            assert tb2["totals"]["debit"] < tb["totals"]["debit"] and tb2["asOf"] == "2025-12-31"
            pl = await jget(appr, "/accounting/reports/profit-loss?from=2026-07-01&to=2026-09-25")
            assert pl["revenueTotal"] > 0 and pl["revenue"] and pl["direct"]
            assert abs(pl["grossProfit"] - round(pl["revenueTotal"] - pl["directTotal"], 2)) < 0.01
            assert abs(pl["netProfit"] - round(pl["revenueTotal"] - pl["directTotal"] - pl["operatingTotal"] - pl["taxTotal"], 2)) < 0.01
            pl_default = await jget(appr, "/accounting/reports/profit-loss")
            # the fiscal year to date (July–June) — the mock anchors the demo to its authored day, the native
            # serves the runner's clock, and the suite must read the same either way
            assert pl_default["from"] == "2026-07-01" and pl_default["to"] in (TODAY, REAL_TODAY), pl_default
            bs = await jget(appr, "/accounting/reports/balance-sheet")
            assert abs(bs["totals"]["assets"] - bs["totals"]["liabilitiesAndEquity"]) < 0.01, bs["totals"]
            pl30 = await jget(appr, f"/accounting/reports/profit-loss?from=2026-07-01&to={ASOF}")
            bs30 = await jget(appr, f"/accounting/reports/balance-sheet?asOf={ASOF}")
            assert abs(bs30["totals"]["profitForPeriod"] - pl30["netProfit"]) < 0.01, (bs30["totals"], pl30["netProfit"])
            fixed = next(x for x in bs["assets"] if x["group"] == "Fixed assets")
            assert any(r["code"] == "1500" for r in fixed["rows"]) and any(r["code"] == "1510" for r in fixed["rows"])
            eq_names = [r["name"] for x in bs["equity"] for r in x["rows"]]
            assert "Profit brought forward" in eq_names and "Profit for the period" in eq_names, eq_names
            cf = await jget(appr, "/accounting/reports/cash-flow?from=2026-07-01&to=2026-09-25")
            assert cf["rows"] and all("label" in r and "amount" in r for r in cf["rows"])
            assert abs(cf["closing"] - round(cf["opening"] + cf["netMovement"], 2)) < 0.01
            money_rows = [a for a in chart if a.get("moneyAccountId")]
            money_total = round(sum(a["balance"] for a in money_rows), 2)
            assert abs(cf["closing"] - money_total) < 0.01, (cf["closing"], money_total)  # ties to the money balances
            for path in ("trial-balance", "profit-loss", "balance-sheet", "cash-flow"):
                csv = await (await appr.request.get(API + f"/accounting/reports/{path}?format=csv")).text()
                assert csv.lstrip("\ufeff").splitlines()[0].split(",")[0] in ("Code", "Section", "Side", "Source"), path
            ok(f"statements: TB foot = chart foot, P&L groups, BS balances ({bs['totals']['assets']:,.0f}), CF ties to money balances, 4 CSVs")
        except Exception as e: fail(14, e)

        # ── 15. R9.3: the close of the books ──────────────────────────
        try:
            st, d = await post(admin, "/accounting/close", {"to": "2026-09-15"})
            assert st == 422 and d["errors"]["to"] == ["notMonthEnd"], (st, d)
            y, m = (datetime.date.today().year, datetime.date.today().month)
            next_me = (datetime.date(y + (m == 12), (m % 12) + 1, 1) - datetime.timedelta(days=1)).isoformat()
            st, d = await post(admin, "/accounting/close", {"to": next_me})
            assert st == 422 and d["errors"]["to"] == ["future"], (st, d)
            st, d = await post(admin, "/accounting/close", {"to": "2026-06-30"})
            assert st == 422 and d["errors"]["to"] == ["alreadyClosed"], (st, d)
            st, d = await post(view, "/accounting/close", {"to": "2026-07-31"})
            assert st == 403, st
            # a draft dated under the cut-off blocks the close, named — the drill's own July transfer
            st, blocker = await post(appr, "/accounting/transfers", {"process": "Created", "date": "2026-07-15", "fromAccountId": "ac1", "toAccountId": "ac3", "amount": 5000, "note": "e2e: blocks the July close"})
            assert st == 201, (st, blocker)
            st, d = await post(admin, "/accounting/close", {"to": "2026-07-31", "note": "should not pass"})
            assert st == 409 and blocker["no"] in d["title"], (st, d)
            st, _ = await del_(appr, f"/accounting/transfers/{blocker['id']}")
            assert st == 200, st
            # July is clear now — the close passes and the audit trail records it
            st, d = await post(admin, "/accounting/close", {"to": "2026-07-31", "note": "e2e: July close after the mid-year review"})
            assert st == 201 and d["closedUpTo"] == "2026-07-31" and d["updatedBy"], (st, d)
            cfg = await jget(appr, "/accounting/config")
            assert cfg["closedUpTo"] == "2026-07-31"
            # a closed month refuses a new document dated inside it
            st, d = await post(appr, "/accounting/journal", {"date": "2026-07-15", "memo": "Inside a closed month", "lines": [{"account": "5500", "debit": 1}, {"account": "2200", "credit": 1}], "process": "Created"})
            assert st == 422 and d["errors"]["date"] == ["dateClosed"], (st, d)
            aud = await jget(appr, "/audit?entity=accounting&size=5")
            assert aud["total"] >= 1 and aud["data"][0]["action"] == "closed", aud
            ok("close: 4 refused bodies, 409 naming the blocking drafts, July close (201) moves the cut-off, audit records it")
        except Exception as e: fail(15, e)

        # ── 16. R9.4: the register and the seeded assets ──────────────
        try:
            reg = await jget(appr, f"/accounting/assets?size=50&asOf={ASOF}")
            assert reg["total"] >= 8, reg["total"]
            rows = {r["no"]: r for r in reg["data"]}
            bld = rows["AS-07250001"]  # the factory building: 12 × 350,000, revalued to 45,000,000, then 3 × 375,000
            assert bld["className"] == "Factory building" and bld["rate"] == 10 and bld["cost"] == 42_000_000
            assert bld["accumDep"] == 5_325_000 and bld["nbv"] == 43_875_000 and bld["monthly"] == 375_000, bld
            sew = rows["AS-07250002"]
            assert sew["accumDep"] == 3_468_750 and sew["inputVat"] == 2_775_000 and sew["creditable"] is True
            draft = rows["AS-09260002"]
            assert draft["status"] == "Draft" and draft["accumDep"] == 0 and draft["nbv"] == draft["cost"] and draft["monthly"] == 0, draft
            disp = rows["AS-07250003"]
            assert disp["status"] == "Disposed" and disp["disposalProceeds"] == 3_550_000 and disp["gainLoss"] == 32_500 and disp["monthly"] == 0, disp
            sedan = rows["AS-11250001"]
            assert sedan["creditable"] is False  # VAT Act 2012 s.46(2)(a): no input credit on a passenger vehicle
            assert reg["totals"]["cost"] == sum(r["cost"] for r in reg["data"]) and "class" in reg["facets"]
            csv = await (await appr.request.get(API + "/accounting/assets?format=csv&size=5")).text()
            assert csv.lstrip("\ufeff").splitlines()[0].startswith("Commissioned,Asset,Name"), csv[:60]
            ok("register: the seeded assets with derived accum / NBV (building 43,875,000, disposal gain 32,500), facets, CSV")
        except Exception as e: fail(16, e)

        # ── 17. R9.4: the schedule, and the derived postings ──────────
        try:
            bld = (await jget(appr, f"/accounting/assets?q=Gazuria&asOf={ASOF}"))["data"][0]
            sched = await jget(appr, f"/accounting/assets/{bld['id']}/schedule?to={ASOF}")
            assert sched["rows"][0]["month"] == "2025-07" and sched["rows"][0]["depreciation"] == 350_000
            reval = next(r for r in sched["rows"] if r.get("event") == "revalued")
            assert reval["month"] == "2026-07" and reval["nbv"] == 45_000_000, reval
            assert sched["totals"]["depreciation"] == 5_325_000 and sched["rows"][-1]["month"] == "2026-09"
            half = await jget(appr, f"/accounting/assets/{bld['id']}/schedule?to=2026-06-30")
            assert half["totals"]["depreciation"] == 4_200_000 and not any(r.get("event") for r in half["rows"])
            # the derived postings: 1510 (a credit-balance contra) carries the active fleet's accumulation —
            # the disposed machine's was reversed by its own sale entry
            reg = await jget(appr, f"/accounting/assets?size=100&asOf={ASOF}")
            accum_total = round(sum(r["accumDep"] for r in reg["data"] if r["status"] == "Active"), 2)
            led = await jget(appr, f"/accounting/ledger?account=1510&to={ASOF}")
            assert abs(led["closing"] + accum_total) < 0.01, (led["closing"], accum_total)
            reserve = await jget(appr, f"/accounting/ledger?account=3950&to={ASOF}")
            assert abs(reserve["closing"] - 7_200_000) < 0.01, reserve["closing"]  # the building's revaluation surplus
            gain = await jget(appr, f"/accounting/ledger?account=4310&to={ASOF}")
            assert abs(gain["closing"] - 32_500) < 0.01, gain["closing"]  # the embroidery machine's disposal
            dep = await jget(appr, f"/accounting/journal?source=depreciation&size=500&to={ASOF}")
            assert dep["total"] >= 80 and all(r["sourceNo"].startswith("AS-") for r in dep["data"]), dep["total"]
            r404 = await appr.request.get(API + "/accounting/assets/nope/schedule")
            assert r404.status == 404
            ok("schedule: month walk with the revaluation month, ?to window, 1510 = register accum, 3950 = 7,200,000, 4310 = 32,500")
        except Exception as e: fail(17, e)

        # ── 18. R9.4: the lifecycle — draft, approve, dispose, revalue ─
        try:
            st, made = await post(appr, "/accounting/assets", {"name": "E2E boiler house pump", "classId": "plant", "date": "2026-09-22", "cost": 500_000, "salvage": 50_000, "memo": "e2e", "process": "Created"})
            assert st == 201 and made["process"] == "Created" and made["no"].startswith("AS-09"), (st, made)
            assert (await jget(appr, f"/accounting/journal?q=E2E boiler house pump&to={ASOF}"))["total"] == 0  # a draft posts nothing
            st, d = await post(appr, "/accounting/assets", {"name": "Salvage above cost", "classId": "plant", "date": "2026-09-22", "cost": 100, "salvage": 200, "process": "Created"})
            assert st == 422 and d["errors"]["salvage"] == ["belowCost"], (st, d)
            st, d = await post(appr, "/accounting/assets", {"name": "No such class", "classId": "nope", "date": "2026-09-22", "cost": 100, "process": "Created"})
            assert st == 422 and d["errors"]["classId"] == ["unknownClass"], (st, d)
            st, d = await post(appr, "/accounting/assets", {"name": "From the future", "classId": "plant", "date": "2026-10-05", "cost": 100, "process": "Created"})
            assert st == 422 and d["errors"]["date"] == ["future"], (st, d)
            st, d = await post(appr, "/accounting/assets", {"name": "Inside a closed month", "classId": "plant", "date": "2026-07-15", "cost": 100, "process": "Created"})
            assert st == 422 and d["errors"]["date"] == ["dateClosed"], (st, d)
            st, d = await put(appr, f"/accounting/assets/{made['id']}", {"name": "E2E boiler house pump", "classId": "plant", "date": "2026-09-22", "cost": 520_000, "salvage": 50_000, "process": "Created"})
            assert st == 200 and d["cost"] == 520_000, (st, d)
            st, d = await patch(appr, f"/accounting/assets/{made['id']}", {"process": "Approved"})
            assert st == 200 and d["process"] == "Approved"
            posted = await jget(appr, f"/accounting/journal?q=E2E boiler house pump&to={ASOF}")
            assert posted["total"] == 2, posted["total"]  # the acquisition + the first month's depreciation
            acq = next(r for r in posted["data"] if r["sourceKind"] == "asset")
            assert acq["debit"] == 520_000 and "1500" in acq["accounts"] and "3910" in acq["accounts"]
            st, _ = await put(appr, f"/accounting/assets/{made['id']}", {"name": "x", "classId": "plant", "date": "2026-09-22", "cost": 1, "process": "Created"})
            assert st == 409, st  # only drafts edit
            st, _ = await post(appr, f"/accounting/assets/{made['id']}/action", {"action": "dispose", "date": "2026-09-20", "proceeds": 1000, "reason": "Not commissioned yet"})
            assert st == 422, st  # before its commissioning date
            st, d = await patch(appr, f"/accounting/assets/{made['id']}", {"process": "Cancelled", "reason": "e2e: wrong pump, redoing"})
            assert st == 200 and d["process"] == "Cancelled"
            assert (await jget(appr, f"/accounting/journal?q=E2E boiler house pump&to={ASOF}"))["total"] == 0  # cancelled posts nothing
            # a second life: dispose one, revalue another
            st, two = await post(appr, "/accounting/assets", {"name": "E2E panel van", "classId": "vehicle", "date": "2026-08-01", "cost": 240_000, "process": "Approved"})
            assert st == 201 and two["process"] == "Approved", (st, two)
            st, three = await post(appr, "/accounting/assets", {"name": "E2E design studio fitout", "classId": "equipment", "date": "2026-08-05", "cost": 1_200_000, "process": "Approved"})
            assert st == 201, st
            st, d = await post(appr, f"/accounting/assets/{two['id']}/action", {"action": "dispose", "date": "2026-09-20", "proceeds": 250_000, "reason": "e2e: upgraded to a larger van"})
            assert st == 201 and d["disposal"]["proceeds"] == 250_000, (st, d)
            row = next(r for r in (await jget(appr, f"/accounting/assets?q=panel van&asOf={ASOF}"))["data"])
            assert row["status"] == "Disposed" and row["gainLoss"] == 12_000, row  # 250,000 − (240,000 − 1 × 2,000 dep; the sale month charges nothing) = 12,000
            st, _ = await post(appr, f"/accounting/assets/{two['id']}/action", {"action": "dispose", "date": "2026-09-21", "proceeds": 1, "reason": "Twice is once too often"})
            assert st == 409, st
            st, _ = await patch(appr, f"/accounting/assets/{two['id']}", {"process": "Cancelled", "reason": "A disposed asset stays as history"})
            assert st == 409, st
            st, d = await post(appr, f"/accounting/assets/{three['id']}/action", {"action": "revalue", "date": "2026-09-24", "toValue": 1_300_000, "reason": "e2e: valuer's report — fitout rates moved up"})
            assert st == 201 and d["revaluations"] and d["revaluations"][0]["toValue"] == 1_300_000, (st, d)
            row = next(r for r in (await jget(appr, f"/accounting/assets?q=fitout&asOf={ASOF}"))["data"])
            assert abs(row["nbv"] - 1_289_166.67) < 0.01 and abs(row["accumDep"] - 20_833.33) < 0.01, row
            # 10,000 for August, then 1,300,000 × 10% / 12 in the revaluation's month — the accum keeps counting
            st, _ = await post(appr, f"/accounting/assets/{three['id']}/action", {"action": "revalue", "date": "2026-09-25", "toValue": 1_100_000, "reason": "One revaluation a month is plenty"})
            assert st == 409, st
            aud = await jget(appr, "/audit?entity=asset&size=10")
            assert aud["total"] >= 5, aud["total"]
            ok("lifecycle: draft→approve (acquisition + first depreciation), cancel, disposal gain 12,000, revaluation re-base, rules, audit")
        except Exception as e: fail(18, e)

        # ── 19. R9.4: capital purchases and the classes ───────────────
        try:
            item = (await jget(appr, "/items?size=1"))["data"][0]
            st, cap = await post(appr, "/purchases", {"vendorId": "v6", "issueDate": "2026-09-24", "challanNo": "E2E-CAP-1", "challanDate": "2026-09-24", "method": "Bank", "category": "capital", "discount": 0, "paid": 0, "issuedBy": "E2E", "designation": "E2E", "narration": "e2e capital purchase", "process": "Approved",
                                                      "lines": [{"itemId": item["id"], "qty": 1, "price": 800_000, "sdRate": 0, "vatRate": 15}]})
            assert st == 201 and cap["process"] == "Approved" and cap["category"] == "capital", (st, cap)
            st_before = await jget(appr, f"/items/{item['id']}/ledger")  # the item's stock ledger
            jr = await jget(appr, f"/accounting/journal?q={cap['invoiceNo']}&to={ASOF}")
            assert jr["total"] == 1 and "1500" in jr["data"][0]["accounts"], jr["data"][0]["accounts"]  # the cost posted to fixed assets
            st_after = await jget(appr, f"/items/{item['id']}/ledger")
            assert st_before["closing"] == st_after["closing"], (st_before["closing"], st_after["closing"])  # a capital purchase moves no stock
            st, d = await post(admin, "/accounting/asset-classes", {"name": "Plant and machinery (factory)", "rate": 20})
            assert st == 409, st  # a duplicate name (settings.manage — the approver never gets there)
            st, cls = await post(admin, "/accounting/asset-classes", {"name": "Laboratory equipment", "rate": 20, "note": "e2e"})
            assert st == 201 and cls["id"].startswith("acl"), (st, cls)
            st, cls2 = await put(admin, f"/accounting/asset-classes/{cls['id']}", {"name": "Laboratory equipment", "rate": 15, "note": "e2e"})
            assert st == 200 and cls2["rate"] == 15, (st, cls2)
            classes = await jget(appr, "/accounting/asset-classes")
            assert len(classes) >= 9 and any(c["rate"] == 25 for c in classes)  # the NBR classes + ours
            ok("capital purchase: cost → 1500, no stock movement, input VAT as usual; classes: duplicate 409, create, edit")
        except Exception as e: fail(19, e)

        # ── 20. R9.3/R9.4: the pages, Bangla, role gating ─────────────
        try:
            await pg.goto(BASE + "/en/accounting/reports", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Statements & reports")).to_be_visible()
            await expect(pg.get_by_text("Trial balance as of")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/93_reports_tb.png")
            await pg.get_by_role("button", name="Balance sheet").click()
            await expect(pg.get_by_role("cell", name="Liabilities & equity")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/93_reports_bs.png")
            await pg.goto(BASE + "/en/accounting/assets", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Fixed assets")).to_be_visible()
            await expect(pg.get_by_text("AS-07250001").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/94_assets.png")
            one = (await jget(appr, "/accounting/assets?q=Gazuria"))["data"][0]
            await pg.goto(BASE + f"/en/accounting/assets?view={one['id']}", wait_until="networkidle")
            await expect(pg.get_by_text("Depreciation schedule")).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/94_asset_sheet.png")
            bn = await login_ctx(b, "admin", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            for path in ("/bn/accounting/reports", "/bn/accounting/assets"):
                await bp.goto(BASE + path, wait_until="networkidle"); await bp.wait_for_timeout(300)
            await settle(bp); await bp.screenshot(path=f"{OUT}/94_bn.png")
            await bn.close()
            st, _ = await post(view, "/accounting/assets", {"name": "Viewer may not", "classId": "plant", "date": TODAY, "cost": 100, "process": "Created"})
            assert st == 403, st
            ok("pages: reports (TB + balance sheet tabs), assets register + schedule sheet, Bangla, role gating")
        except Exception as e: fail(20, e)

        bad = [e for e in errs if "MISSING_MESSAGE" in e or "FORMATTING_ERROR" in e or e.startswith("pageerror")]
        print("console/page errors:", len(errs), errs[:6])
        assert not bad, bad; ok("no page errors or missing i18n messages")
        await b.close()
    print(f"\n{sum(1 for r in results if r[0]=='PASS')} checks passed, {len(failures)} section(s) failed")
    if failures: sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
