"""R2 end-to-end checks (Purchase & Inventory): import purchase with the Bill-of-Entry duty stack, service purchase,
debit note (Mushak 6.8) against the import, opening stock, master items with tariff overrides, Mushak 6.1 / 6.2 books,
role gating and Bangla. Run on a fresh server (it creates documents)."""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
os.makedirs(OUT, exist_ok=True)
API = BASE + "/api/v1"
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

def fid(i): return f'[id="{i}"]'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP)
        pg = await appr.new_page(); watch(pg, errs)
        imp_id = None

        # ── 1. Import purchase (Bill of Entry + duty stack) ────────────
        try:
            await pg.goto(BASE + "/en/purchases", wait_until="networkidle")
            await pg.get_by_role("link", name="New import").click()
            await expect(pg.get_by_role("heading", name="New import purchase")).to_be_visible(); ok("purchases list → New import opens the BoE form")
            await pg.locator("#vendorId").click(); await pg.get_by_role("option").first.click()
            await pg.locator("#challanNo").fill("C-7788001"); await pg.locator("#challanDate").fill("2026-09-20"); await pg.locator("#issueDate").fill("2026-09-22")
            await pg.locator(fid("boe.lcNo")).fill("LC-E2E-01"); await pg.locator(fid("boe.lcDate")).fill("2026-09-22")
            origin = pg.locator(fid("boe.origin"))
            if "China" not in (await origin.inner_text()):
                await origin.click(); await pg.get_by_role("option", name="China").click()
            await pg.get_by_role("combobox", name="Item 1").click(); await pg.get_by_role("option", name=re.compile("Aluminium Foil 20")).first.click()
            await expect(pg.get_by_text(re.compile(r"Rates from tariff HS 7607\.11\.10"))).to_be_visible()
            await expect(pg.locator("#l0-cdRate")).to_have_value("5"); ok("picking the item pre-fills duty rates from the tariff")
            await pg.locator("#l0-qty").fill("1000"); await pg.locator("#l0-usd").fill("5000"); await pg.locator("#l0-usdRate").fill("122")
            for k, v in (("cdRate", "10"), ("rdRate", "3"), ("sdRate", "0"), ("vatRate", "15"), ("aitRate", "5"), ("atRate", "5")): await pg.locator(f"#l0-{k}").fill(v)
            summ = pg.get_by_role("complementary", name="Summary")
            await expect(summ).to_contain_text("6,10,000.00"); await expect(summ).to_contain_text("2,47,660.00")
            await expect(summ).to_contain_text("1,37,860.00"); await expect(summ).to_contain_text("8,57,660.00")
            ok("live duty summary: AV 610,000 · TTI 247,660 · rebate 137,860 · landed 857,660")
            await settle(pg); await pg.screenshot(path=f"{OUT}/70_import_form.png", full_page=True)
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_role("alert").filter(has_text="LC date must be on or before")).to_be_visible(); ok("LC date after the BoE date is rejected (lcAfterBoe)")
            await pg.locator(fid("boe.lcDate")).fill("2026-08-10")
            before = (await jget(appr, "/items/i6"))["remain"]
            await pg.get_by_role("button", name="Save & approve").click()
            await pg.wait_for_url(re.compile(r"/purchases/p\d+$")); imp_id = pg.url.rsplit("/", 1)[1]
            await expect(pg.get_by_text("Bill of Entry", exact=True).first).to_be_visible()
            await expect(pg.get_by_role("region", name="Items & duties")).to_contain_text("2,47,660.00"); ok("approved import shows BoE panel and duty table")
            doc = await jget(appr, f"/purchases/{imp_id}")
            assert doc["tti"] == 247660 and doc["rebate"] == 137860 and doc["boe"]["lcNo"] == "LC-E2E-01", doc
            assert (await jget(appr, "/items/i6"))["remain"] == before + 1000; ok("API: TTI/rebate stored to 2 dp, stock +1000")
            await settle(pg); await pg.screenshot(path=f"{OUT}/71_import_detail.png", full_page=True)
        except Exception as e: fail(1, e)

        # ── 2. Service purchase ───────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/purchases/services", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Service purchases")).to_be_visible()
            n0 = (await jget(appr, "/purchases?category=service&size=1"))["total"]
            await pg.get_by_role("link", name="New service purchase").click()
            await expect(pg.get_by_role("heading", name="New service purchase")).to_be_visible()
            await expect(pg.locator(fid("branchId"))).to_have_count(0); ok("service form: no receiving branch (no stock)")
            await pg.locator("#vendorId").click(); await pg.get_by_role("option").first.click()
            await pg.locator("#challanNo").fill("SV-E2E-9")
            await pg.get_by_role("combobox", name="Service 1").click(); await pg.get_by_role("option", name=re.compile("Goods transport")).click()
            await pg.get_by_label("Qty 1", exact=True).fill("4"); await pg.get_by_label("Unit price 1", exact=True).fill("2500")
            await expect(pg.get_by_role("checkbox", name="VDS 1")).to_be_checked(); ok("service code sets VAT rate and pre-ticks VDS")
            await pg.get_by_role("button", name=re.compile("Save as draft|Save draft")).click()
            await pg.wait_for_url(re.compile(r"/purchases/p\d+$"))
            await expect(pg.get_by_text("Service", exact=True).first).to_be_visible()
            sid = pg.url.rsplit("/", 1)[1]; d = await jget(appr, f"/purchases/{sid}")
            assert d["category"] == "service" and d["invoiceNo"].startswith("PS-") and d["vat"] == 1000, d
            assert (await jget(appr, "/purchases?category=service&size=1"))["total"] == n0 + 1; ok("service purchase saved as PS- draft with 10% VAT, listed under services")
        except Exception as e: fail(2, e)

        # ── 3. Debit note against the import (Mushak 6.8) ──────────────
        try:
            assert imp_id, "import not created"
            await pg.goto(BASE + f"/en/purchases/{imp_id}", wait_until="networkidle")
            await pg.get_by_role("link", name="Raise debit note").click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("New debit note")).to_be_visible()
            qty = dlg.get_by_label(re.compile("Return quantity for Aluminium Foil 20"))
            await expect(qty).to_be_visible(); ok("Raise debit note pre-selects the purchase and lists its lines")
            await qty.fill("2000")
            await expect(dlg.get_by_role("alert").filter(has_text="More than the quantity left").first).to_be_visible()
            await expect(dlg.get_by_role("button", name="Save & approve")).to_be_disabled(); ok("return above remaining is blocked")
            await qty.fill("100")
            before = (await jget(appr, "/items/i6"))["remain"]
            await settle(pg); await pg.screenshot(path=f"{OUT}/72_debit_form.png")
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_text(re.compile(r"DN-\d{8} approved — stock returned"))).to_be_visible()
            assert (await jget(appr, "/items/i6"))["remain"] == before - 100; ok("approved debit note reduces stock by 100")
            dn = (await jget(appr, f"/debit-notes?purchase={imp_id}"))["data"][0]
            assert dn["rebate"] == 13786 and dn["tti"] == 24766, dn; ok("debit note reverses 10% of TTI (24,766) and credit (13,786)")
            await pg.goto(BASE + f"/en/purchases/debit-notes?view={dn['id']}&tab=mushak", wait_until="networkidle")
            await expect(pg.get_by_text("মূসক-৬.৮")).to_be_visible(); await settle(pg); await pg.screenshot(path=f"{OUT}/73_debit_68.png"); ok("Mushak 6.8 renders")
            r = await appr.request.patch(f"{API}/purchases/{imp_id}", data={"process": "Cancelled", "reason": "E2E cancel attempt with notes"})
            assert r.status == 409, r.status; ok("purchase with a debit note cannot be cancelled (409)")
            await pg.goto(BASE + f"/en/purchases/{imp_id}", wait_until="networkidle")
            await expect(pg.get_by_role("link", name=dn["no"])).to_be_visible(); ok("purchase detail lists its debit notes")
        except Exception as e: fail(3, e)

        # ── 4. Opening stock ──────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/purchases/opening", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Opening stock")).to_be_visible()
            await pg.get_by_role("button", name="New opening entry").click()
            dlg = pg.get_by_role("dialog")
            await dlg.locator("#itemId").click(); await pg.get_by_role("option", name=re.compile("Aluminium Foil 20")).first.click()
            await expect(dlg.get_by_text(re.compile("Current opening balance"))).to_be_visible()
            await expect(dlg.locator("#price")).not_to_have_value(""); ok("opening form pre-fills unit cost and shows current balance")
            await dlg.locator("#qty").fill("50")
            op0 = (await jget(appr, "/items/i6"))["opening"]
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_text(re.compile(r"OS-\d{8} approved — stock updated"))).to_be_visible()
            assert (await jget(appr, "/items/i6"))["opening"] == op0 + 50; ok("approved opening entry raises the item opening balance")
        except Exception as e: fail(4, e)

        # ── 5. Master items: wizard, tariff pre-fill, override reason ──
        try:
            await pg.goto(BASE + "/en/inventory/master-items", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Master items")).to_be_visible()
            await pg.get_by_role("button", name="New master item").click()
            dlg = pg.get_by_role("dialog")
            await dlg.get_by_role("button", name="Next").click()
            await expect(dlg.get_by_role("alert").first).to_be_visible(); ok("wizard step 1 requires an HS code")
            await dlg.locator("#hsCode").click(); await pg.get_by_placeholder("HS code or description…").fill("7607"); await pg.get_by_role("option").first.click()
            await expect(dlg.get_by_text(re.compile("These rates will pre-fill"))).to_be_visible()
            await dlg.get_by_role("button", name="Next").click()
            await dlg.locator("#name").fill("E2E Foil Master")
            await dlg.get_by_role("button", name="Next").click()
            await expect(dlg.get_by_text("Tariff 15%").first).to_be_visible(); ok("tax profile defaults to tariff rates")
            await dlg.locator(fid("rates.vat")).fill("10")
            await expect(dlg.get_by_text(re.compile("Differs from the tariff: VAT"))).to_be_visible()
            await dlg.get_by_role("button", name="Create master item").click()
            await expect(dlg.get_by_role("alert").filter(has_text="Give a reason")).to_be_visible(); ok("override without reason is rejected")
            await dlg.locator("#overrideReason").fill("SRO 2026 reduced rate for pharma foil")
            await settle(pg); await pg.screenshot(path=f"{OUT}/74_master_wizard.png")
            await dlg.get_by_role("button", name="Create master item").click()
            await expect(pg.get_by_text("E2E Foil Master created")).to_be_visible()
            await pg.goto(BASE + "/en/inventory/master-items?q=E2E", wait_until="networkidle")
            await expect(pg.locator("tbody tr").filter(has_text="E2E Foil Master")).to_contain_text("VAT"); ok("created master item listed with its override flagged")
        except Exception as e: fail(5, e)

        # ── 6. Mushak 6.1 / 6.2 books ─────────────────────────────────
        try:
            await pg.goto(BASE + "/en/vat/mushak-6-1", wait_until="networkidle")
            await expect(pg.get_by_text("Select an input item").first).to_be_visible(); ok("6.1 asks for an item first")
            await pg.goto(BASE + "/en/vat/mushak-6-1?item=i6", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name=re.compile("Purchase account book"))).to_be_visible()
            book = await jget(appr, "/mushak/6.1?item=i6&from=2026-07-01&to=2026-09-25")
            assert book["closing"]["qty"] == (await jget(appr, "/items/i6"))["remain"], (book["closing"], "stock")
            await expect(pg.locator("tbody tr")).to_have_count(len(book["rows"])); ok(f"6.1 table has {len(book['rows'])} rows; closing = stock on hand")
            await expect(pg.get_by_role("link", name="Export CSV")).to_have_attribute("href", re.compile(r"format=csv"))
            await settle(pg); await pg.screenshot(path=f"{OUT}/75_mushak_61.png")
            await pg.goto(BASE + "/en/vat/mushak-6-1?item=i6&from=2026-09-10&to=2026-09-01", wait_until="networkidle")
            await expect(pg.get_by_text("End date is before the start date.")).to_be_visible(); ok("inverted date range flagged")
            await pg.goto(BASE + "/en/vat/mushak-6-2?item=i17", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name=re.compile("Sales account book"))).to_be_visible()
            await expect(pg.locator("tbody tr").first).to_be_visible(); ok("6.2 renders for a finished-goods item")
            r = await appr.request.get(f"{API}/mushak/6.2?item=i6&from=2026-07-01&to=2026-09-25"); assert r.status == 422; ok("6.2 rejects an input item (422)")
        except Exception as e: fail(6, e)

        # ── 7. Role gating (operator: may create, may not approve or edit master data) ──
        # (auditor is deactivated by e2e_s3.py earlier in the chain, so the operator carries this check)
        try:
            v = await login_ctx(b, "kamal", viewport=VP); vp = await v.new_page(); watch(vp, errs)
            await vp.goto(BASE + "/en/inventory/master-items", wait_until="networkidle")
            await expect(vp.get_by_role("heading", name="Master items")).to_be_visible()
            assert await vp.get_by_role("button", name="New master item").count() == 0; ok("operator cannot create master items")
            await vp.goto(BASE + "/en/purchases/debit-notes?new=1", wait_until="networkidle")
            dlg = vp.get_by_role("dialog")
            await expect(dlg.get_by_role("button", name="Save draft")).to_be_visible()
            assert await dlg.get_by_role("button", name="Save & approve").count() == 0; ok("operator can draft a debit note but not approve it")
            r = await v.request.post(f"{API}/opening-stock", data={"itemId": "i1", "branchId": "b1", "date": "2026-09-20", "inputTax": "standard", "qty": 1, "price": 10, "process": "Approved"})
            assert r.status == 403, r.status; ok("API refuses an operator approving on create (403)")
            await v.close()
        except Exception as e: fail(7, e)

        # ── 8. Bangla ─────────────────────────────────────────────────
        try:
            bn = await login_ctx(b, "arif", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            for u in ("/bn/purchases/debit-notes", "/bn/purchases/opening", "/bn/inventory/master-items", "/bn/purchases/new?type=import", "/bn/purchases/services"):
                await bp.goto(BASE + u, wait_until="networkidle"); await bp.wait_for_timeout(300)
            await bp.goto(BASE + "/bn/vat/mushak-6-2?item=i17", wait_until="networkidle")
            await expect(bp.get_by_role("heading", name=re.compile("বিক্রয় হিসাব পুস্তক")).first).to_be_visible()
            await settle(bp); await bp.screenshot(path=f"{OUT}/76_mushak_62_bn.png"); ok("R2 pages render in Bangla")
            await bn.close()
        except Exception as e: fail(8, e)

        await appr.close()
        bad = [e for e in errs if "MISSING_MESSAGE" in e or "FORMATTING_ERROR" in e or e.startswith("pageerror")]
        print("console/page errors:", len(errs), errs[:8])
        assert not bad, bad; ok("no page errors or missing/invalid i18n messages")
        await b.close()
    print(f"\n{sum(1 for r in results if r[0]=='PASS')} checks passed, {len(failures)} section(s) failed")
    if failures: raise SystemExit("\n".join(failures))

asyncio.run(main())
