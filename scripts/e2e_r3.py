"""R3 end-to-end checks (Sales + Production): export / deemed-export / service sales, batch (lot) availability,
credit note (Mushak 6.7), price declarations (Mushak 4.3) with versions, work orders, in-house / contractual (Mushak 6.4) /
opening batches, production config, role gating and Bangla. Run on a fresh server (it creates documents)."""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/home/user/RBS_VAT_Frontend_Plan/screenshots")
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

async def settle(pg):
    await pg.wait_for_timeout(50)
    await pg.evaluate("Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))")
    await pg.wait_for_timeout(80)

async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def post(ctx, path, data):
    r = await ctx.request.post(API + path, data=data); return r.status, (await r.json() if r.headers.get("content-type", "").startswith(("application/json", "application/problem")) else None)
async def patch(ctx, path, data):
    r = await ctx.request.patch(API + path, data=data); return r.status, (await r.json() if r.headers.get("content-type", "").startswith(("application/json", "application/problem")) else None)
async def stock(ctx, item): return (await jget(ctx, f"/items/{item}"))["remain"]

def fid(i): return f'[id="{i}"]'
def sale(customer, lines, process="Approved", **kw):
    return {"customerId": customer, "issueDate": TODAY, "issueTime": "11:00", "deliveryAddress": "", "vehicle": "", "method": "Bank", "discount": 0, "paid": 0,
            "vds": False, "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge", "narration": "", "process": process, "branchId": "", "lines": lines, **kw}
