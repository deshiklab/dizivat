"""R6.4 end-to-end checks — RMG bond consumption register and duty drawback.

Register (Customs Act s.114): bonded receipts vs export consumption through the BOM coefficient, FIFO by Bill of
Entry, book balance vs stock on hand (shortfall → duty at risk), ranges and CSVs.
Bills of Entry: 24-month bonding period + 6-month extension (expiring / in extension / cleared), go-live carry-forward.
Duty drawback: CD + RD on duty-paid inputs consumed by each export, 6-month claim window.
Bonded import: IM-7 toggle → no duty / VAT / credit, duty foregone kept, 9.1 note 11, appears in and leaves the register.
Creates (then cancels) one bonded import — run after the other suites. Works against the mock and the PostgreSQL build.
"""
import asyncio, os, re, time
from datetime import date
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens"); os.makedirs(OUT, exist_ok=True)
API = BASE + "/api/v1"
TODAY = "2026-09-25"
RUN = str(int(time.time()))[-5:]
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
near = lambda a, b, tol=0.011: abs((a or 0) - (b or 0)) <= tol

async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def send(ctx, method, path, data=None):
    r = await ctx.request.fetch(API + path, method=method, data=data)
    ct = r.headers.get("content-type", "")
    return r.status, (await r.json() if ct.startswith(("application/json", "application/problem")) else None)
async def shot(pg, name):
    await pg.screenshot(path=os.path.join(OUT, f"r64-{name}.png"), full_page=False)
async def note_value(ctx, period, n):
    v = await jget(ctx, f"/vat/returns/{period}")
    row = next((x for x in v["computation"]["notes"] if x["note"] == n), None)
    return round((row or {}).get("value") or 0, 2)
