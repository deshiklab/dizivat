"""R6 end-to-end checks — NBR enlistment readiness + RMG (garments) features.

Rules engine: return due date (15 days, next working day, company holidays, 20-day category), Mushak 6.6 deadline
(3 working days after the return), advance tax 2 % / 7.5 % by importer class. Business profile card (view, edit,
validation, audit trail). RMG: customer exporter profile, deemed-export / export documents on the sale form with the
live NBR checklist, sale-detail checklist, the export & deemed-export register (filters, CSV, links, Bangla), the
Rule 21 banner on Mushak 4.3. Tamper evidence: the audit chain verifies and grows with every event.
Creates one draft deemed-export invoice and edits (then restores) the business profile — run after the other suites.
"""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
DL = os.path.join(OUT, "downloads"); os.makedirs(DL, exist_ok=True)
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
def fid(i): return f'[id="{i}"]'

async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def send(ctx, method, path, data):
    r = await ctx.request.fetch(API + path, method=method, data=data)
    return r.status, (await r.json() if r.headers.get("content-type", "").startswith(("application/json", "application/problem")) else None)

def sale(customer, lines, process="Created", **kw):
    return {"customerId": customer, "issueDate": TODAY, "issueTime": "11:00", "deliveryAddress": "", "vehicle": "", "method": "Bank", "discount": 0, "paid": 0,
            "vds": False, "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge", "narration": "", "process": process, "branchId": "", "lines": lines, **kw}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        admin = await login_ctx(b, "admin", viewport=VP, accept_downloads=True)
        arif = await login_ctx(b, "arif", viewport=VP, accept_downloads=True)
        pg = await admin.new_page(); watch(pg, errs)
        settings0 = await jget(admin, "/vat/settings")

        # ── 1. Rules engine: due dates, VDS deadline, AT ─────────────
        try:
            c = await jget(admin, "/vat/compliance?period=2026-09")
            assert c["due"] == "2026-10-15", c["due"]                       # Thu 15 Oct — a working day
            assert c["vds"].get("issueBy") == "2026-10-20", c["vds"]        # +3 working days, skipping Fri 16 / Sat 17
            ok("Sep 2026 return due 15 Oct; Mushak 6.6 due 20 Oct (3 working days, weekend skipped)")
            c8 = await jget(admin, "/vat/compliance?period=2026-08")
            assert c8["due"] == "2026-09-15", c8["due"]
            c11 = await jget(admin, "/vat/periods")
            assert any(x["period"] == "2026-09" for x in c11); ok("Aug 2026 return due 15 Sep; periods list intact")
            p0 = settings0.get("profile") or {}
            assert p0.get("segment") == "rmgDeemed" and p0.get("importerType") == "manufacturer" and p0.get("bondLicenseNo"), p0
            ok("seeded business profile: RMG deemed exporter, manufacturer, bond licence on file")
        except Exception as e: fail(1, e)

        # ── 2. Business profile card ──────────────────────────────────
        try:
            await pg.goto(BASE + "/en/vat/settings", wait_until="networkidle")
            card = pg.locator("form", has=pg.get_by_text("Business profile", exact=True))
            await expect(card.get_by_text("RMG — deemed exporter (accessories / packaging)")).to_be_visible()
            await expect(card.get_by_text(re.compile(r"advance tax 2%"))).to_be_visible()
            await expect(card.get_by_text("Return for 2026-09 is due on 15 Oct 2026")).to_be_visible()
            ok("profile card shows the segment, advance tax 2 % and the next return due date")
            await card.get_by_role("button", name="Edit profile").click()
            await pg.locator(fid("profile-importerType")).click(); await pg.get_by_role("option", name="Commercial importer").click()
            await expect(card.get_by_text(re.compile(r"advance tax 7\.5%"))).to_be_visible()
            await pg.locator(fid("profile-holidays")).fill("2026-10-15")
            await expect(card.get_by_text("Return for 2026-09 is due on 18 Oct 2026")).to_be_visible()
            ok("editing: commercial importer → AT 7.5 %; a holiday on 15 Oct moves the due date to Sun 18 Oct (live)")
            await pg.locator(fid("profile-holidays")).fill("15-10-2026")
            await card.get_by_role("button", name="Save").click()
            await expect(card.locator("[role=alert]").first).to_be_visible(); ok("invalid holiday date is rejected inline")
            await pg.locator(fid("profile-holidays")).fill("2026-10-15")
            await pg.get_by_role("switch", name="100% export-oriented unit").click()
            await card.get_by_role("button", name="Save").click()
            await expect(pg.get_by_text("Business profile saved")).to_be_visible()
            c = await jget(admin, "/vat/compliance?period=2026-09")
            assert c["due"] == "2026-10-18" and c["vds"]["issueBy"] == "2026-10-21", c
            ok("saved: compliance centre uses the company holiday (due 18 Oct, Mushak 6.6 by 21 Oct)")
            await pg.goto(BASE + "/en/vat/mushak-4-3", wait_until="networkidle")
            await expect(pg.get_by_role("note")).to_contain_text("Rule 21"); ok("100% export-oriented → Rule 21 note on the Mushak 4.3 register")
            ev = await jget(admin, "/audit?entity=vatSettings&size=5")
            fields = {ch["field"] for ch in ev["data"][0].get("changes", [])}
            assert {"profile.importerType", "profile.exportOriented", "profile.holidays"} <= fields, fields
            ok("profile change is in the audit trail field by field")
            st, _ = await send(admin, "PUT", "/vat/settings", {"zoneCode": settings0["zoneCode"], "profile": {**settings0["profile"], "segment": "rmgDirect", "exportOriented": True, "bondLicenseNo": ""}})
            assert st == 422, st; ok("API: export-oriented RMG unit without a bond licence → 422")
            st, _ = await send(admin, "PUT", "/vat/settings", {"zoneCode": settings0["zoneCode"], "profile": settings0["profile"]})
            assert st == 200, st
            assert (await jget(admin, "/vat/compliance?period=2026-09"))["due"] == "2026-10-15"
            await pg.goto(BASE + "/en/vat/mushak-4-3", wait_until="networkidle")
            await expect(pg.get_by_role("note")).to_have_count(0); ok("profile restored; Rule 21 note gone")
            st, _ = await send(arif, "PUT", "/vat/settings", {"zoneCode": settings0["zoneCode"], "profile": settings0["profile"]})
            assert st == 403, st; ok("approvers cannot change the business profile (settings.manage)")
        except Exception as e: fail(2, e)

        # ── 3. Customer exporter profile ──────────────────────────────
        try:
            c10 = await jget(admin, "/customers/c10")
            assert c10.get("exporterType") == "direct" and c10.get("bondLicenseNo"), c10
            await pg.goto(BASE + "/en/master/customers?edit=c10", wait_until="networkidle"); await pg.wait_for_timeout(600)
            sheet = pg.get_by_role("dialog")
            await expect(sheet.get_by_role("heading", name="RMG / export profile")).to_be_visible()
            await expect(sheet.locator("#bondLicenseNo")).to_have_value(c10["bondLicenseNo"])
            await sheet.locator("#bondLicenseExpiry").fill("2026-01-31")
            await expect(sheet.get_by_text(re.compile("bond licence expired on 31 Jan 2026"))).to_be_visible()
            await sheet.get_by_role("button", name="Cancel").click()
            ok("customer sheet: RMG section with exporter type and bond licence; expired licence warned")
            st, d = await send(admin, "PUT", "/customers/c3", {**{k: (await jget(admin, "/customers/c3"))[k] for k in ("name", "mode", "bin", "mobile", "address")},
                                                              "exporterType": "deemed", "bondLicenseNo": f"CUS-BOND/CTG/T-{os.getpid()}/2025", "bondLicenseExpiry": "2027-03-31", "associationNo": "BGAPMEA-9"})
            assert st == 200 and d["exporterType"] == "deemed", (st, d)
            ev = await jget(admin, "/audit?entityId=c3&size=3")
            assert any(ch["field"] == "bondLicenseNo" for ch in ev["data"][0].get("changes", [])); ok("API: exporter fields saved and audited")
        except Exception as e: fail(3, e)

        # ── 4. Sale form: deemed export with the live NBR checklist ──
        try:
            spg = await arif.new_page(); watch(spg, errs)
            await spg.goto(BASE + "/en/sales/new", wait_until="networkidle")
            await spg.locator("#customerId").click(); await spg.get_by_placeholder("Search name or BIN…").fill("aurora"); await spg.get_by_role("option").first.click()
            await spg.get_by_role("switch", name="Deemed export (back-to-back LC)").click()
            chk = spg.get_by_role("region", name="NBR zero-rating conditions")
            await expect(chk).to_contain_text("3 conditions missing")
            await expect(chk).to_contain_text("Buyer is the actual exporter")
            await spg.locator(fid("export.lcNo")).fill("BB-LC-E2E-R6"); await spg.locator(fid("export.lcDate")).fill("2026-09-20")
            await expect(chk).to_contain_text("2 conditions missing")
            await spg.locator(fid("export.fcValue")).fill("1250"); await spg.locator(fid("export.exchangeRate")).fill("122")
            await expect(spg.get_by_text(re.compile(r"= Tk 1,?52,500"))).to_be_visible()
            await spg.locator(fid("export.udNo")).fill("BKMEA/UD/2026/E2E")
            await expect(chk).to_contain_text("Complete")
            ok("deemed export: checklist starts with 3 missing (exporter + bond come from the customer), ticks off LC, FC (Tk equivalent shown) and UD → complete; bond from the customer")
            await spg.goto(BASE + "/en/sales/new?type=export", wait_until="networkidle")
            await spg.locator("#customerId").click(); await spg.get_by_placeholder("Search name or BIN…").fill("desert"); await spg.get_by_role("option").first.click()
            chk = spg.get_by_role("region", name="NBR zero-rating conditions")
            await expect(chk).to_contain_text("EXP form number"); await expect(spg.locator(fid("export.expNo"))).to_be_visible()
            ok("direct export: EXP no. field and the direct-export document checklist")
            await spg.close()
            it = {"id": "i21"}  # finished good (the seeded deemed exports use it too)
            st, d = await send(arif, "POST", "/sales", sale("c10", [{"itemId": it["id"], "qty": 1, "price": 1000, "sdRate": 0, "vatRate": 0}],
                export={"deemed": True, "lcNo": "BB-LC-E2E-R6", "lcDate": "2026-09-20", "udNo": "BKMEA/UD/2026/E2E", "udDate": "2026-09-01", "currency": "USD", "fcValue": 8.2, "exchangeRate": 122, "expNo": ""}))
            assert st == 201 and d["export"]["udNo"] == "BKMEA/UD/2026/E2E" and d["export"]["currency"] == "USD" and "expNo" not in d["export"], (st, d.get("export") if d else d)
            new_id = d["id"]; ok("API: deemed export saved with UD, currency, FC value and rate (empty fields dropped)")
            st, _ = await send(arif, "POST", "/sales", sale("c10", [{"itemId": it["id"], "qty": 1, "price": 1000, "sdRate": 0, "vatRate": 0}],
                export={"deemed": True, "lcNo": "X", "lcDate": "2026-09-20", "currency": "JPY"}))
            assert st == 422, st; ok("API: unsupported currency → 422")
        except Exception as e: fail(4, e); new_id = None

        # ── 5. Sale detail checklist ──────────────────────────────────
        try:
            reg = await jget(arif, "/vat/exports?kind=deemed")
            done = next(r for r in reg["rows"] if r["udNo"] == "BKMEA/UD/2026/08812") if any(r.get("udNo") == "BKMEA/UD/2026/08812" for r in reg["rows"]) else None
            risky = next(r for r in reg["rows"] if not r["complete"])
            spg = await arif.new_page(); watch(spg, errs)
            if done:
                await spg.goto(BASE + f"/en/sales/{done['id']}", wait_until="networkidle")
                await expect(spg.get_by_role("region", name="NBR zero-rating conditions")).to_contain_text("Complete")
                await expect(spg.get_by_text("BKMEA/UD/2026/08812", exact=False)).to_be_visible()
            await spg.goto(BASE + f"/en/sales/{risky['id']}", wait_until="networkidle")
            await expect(spg.get_by_role("region", name="NBR zero-rating conditions")).to_contain_text("missing")
            await spg.close(); ok("sale detail: export card shows UD / bond / FC and the checklist (complete and at-risk invoices)")
        except Exception as e: fail(5, e)

        # ── 6. Export & deemed-export register ────────────────────────
        try:
            api = await jget(arif, "/vat/exports")
            assert api["from"] == "2025-07-01" and api["to"] == TODAY, (api["from"], api["to"])
            assert api["totals"]["direct"]["count"] > 0 and api["totals"]["deemed"]["count"] >= 2 and api["totals"]["atRisk"]["count"] >= 2, api["totals"]
            if new_id: assert any(r["id"] == new_id and r["complete"] for r in api["rows"])
            for r in api["rows"]:
                assert r["complete"] == (len(r["missing"]) == 0)
                if r["kind"] == "direct": assert r["process"] != "Cancelled"
            ok(f"API register: default range FY 2025-26 → today; {api['totals']['direct']['count']} direct, {api['totals']['deemed']['count']} deemed, {api['totals']['atRisk']['count']} at risk")
            rk = await jget(arif, "/vat/exports?risk=1")
            assert len(rk["rows"]) == api["totals"]["atRisk"]["count"] and all(not r["complete"] for r in rk["rows"]); ok("?risk=1 returns only incomplete invoices")
            rpg = await arif.new_page(); watch(rpg, errs)
            await rpg.goto(BASE + "/en/vat/mushak", wait_until="networkidle")
            await rpg.locator("main a[href$='/vat/export-compliance']").first.click()
            await expect(rpg.get_by_role("heading", level=1, name="Export & deemed-export register")).to_be_visible()
            side = rpg.locator("[data-sidebar='sidebar']").first
            await expect(side.get_by_role("link", name="Export register")).to_be_visible()
            ok("reachable from the compliance centre and the sidebar (NBR VAT › Export register)")
            table = rpg.get_by_role("region", name="Export invoices")
            await expect(table.locator("tbody tr")).to_have_count(len(api["rows"]))
            await rpg.get_by_role("switch", name="Incomplete only").click()
            await expect(table.locator("tbody tr")).to_have_count(len(rk["rows"]))
            await expect(rpg).to_have_url(re.compile(r"risk=1"))
            await expect(table.get_by_text("At risk").first).to_be_visible()
            await rpg.locator("#ex-kind").click(); await rpg.get_by_role("option", name="Deemed export").click()
            dk = await jget(arif, "/vat/exports?risk=1&kind=deemed")
            await expect(table.locator("tbody tr")).to_have_count(max(1, len(dk["rows"])))
            ok("filters: incomplete-only and type, kept in the URL")
            async with rpg.expect_download() as dl:
                await rpg.get_by_role("button", name=re.compile("CSV")).or_(rpg.get_by_role("link", name=re.compile("CSV"))).first.click()
            path = os.path.join(DL, "export-register.csv"); await (await dl.value).save_as(path)
            head = open(path, encoding="utf-8-sig").readline()
            assert "UD / UP No" in head and "Zero-rating conditions" in head, head; ok("CSV download with UD / EXP / FC and the conditions column")
            await rpg.get_by_role("switch", name="Incomplete only").click()
            await table.locator("tbody tr a").first.click()
            await expect(rpg).to_have_url(re.compile(r"/en/sales/s\d+")); ok("invoice number links to the sale")
            await rpg.goto(BASE + "/bn/vat/export-compliance", wait_until="networkidle")
            await expect(rpg.get_by_role("heading", level=1, name="রপ্তানি ও প্রচ্ছন্ন রপ্তানি রেজিস্টার")).to_be_visible(); ok("Bangla register")
            await rpg.set_viewport_size({"width": 390, "height": 844})
            await rpg.goto(BASE + "/en/vat/export-compliance", wait_until="networkidle")
            await expect(rpg.get_by_role("heading", level=1)).to_be_visible()
            await rpg.screenshot(path=f"{OUT}/r6_register_mobile.png"); await rpg.close(); ok("register renders on a phone")
        except Exception as e: fail(6, e)

        # ── 7. Tamper-evident audit chain ─────────────────────────────
        try:
            v1 = await jget(admin, "/audit/verify")
            assert v1["ok"] is True and v1["algorithm"] == "SHA-256" and len(v1["head"]) == 64, v1
            await send(admin, "PUT", "/vat/settings", {"zoneCode": settings0["zoneCode"], "profile": settings0["profile"]})
            v2 = await jget(admin, "/audit/verify")
            assert v2["ok"] and v2["count"] > v1["count"] and v2["head"] != v1["head"], (v1, v2)
            ok(f"audit chain verifies ({v2['count']} events) and every new event moves the head")
            aud = await login_ctx(b, "auditor", viewport=VP)
            apg = await aud.new_page(); watch(apg, errs)
            await apg.goto(BASE + "/en/master/audit", wait_until="networkidle")
            box = apg.get_by_role("region", name=re.compile("Tamper-evident audit chain"))
            await expect(box).to_contain_text("events intact")
            await box.get_by_role("button", name="Verify now").click()
            await expect(box).to_contain_text("SHA-256"); ok("audit trail page: integrity card (auditor role) with re-verify")
            kamal = await login_ctx(b, "kamal", viewport=VP)
            r = await kamal.request.get(API + "/audit/verify"); assert r.status == 403, r.status; ok("operators cannot verify the chain (audit.view)")
            await apg.close()
        except Exception as e: fail(7, e)

        bad = [e for e in errs if "favicon" not in e]
        if bad: failures.append(f"console errors: {bad[:5]}"); print("FAIL console", bad[:5])
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