def line(item, qty, price, vat=15, **kw): return {"itemId": item, "qty": qty, "price": price, "sdRate": 0, "vatRate": vat, **kw}
def batch(mode, lines, process="Approved", **kw):
    return {"mode": mode, "issueDate": TODAY, "receiveDate": "", "vendorId": "", "address": "", "remark": "", "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge", "lines": lines, "process": process, **kw}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP)
        pg = await appr.new_page(); watch(pg, errs)
        local_sale = None

        # ── 1. Direct export invoice (UI) ─────────────────────────────
        try:
            await pg.goto(BASE + "/en/sales/exports", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Exports")).to_be_visible()
            await pg.get_by_role("link", name="New export invoice").click()
            await expect(pg.get_by_role("heading", name="New export invoice")).to_be_visible(); ok("exports list → New export invoice opens the sale form in export mode")
            await pg.locator("#customerId").click(); await pg.get_by_placeholder("Search name or BIN…").fill("desert"); await pg.get_by_role("option").first.click()
            await expect(pg.get_by_text("Export documents", exact=True)).to_be_visible()
            await pg.get_by_role("combobox", name="Product 1").click(); await pg.get_by_role("option", name=re.compile("Printed Blister")).click()
            await expect(pg.get_by_label("VAT % 1", exact=True)).to_have_value("0"); await expect(pg.get_by_label("VAT % 1", exact=True)).to_be_disabled()
            ok("foreign buyer shows the export documents card and zero-rates VAT")
            await pg.get_by_label("Qty 1", exact=True).fill("10"); await pg.get_by_label("Unit price 1", exact=True).fill("1180")
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.locator(fid("export.lcNo"))).to_have_attribute("aria-invalid", "true"); ok("export without LC / Bill of Export is rejected on the form")
            await pg.locator(fid("export.lcNo")).fill("EXP-LC-E2E-01"); await pg.locator(fid("export.lcDate")).fill("2026-08-20")
            await pg.locator(fid("export.customsHouse")).click(); await pg.get_by_role("option").first.click()
            country = pg.locator(fid("export.country"))
            if "UAE" not in (await country.inner_text()):
                await country.click(); await pg.get_by_role("option", name="UAE").click()
            await pg.locator(fid("export.billNo")).fill("C-E2E-7001"); await pg.locator(fid("export.billDate")).fill(TODAY)
            if not (await pg.locator(fid("export.shippingAddress")).input_value()): await pg.locator(fid("export.shippingAddress")).fill("Jebel Ali Free Zone, Dubai")
            await settle(pg); await pg.screenshot(path=f"{OUT}/80_export_form.png", full_page=True)
            before = await stock(appr, "i17")
            await pg.get_by_role("button", name="Save & approve").click()
            await pg.wait_for_url(re.compile(r"/sales/s\d+$")); sid = pg.url.rsplit("/", 1)[1]
            await expect(pg.get_by_text("Export documents", exact=True)).to_be_visible()
            d = await jget(appr, f"/sales/{sid}")
            assert d["vat"] == 0 and d["export"]["lcNo"] == "EXP-LC-E2E-01" and d["export"]["country"] == "UAE" and d["netTotal"] == 11800, d
            assert await stock(appr, "i17") == before - 10; ok("approved export: VAT 0, LC and Bill of Export stored, stock −10")
            await settle(pg); await pg.screenshot(path=f"{OUT}/81_export_detail.png", full_page=True)
            lst = await jget(appr, "/sales?trade=export&size=100")
            assert any(x["id"] == sid for x in lst["data"]); ok("export appears under the export trade facet")
        except Exception as e: fail(1, e)

        # ── 2. Export rules (API) ─────────────────────────────────────
        try:
            st, _ = await post(appr, "/sales", sale("c8", [line("i17", 1, 1180, 0)]))
            assert st == 422, st; ok("foreign sale without export documents → 422")
            st, _ = await post(appr, "/sales", sale("c8", [line("ss2", 1, 5000)], category="service"))
            assert st == 422, st; ok("service sale to a foreign buyer → 422")
            exp = {"deemed": False, "lcNo": "X-1", "lcDate": "2026-09-01", "customsHouse": "301", "country": "UAE", "billNo": "B-1", "billDate": TODAY, "shippingAddress": "Dubai"}
            st, _ = await post(appr, "/sales", sale("c2", [line("i18", 1, 1620, 0)], export=exp))
            assert st == 422, st; ok("direct export to a local buyer → 422")
            st, d = await post(appr, "/sales", sale("c2", [line("i18", 2, 1620)], export={"deemed": True, "lcNo": "BTB-E2E-01", "lcDate": "2026-09-10"}))
            assert st == 201 and d["vat"] == 0 and d["export"]["deemed"] is True, (st, d)
            deemed = await jget(appr, "/sales?trade=deemed&size=100")
            assert any(x["id"] == d["id"] for x in deemed["data"]); ok("deemed export to a local buyer: 201, zero-rated, listed under deemed")
            st, _ = await post(appr, "/sales", sale("c8", [line("i17", 1, 1180, 0)], export={"deemed": True, "lcNo": "BTB-2", "lcDate": "2026-09-10"}))
            assert st == 422, st; ok("deemed export to a foreign buyer → 422")
        except Exception as e: fail(2, e)

        # ── 3. Service sale (UI) ──────────────────────────────────────
        try:
            n0 = (await jget(appr, "/sales?category=service&size=1"))["total"]
            g0 = (await jget(appr, "/sales?size=1"))["total"]
            await pg.goto(BASE + "/en/sales/services", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Service sales")).to_be_visible()
            await pg.get_by_role("link", name="New service sale").click()
            await expect(pg.get_by_role("heading", name="New service sale")).to_be_visible()
            await pg.locator("#customerId").click(); await pg.get_by_placeholder("Search name or BIN…").fill("sunrise"); await pg.get_by_role("option").first.click()
            await pg.get_by_role("combobox", name="Service 1").click(); await pg.get_by_role("option", name=re.compile("Gravure cylinder")).click()
            await pg.get_by_label("Qty 1", exact=True).fill("2"); await pg.get_by_label("Unit price 1", exact=True).fill("15000")
            await expect(pg.get_by_label("SD % 1", exact=True)).to_be_disabled(); ok("service line: rate from the service code, SD not applicable")
            await pg.get_by_role("button", name="Save as draft").click()
            await pg.wait_for_url(re.compile(r"/sales/s\d+$")); d = await jget(appr, f"/sales/{pg.url.rsplit('/', 1)[1]}")
            assert d["category"] == "service" and d["invoiceNo"].startswith("SS-") and d["vat"] == 4500, d
            assert (await jget(appr, "/sales?category=service&size=1"))["total"] == n0 + 1 and (await jget(appr, "/sales?size=1"))["total"] == g0
            ok("service sale saved as SS- draft (15% VAT 4,500), listed under services only")
            st, _ = await patch(appr, f"/sales/{d['id']}", {"process": "Approved"})
            assert st == 200, st
            await settle(pg); await pg.goto(pg.url, wait_until="networkidle"); await pg.screenshot(path=f"{OUT}/82_service_detail.png", full_page=True)
        except Exception as e: fail(3, e)

        # ── 4. Batch (lot) availability + customer credit ─────────────
        try:
            await pg.goto(BASE + "/en/sales/new", wait_until="networkidle")
            await pg.locator("#customerId").click(); await pg.get_by_placeholder("Search name or BIN…").fill("sunrise"); await pg.get_by_role("option").first.click()
            await expect(pg.get_by_text("Customer credit", exact=True)).to_be_visible()
            await expect(pg.get_by_text("Credit limit", exact=True)).to_be_visible(); ok("sale form shows the customer's receivable, overdue and credit limit")
            await pg.get_by_role("combobox", name="Product 1").click(); await pg.get_by_role("option", name=re.compile("Cold Form Alu-Alu")).click()
            await expect(pg.get_by_label("Batch for line 1")).to_be_visible(); ok("finished-goods line offers a batch (lot) picker")
            lots = await jget(appr, "/production/lots?item=i18")
            assert lots and all(l["available"] > 0 for l in lots), lots
            lot = lots[0]
            st, d = await post(appr, "/sales", sale("c1", [line("i18", lot["available"] + 1, 1620, batchId=lot["batchId"])]))
            assert st == 422 and "lines.0.qty" in (d.get("errors") or {}), (st, d); ok(f"selling more than lot {lot['batchNo']} holds → 422 (exceedsLot)")
            before = await stock(appr, "i18")
            st, d = await post(appr, "/sales", sale("c1", [line("i18", 10, 1620, batchId=lot["batchId"])]))
            assert st == 201, (st, d); local_sale = d
            after = next(l for l in await jget(appr, "/production/lots?item=i18&all=1") if l["batchId"] == lot["batchId"])
            assert after["sold"] == lot["sold"] + 10 and await stock(appr, "i18") == before - 10; ok("sale drawn from a lot: lot sold +10, stock −10")
        except Exception as e: fail(4, e)

        # ── 5. Credit note (Mushak 6.7) ───────────────────────────────
        try:
            assert local_sale, "sale not created"
            await pg.goto(BASE + f"/en/sales/{local_sale['id']}", wait_until="networkidle")
            await pg.get_by_role("link", name="Issue credit note").click()
            dlg = pg.get_by_role("dialog")
            qty = dlg.get_by_label(re.compile("Return quantity for Cold Form Alu-Alu"))
            await expect(qty).to_be_visible(); ok("Issue credit note pre-selects the invoice and lists its lines")
            await qty.fill("11")
            await expect(dlg.get_by_role("button", name="Save & approve")).to_be_disabled(); ok("return above the invoiced quantity is blocked")
            await qty.fill("4")
            before = await stock(appr, "i18")
            await settle(pg); await pg.screenshot(path=f"{OUT}/83_credit_form.png")
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_text(re.compile(r"CN-\d{8} approved — stock restored"))).to_be_visible()
            assert await stock(appr, "i18") == before + 4; ok("approved credit note restores 4 to stock")
            cn = (await jget(appr, f"/credit-notes?sale={local_sale['id']}"))["data"][0]
            assert cn["vat"] == 972 and cn["subtotal"] == 6480, cn; ok("credit note reverses 4/10 of the line: value 6,480, VAT 972")
            cr = await jget(appr, f"/sales/{local_sale['id']}/creditable")
            assert cr["lines"][0]["remaining"] == 6, cr; ok("creditable quantity drops to 6")
            await pg.goto(BASE + f"/en/sales/credit-notes?view={cn['id']}&tab=mushak", wait_until="networkidle")
            await expect(pg.get_by_text("মূসক-৬.৭")).to_be_visible(); await settle(pg); await pg.screenshot(path=f"{OUT}/84_credit_67.png"); ok("Mushak 6.7 renders")
            st, _ = await patch(appr, f"/sales/{local_sale['id']}", {"process": "Cancelled", "reason": "E2E cancel attempt with notes"})
            assert st == 409, st; ok("invoice with a credit note cannot be cancelled (409)")
            await pg.goto(BASE + f"/en/sales/{local_sale['id']}", wait_until="networkidle")
            await expect(pg.get_by_role("link", name=cn["no"])).to_be_visible(); ok("sale detail lists its credit notes")
            book = await jget(appr, "/mushak/6.2?item=i18&from=2026-09-01&to=2026-09-30")
            assert any(r.get("ref") == cn["no"] for r in book["rows"]), "CN missing from 6.2"; ok("credit note appears in the Mushak 6.2 book")
        except Exception as e: fail(5, e)

        # ── 6. Price declarations (Mushak 4.3) ────────────────────────
        try:
            await pg.goto(BASE + "/en/production/bom", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Price declarations (BOM)")).to_be_visible()
            await pg.get_by_role("button", name="BOM-FG-017-v1", exact=True).click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("Superseded").first).to_be_visible()
            await dlg.get_by_role("tab", name="Compare versions").click()
            row = dlg.get_by_role("row").filter(has_text="Aluminium Foil 20").locator("visible=true").first
            await expect(row).to_contain_text("1.0350"); await expect(row).to_contain_text("1.0200"); ok("compare versions: foil gross coefficient 1.0350 → 1.0200")
            await dlg.get_by_role("tab", name="Mushak 4.3").click()
            await expect(dlg.get_by_text("মূসক-৪.৩").first).to_be_visible(); await settle(pg); await pg.screenshot(path=f"{OUT}/85_bom_43.png"); ok("Mushak 4.3 renders")
            v2 = await jget(appr, "/production/boms/bom2")
            foil = next(i for i in v2["inputs"] if i["itemId"] == "i6")
            assert foil["grossQty"] == 1.02 and abs(v2["materialValue"] + v2["valueAdded"] - v2["price"]) < 0.01, v2
            assert v2["price"] == 1180 and len(v2["versions"]) == 2; ok("4.3 coefficients: gross = qty × (1 + wastage); price = material + value added")
            cur = next(x for x in (await jget(appr, "/production/boms?item=i19&size=10"))["data"] if x["process"] == "Approved")
            payload = {"itemId": "i19", "effectiveDate": "2026-10-01", "licenseDate": "", "inputs": [{"itemId": i["itemId"], "qty": i["qty"], "wastagePct": i["wastagePct"], "price": i["price"]} for i in cur["inputs"]],
                       "costs": cur["costs"], "amendmentReason": "", "note": "", "process": "Created"}
            st, _ = await post(appr, "/production/boms", payload)
            assert st == 422, st; ok("new version without an amendment reason → 422")
            payload["amendmentReason"] = "PVDC coating weight revised by the customer."
            st, nb = await post(appr, "/production/boms", payload)
            assert st == 201 and nb["version"] == cur["version"] + 1 and nb["process"] == "Created", (st, nb)
            st, _ = await post(appr, "/production/boms", payload)
            assert st == 409, st; ok("amendment saved as next version; a second draft for the item → 409")
            st, _ = await patch(appr, f"/production/boms/{nb['id']}", {"process": "Approved"})
            assert st == 200, st
            old = await jget(appr, f"/production/boms/{cur['id']}")
            assert old.get("supersededAt"), old; ok("approving the new version supersedes the previous one")
        except Exception as e: fail(6, e)

        # ── 7. Work order → in-house batch (UI) ───────────────────────
        try:
            st, wo = await post(appr, "/production/work-orders", {"requisitionNo": "REQ-E2E-1", "issueDate": TODAY, "dueDate": "2026-10-10", "remark": "E2E", "lines": [{"itemId": "i22", "qty": 500}], "process": "Approved"})
            assert st == 201, (st, wo)
            await pg.goto(BASE + f"/en/production/work-orders?view={wo['id']}", wait_until="networkidle")
            await pg.get_by_role("link", name="New batch from this work order").click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("New production batch")).to_be_visible()
            await expect(dlg.get_by_text(re.compile(r"500 Kg left on the work order"))).to_be_visible(); ok("New batch from a work order pre-fills its open lines")
            await dlg.get_by_label(re.compile(r"^Issue qty")).first.fill("500")
            await dlg.get_by_label(re.compile(r"^Receive qty")).first.fill("400"); await dlg.get_by_label(re.compile(r"^Damage qty")).first.fill("150")
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(dlg.get_by_text("Received + damaged is more than issued.").first).to_be_visible(); ok("received + damaged above issued is rejected")
            await dlg.get_by_label(re.compile(r"^Damage qty")).first.fill("10")
            await dlg.get_by_label(re.compile(r"^Receive qty")).first.fill("490")
            await expect(dlg.get_by_role("heading", name="Input consumption (BOM standard)")).to_be_visible()
            fg0, in0 = await stock(appr, "i22"), await stock(appr, "i7")
            await settle(pg); await pg.screenshot(path=f"{OUT}/86_batch_form.png")
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_text(re.compile(r"PB-\d{8} approved — stock updated"))).to_be_visible()
            assert await stock(appr, "i22") == round(fg0 + 490, 2) and await stock(appr, "i7") == round(in0 - 178.5, 2), (await stock(appr, "i22"), await stock(appr, "i7"))
            ok("approved batch: finished goods +490; input consumed 0.35 × 1.02 × 500 = 178.5")
            w = await jget(appr, f"/production/work-orders/{wo['id']}")
            assert w["lines"][0]["remaining"] == 0 and w["status"] == "completed" and len(w["batches"]) == 1, w; ok("work order completes when its batches cover the quantity")
            st, _ = await patch(appr, f"/production/work-orders/{wo['id']}", {"process": "Cancelled", "reason": "E2E cancel attempt with notes"})
            assert st == 409, st; ok("work order with live batches cannot be cancelled (409)")
            st, _ = await post(appr, "/production/batches", batch("inHouse", [{"itemId": "i22", "workOrderId": wo["id"], "issueQty": 10, "receiveQty": 10}]))
            assert st == 422, st; ok("issuing beyond the work order's open quantity → 422")
        except Exception as e:
            fail(7, e)
            await pg.screenshot(path=f"/tmp/fail_r3_7.png")

        # ── 8. Contractual batch: receive + Mushak 6.4 ────────────────
        try:
            await pg.goto(BASE + "/en/production/batches?view=pb7&tab=receive", wait_until="networkidle")
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("Awaiting return").first).to_be_visible()
            rq = dlg.get_by_label(re.compile("Received quantity of Cold Form"))
            await rq.fill("450")
            await expect(dlg.get_by_role("button", name="Save receipt")).to_be_disabled(); ok("receiving more than was issued to the contractor is blocked")
            await rq.fill("390"); await dlg.get_by_label(re.compile("Damaged quantity of Cold Form")).fill("10")
            before = await stock(appr, "i18")
            await dlg.get_by_role("button", name="Save receipt").click()
            await expect(pg.get_by_text(re.compile(r"PB-09260003 — goods received into stock"))).to_be_visible()
            assert await stock(appr, "i18") == before + 390; ok("contractual receipt adds 390 to finished-goods stock")
            await pg.goto(BASE + "/en/production/batches?view=pb7&tab=mushak", wait_until="networkidle")
            await expect(pg.get_by_role("dialog").get_by_text("মূসক-৬.৪").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/87_batch_64.png"); ok("Mushak 6.4 renders for the contractual batch")
            st, _ = await post(appr, "/production/batches/pb7/receive", {"receiveDate": TODAY, "lines": [{"receiveQty": 1, "damageQty": 0}]})
            assert st == 409, st; ok("second receipt on a received batch → 409")
            st, _ = await post(appr, "/production/batches", batch("contractual", [{"itemId": "i22", "issueQty": 5}], vendorId="v1"))
            assert st == 422, st; ok("contractual batch with a foreign vendor → 422")
        except Exception as e: fail(8, e)

        # ── 9. Production opening ─────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/production/opening", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Production opening")).to_be_visible()
            await expect(pg.get_by_role("button", name="PB-07250001", exact=True)).to_be_visible(); ok("production opening lists opening batches only")
            before = await stock(appr, "i19")
            st, d = await post(appr, "/production/batches", batch("opening", [{"itemId": "i19", "issueQty": 50, "receiveQty": 50, "unitCost": 400}], issueDate="2025-07-01", receiveDate="2025-07-01"))
            assert st == 201 and d["value"] == 20000 and d["consumption"] == [], (st, d)
            assert await stock(appr, "i19") == before + 50; ok("opening batch: 50 × ৳400 enters stock without consuming inputs")
        except Exception as e:
            fail(9, e)
            await pg.screenshot(path=f"/tmp/fail_r3_9.png")

        # ── 10. Config + role gating ──────────────────────────────────
        try:
            admin = await login_ctx(b, "admin", viewport=VP)
            oper = await login_ctx(b, "kamal", viewport=VP)
            view = await login_ctx(b, "auditor", viewport=VP)
            r = await oper.request.put(API + "/production/config", data={"procedure": "workOrder", "consumption": "standard"})
            assert r.status == 403, r.status; ok("operator cannot change the production config (403)")
            r = await admin.request.put(API + "/production/config", data={"procedure": "workOrder", "consumption": "standard"})
            assert r.ok, r.status
            st, _ = await post(appr, "/production/batches", batch("inHouse", [{"itemId": "i21", "issueQty": 100, "receiveQty": 100}], process="Created"))
            assert st == 422, st; ok("procedure “work order”: a batch line without a work order → 422")
            r = await admin.request.put(API + "/production/config", data={"procedure": "directStock", "consumption": "standard"}); assert r.ok
            apg = await admin.new_page(); watch(apg, errs)
            await apg.goto(BASE + "/en/production/config", wait_until="networkidle")
            await expect(apg.get_by_role("radio", name=re.compile("Direct"))).to_be_checked()
            await settle(apg); await apg.screenshot(path=f"{OUT}/88_production_config.png"); ok("config page shows the restored procedure")
            await apg.close()
            st, d = await post(oper, "/production/batches", batch("inHouse", [{"itemId": "i21", "issueQty": 100, "receiveQty": 100}], process="Created"))
            assert st == 201, (st, d)
            st2, _ = await patch(oper, f"/production/batches/{d['id']}", {"process": "Approved"})
            assert st2 == 403, st2; ok("operator can draft a batch but not approve it (403)")
            dash = await jget(appr, "/dashboard")
            assert dash["kpis"]["pendingApproval"] >= 1
            st, _ = await post(view, "/production/boms", {"itemId": "i19"})
            assert st == 403, st
            vpg = await view.new_page(); watch(vpg, errs)
            await vpg.goto(BASE + "/en/production/bom", wait_until="networkidle")
            await expect(vpg.get_by_role("heading", name="Price declarations (BOM)")).to_be_visible()
            await expect(vpg.get_by_role("link", name="New declaration")).to_have_count(0); ok("viewer sees declarations read-only (no New, POST 403)")
            await vpg.close()
        except Exception as e: fail(10, e)

        # ── 11. Bangla + legacy typos ─────────────────────────────────
        try:
            await pg.goto(BASE + "/bn/production/batches", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="উৎপাদন ব্যাচ")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/89_batches_bn.png"); ok("Bangla batch list renders")
            text = ""
            for u in ("/en/production/opening", "/en/production/work-orders", "/en/production/batches", "/en/sales/exports"):
                await pg.goto(BASE + u, wait_until="networkidle"); text += await pg.locator("body").inner_text()
            bad = [w for w in ("Opeining", "Requsition", "Purachse", "Comapny", "In-Houe") if w in text]
            assert not bad, bad; ok("legacy typos (Opeining, Requsition, Purachse, Comapny, In-Houe) are gone")
        except Exception as e: fail(11, e)

        real = [e for e in errs if "418" not in e and "Failed to load resource" not in e]
        if real: failures.append(f"console errors: {real[:5]}")
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