def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    import calendar
    last = calendar.monthrange(d.year + y, m + 1)[1]
    return date(d.year + y, m + 1, min(d.day, last)).isoformat()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        arif = await login_ctx(br, "arif", viewport=VP)
        errs = []
        reg = None

        # ── 1. Register: licence, carry-forwards, states ─────────────────
        try:
            reg = await jget(arif, "/vat/bond")
            assert reg["asOf"] == TODAY and reg["to"] == TODAY, (reg["asOf"], reg["to"])
            lic = reg["licence"]
            assert lic["kind"] == "own" and lic["licenceNo"] == "CUS-BOND/DHK/G-1186/2021" and lic["state"] == "valid", lic
            lots = {(l["boeNo"], l["itemId"]): l for l in reg["lots"]}
            pk = lots[("C-0988415", "i4")]
            assert pk["source"] == "opening" and pk["state"] == "expiring" and pk["dueDate"] == "2026-11-05" and pk["daysLeft"] == 41, pk
            ink = lots[("C-0979032", "i11")]
            assert ink["state"] == "extension" and ink["extendedDue"] == "2027-02-20" and ink["daysLeft"] < 0, ink
            assert lots[("C-1012264", "i5")]["state"] == "cleared" and lots[("C-1012264", "i5")]["balance"] == 0
            for l in reg["lots"]:
                assert near(l["qty"] - l["consumed"], l["balance"], 0.002), l
                assert l["dueDate"] == add_months(date.fromisoformat(l["boeDate"]), 24) and l["extendedDue"] == add_months(date.fromisoformat(l["boeDate"]), 30), l
            t = reg["totals"]
            assert t["lotsExpiring"] >= 1 and t["lotsExtension"] >= 1 and t["shortfallItems"] >= 1 and t["dutyAtRisk"] > 0, t
            ok(f"register: own licence valid; {len(reg['lots'])} bonded BoE lines — go-live pocketing BoE expiring in 41 days, ink BoE in extension, Jan denim BoE cleared")
        except Exception as e: fail(1, e)

        # ── 2. Register maths: balances, FIFO, shortfall, consumption split ──
        try:
            rows = {r["itemId"]: r for r in reg["rows"]}
            for r in reg["rows"]:
                assert near(r["opening"] + r["bondedIn"] - r["bondedUsed"], r["closing"], 0.002), r
                assert near(r["bondedUsed"] + r["fromDutyPaid"] + r["fromLocal"] + r["unsourced"], r["exportUse"], 0.005), r
                lot_bal = sum(l["balance"] for l in reg["lots"] if l["itemId"] == r["itemId"])
                assert near(lot_bal, r["closing"], 0.005), (r["itemId"], lot_bal, r["closing"])
                if r["physical"] is not None: assert near(r["shortfall"], max(0, r["closing"] - r["physical"]), 0.002), r
            ink = rows["i11"]
            assert ink["state"] == "shortfall" and ink["shortfall"] > 0 and ink["dutyAtRisk"] > 0, ink
            assert near(ink["dutyAtRisk"], round(ink["shortfall"] * ink["dutyPerUnit"], 2), 0.05), ink
            # pocketing: every jeans export × 0.2575 m (BOM gross qty) comes out of the bonded go-live BoE first
            sales = await jget(arif, "/sales?size=500&category=all")
            jeans = sum(l["qty"] for s in sales["data"] if s.get("export") and s["process"] == "Approved" for l in s["lines"] if l["itemId"] == "i22")
            assert near(rows["i4"]["exportUse"], jeans * 0.2575, 0.01), (rows["i4"]["exportUse"], jeans)
            assert rows["i4"]["state"] == "ok" and rows["i4"]["bondedUsed"] == rows["i4"]["exportUse"]
            assert near(reg["totals"]["dutyAtRisk"], sum(r["dutyAtRisk"] for r in reg["rows"]), 0.02)
            ok(f"maths: closing = opening + receipts − used for {len(rows)} inputs; lots sum to the book; jeans exports × 0.2575 m = {rows['i4']['exportUse']} m pocketing; ink short {ink['shortfall']} kg → ৳{ink['dutyAtRisk']} at risk")
        except Exception as e: fail(2, e)

        # ── 3. Drawback ──────────────────────────────────────────────────
        try:
            db = reg["drawback"]
            assert db["rows"], "no drawback rows"
            for r in db["rows"]:
                assert near(r["total"], r["cd"] + r["rd"]) and near(r["cd"], sum(i["cd"] for i in r["inputs"]), 0.05), r["invoiceNo"]
                assert r["deadline"] == add_months(date.fromisoformat(r["exportDate"]), 6), r
                exp = "lapsed" if r["deadline"] < TODAY else ("expiring" if r["daysLeft"] <= 30 else "open")
                assert r["state"] == exp, (r["invoiceNo"], r["state"], exp)
            assert near(db["totals"]["claimable"], sum(r["total"] for r in db["rows"] if r["state"] != "lapsed"), 0.05)
            assert near(db["totals"]["lapsed"], sum(r["total"] for r in db["rows"] if r["state"] == "lapsed"), 0.05)
            assert db["totals"]["claimable"] > 0 and db["totals"]["lapsed"] > 0 and db["totals"]["expiring"] > 0, db["totals"]
            ok(f"drawback: {len(db['rows'])} exports, CD + RD only, 6-month deadlines; claimable ৳{db['totals']['claimable']:,.2f}, expiring ৳{db['totals']['expiring']:,.2f}, lapsed ৳{db['totals']['lapsed']:,.2f}")
        except Exception as e: fail(3, e)

        # ── 4. Ranges, validation and CSVs ───────────────────────────────
        try:
            part = await jget(arif, "/vat/bond?from=2026-07-01")
            rows = {r["itemId"]: r for r in part["rows"]}
            full = {r["itemId"]: r for r in reg["rows"]}
            assert near(rows["i4"]["closing"], full["i4"]["closing"], 0.002) and rows["i4"]["opening"] > 0, rows["i4"]
            assert all(d["exportDate"] >= "2026-07-01" for d in part["drawback"]["rows"])
            past = await jget(arif, "/vat/bond?to=2026-06-30")
            assert past["to"] == "2026-06-30" and all(r["physical"] is None for r in past["rows"])
            assert not any(l["boeDate"] > "2026-06-30" for l in past["lots"])
            for q, field in (("from=2026-02-30", "from"), ("to=2030-01-01", "to"), ("from=2026-09-01&to=2026-08-01", "to")):
                st, b = await send(arif, "GET", f"/vat/bond?{q}")
                assert st == 422 and field in (b or {}).get("errors", {}), (q, st, b)
            heads = {}
            for view, first in (("register", "Input"), ("lots", "Bill of Entry"), ("drawback", "Export invoice")):
                r = await arif.request.get(f"{API}/vat/bond?format=csv&view={view}")
                assert r.ok and "text/csv" in r.headers.get("content-type", ""), (view, r.status)
                txt = (await r.text()).lstrip("\ufeff")
                heads[view] = txt.splitlines()[0].split(",")[0].strip('"')
                assert heads[view] == first, (view, heads[view])
                assert len(txt.splitlines()) > 2
            ok("range: from 1 Jul carries the bonded opening forward, a past 'to' drops the stock comparison and later BoEs; 422 on bad dates; three CSVs")
        except Exception as e: fail(4, e)

        # ── 5. Bonded import lifecycle (API) ─────────────────────────────
        pid = None
        try:
            before = await note_value(arif, "2026-09", 11)
            body = {"vendorId": "v2", "issueDate": "2026-09-22", "challanNo": f"C-77{RUN}", "challanDate": "2026-09-22", "method": "Transaction", "discount": 0, "paid": 0,
                    "issuedBy": "E2E R6.4", "designation": "Tester", "narration": "", "process": "Created", "branchId": "",
                    "lines": [{"itemId": "i3", "qty": 400, "usd": 2400, "usdRate": 122.5, "cdRate": 5, "rdRate": 3, "sdRate": 0, "vatRate": 15, "aitRate": 5, "atRate": 2, "rebateable": True}],
                    "boe": {"lcNo": f"BB-LC-E2E-{RUN}", "lcDate": "2026-08-30", "customsHouse": "301", "origin": "China", "cnfFirm": "", "receiveAddress": "", "bonded": True}}
            st, pu = await send(arif, "POST", "/purchases", body)
            assert st in (200, 201), (st, pu)
            pid = pu["id"]
            l = pu["lines"][0]
            av = round(2400 * 122.5, 2)
            assert pu["boe"]["bonded"] is True and pu["vat"] == 0 and pu["sd"] == 0 and pu["rebate"] == 0 and pu["tti"] == 0 and near(pu["netTotal"], av), pu
            fg = l["duty"]["foregone"]
            cd = round(av * 0.05, 2); rd = round(av * 0.03, 2); vat = round((av + cd + rd) * 0.15, 2)
            assert near(fg["cd"], cd) and near(fg["rd"], rd) and near(fg["vat"], vat) and l["duty"]["cd"] == 0, fg
            reg2 = await jget(arif, "/vat/bond")
            assert not any(x["docId"] == pid for x in reg2["lots"]), "draft must not enter the register"
            st, _ = await send(arif, "PATCH", f"/purchases/{pid}", {"process": "Approved"})
            assert st == 200, st
            reg3 = await jget(arif, "/vat/bond")
            lot = next(x for x in reg3["lots"] if x["docId"] == pid)
            assert lot["balance"] == 400 and lot["state"] == "open" and near(lot["dutyOnBalance"], fg["total"]), lot
            assert near(reg3["totals"]["dutyOnBalance"], reg["totals"]["dutyOnBalance"] + fg["total"], 0.05)
            after = await note_value(arif, "2026-09", 11)
            assert near(after - before, av, 0.02), (before, after, av)
            st, _ = await send(arif, "PATCH", f"/purchases/{pid}", {"process": "Cancelled", "reason": "E2E bonded import — cleaning up"})
            assert st == 200, st
            reg4 = await jget(arif, "/vat/bond")
            assert not any(x["docId"] == pid for x in reg4["lots"]) and near(reg4["totals"]["dutyOnBalance"], reg["totals"]["dutyOnBalance"], 0.05)
            ok(f"bonded import: nothing payable or creditable, duty foregone ৳{fg['total']:,.2f} kept; enters the register on approval, note 11 +৳{av:,.2f}, leaves on cancel")
        except Exception as e: fail(5, e)

        # ── 6. Page: licence, KPIs, three tabs ───────────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Bond consumption register")).to_be_visible()
            await expect(pg.get_by_test_id("bond-licence")).to_contain_text("CUS-BOND/DHK/G-1186/2021")
            await expect(pg.get_by_test_id("bond-at-risk")).to_contain_text("Duty at risk")
            await expect(pg.get_by_test_id("bond-row-i11")).to_contain_text("Shortfall")
            await expect(pg.get_by_test_id("bond-row-i4")).to_contain_text("In balance")
            await shot(pg, "register")
            await pg.get_by_role("tab", name=re.compile("^Bills of Entry")).click()
            await expect(pg.get_by_test_id("bond-lot-C-0988415-i4")).to_contain_text("Expiring")
            await expect(pg.get_by_test_id("bond-lot-C-0979032-i11")).to_contain_text("In extension")
            await expect(pg.get_by_test_id("bond-lot-C-0979032-i11")).to_contain_text("Extension needed")
            assert "tab=boe" in pg.url
            await shot(pg, "boe")
            await pg.get_by_role("tab", name=re.compile("^Duty drawback")).click()
            first = pg.locator("[data-testid^=drawback-]").first
            await expect(first).to_be_visible()
            await first.locator("summary").click()
            await expect(first.locator("li").first).to_contain_text("P-")
            await expect(pg.get_by_role("link", name="Drawback CSV")).to_have_attribute("href", re.compile(r"view=drawback"))
            await shot(pg, "drawback")
            ok("page: licence strip, duty-at-risk KPI, ink shortfall, BoE expiring / in extension, drawback inputs drill-down and CSV")
            await pg.close()
        except Exception as e: fail(6, e)

        # ── 7. Range form ────────────────────────────────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption", wait_until="networkidle")
            await pg.get_by_label("To", exact=True).fill("2026-06-30")
            await pg.get_by_role("button", name="Apply").click()
            await expect(pg.get_by_text("Stock on hand is only compared when the period ends today")).to_be_visible()
            assert "to=2026-06-30" in pg.url
            await expect(pg.get_by_test_id("bond-row-i11")).not_to_contain_text("Shortfall")
            await pg.get_by_role("button", name="Reset").click()
            await expect(pg.get_by_text("Balances as of today")).to_be_visible()
            ok("range form: a past end date drops the stock comparison (no shortfall), Reset returns to today")
            await pg.close()
        except Exception as e: fail(7, e)

        # ── 8. Import form toggle + purchase badge ───────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/purchases/new?type=import", wait_until="networkidle")
            sw = pg.get_by_role("switch", name=re.compile("Imported under bond"))
            await expect(sw).to_be_visible()
            await expect(pg.get_by_test_id("duty-foregone")).to_have_count(0)
            await sw.click()
            await expect(pg.get_by_test_id("duty-foregone")).to_be_visible()
            await expect(pg.get_by_text(re.compile("Bonded entry: the duty stack is assessed"))).to_be_visible()
            await shot(pg, "import-bonded")
            seeded = next(l for l in reg["lots"] if l["source"] == "import")
            await pg.goto(BASE + f"/en/purchases/{seeded['docId']}", wait_until="networkidle")
            badge = pg.get_by_role("link", name=re.compile("Under bond · duty foregone"))
            await expect(badge).to_be_visible()
            await badge.click()
            await pg.wait_for_url(re.compile(r"/vat/bond-consumption\?tab=boe"))
            ok("import form: bonded switch shows duty foregone with no payable / credit; bonded purchase badge opens the BoE tab")
            await pg.close()
        except Exception as e: fail(8, e)

        # ── 9. Navigation, compliance centre, help ───────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/mushak", wait_until="networkidle")
            await expect(pg.get_by_role("link", name=re.compile("BOND.*Bond consumption register"))).to_be_visible()
            await expect(pg.locator("nav").get_by_role("link", name="Bond consumption register")).to_have_count(1)
            for slug, h1 in (("bond-consumption-register", "Bond consumption register"), ("duty-drawback", "Duty drawback")):
                await pg.goto(BASE + f"/en/help/{slug}", wait_until="networkidle")
                await expect(pg.locator("h1").first).to_contain_text(h1)
            ok("navigation: NBR VAT sidebar item, compliance-centre report tile, two help articles")
            await pg.close()
        except Exception as e: fail(9, e)

        # ── 10. Bangla ───────────────────────────────────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/bn/vat/bond-consumption?tab=drawback", wait_until="networkidle")
            assert re.search(r"[\u0980-\u09FF]", await pg.locator("h1").first.inner_text())
            await expect(pg.get_by_role("tab", name=re.compile("শুল্ক প্রত্যর্পণ"))).to_be_visible()
            await shot(pg, "bn-drawback")
            await pg.goto(BASE + "/bn/help/bond-consumption-register", wait_until="networkidle")
            assert re.search(r"[\u0980-\u09FF]", await pg.locator("h1").first.inner_text())
            assert not [e for e in errs if "MISSING_MESSAGE" in e or "pageerror" in e], errs[:3]
            ok("Bangla: register page and help article in Bangla; no missing messages or page errors")
            await pg.close()
        except Exception as e: fail(10, e)

        await br.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  ✗", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
