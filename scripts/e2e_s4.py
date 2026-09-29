"""Sprint 4 end-to-end checks: units master, branch on documents, stock transfers (Mushak 6.5), damage & wastage,
finished goods by branch, per-record History (S4-06) and the deferred dashboard charts (S4-03).
Run after e2e_s3.py (it creates documents and a unit; restart the server for a fresh seed)."""
import asyncio, os, random, re
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

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP)
        pg = await appr.new_page(); watch(pg, errs)
        code = f"Z{random.randint(100, 999)}"

        # ── 1. Units master ───────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/master/units", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Units of measure")).to_be_visible()
            await expect(pg.locator("tbody tr")).to_have_count(7); ok("units list shows the 7 seeded units")
            await expect(pg.get_by_role("button", name="Delete Kg")).to_be_disabled(); ok("a unit in use cannot be deleted")
            await settle(pg); await pg.screenshot(path=f"{OUT}/60_units.png")
            await pg.get_by_role("button", name="Edit Kg").click()
            await expect(pg.locator("#code")).to_have_attribute("readonly", ""); ok("code of a unit in use is locked")
            await pg.get_by_role("button", name="Cancel").click()
            await pg.get_by_role("button", name="New unit").click()
            await pg.get_by_role("button", name="Save").click()
            await expect(pg.get_by_role("alert").filter(has_text="required")).not_to_have_count(0); ok("new unit: required fields flagged")
            await pg.locator("#code").fill("1bad"); await pg.locator("#name").fill("Bad code"); await pg.get_by_role("button", name="Save").click()
            await expect(pg.get_by_role("alert").filter(has_text="starting with a letter")).to_be_visible(); ok("new unit: code format validated")
            await pg.locator("#code").fill(code); await pg.locator("#name").fill("E2E dozen")
            await settle(pg); await pg.screenshot(path=f"{OUT}/61_unit_new.png")
            await pg.get_by_role("button", name="Save").click()
            await expect(pg.get_by_text(f"Unit {code} added")).to_be_visible()
            await expect(pg.locator("tbody tr").filter(has_text=code)).to_have_count(1); ok("unit created and listed")
            await pg.get_by_role("button", name=f"Delete {code}").click()
            await pg.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
            await expect(pg.get_by_text(f"Unit {code} deleted")).to_be_visible(); ok("unused unit deleted")
        except Exception as e: fail(1, e)

        # ── 2. Stock transfer: form → draft → approve → stock moved ──
        try:
            stock = await jget(appr, "/stock?size=500")
            pick = next(r for r in stock["data"] if r["active"] and r["group"] == "Finished Goods" and (r["byBranch"].get("b1") or 0) >= 20)
            b1, b3 = pick["byBranch"].get("b1", 0), pick["byBranch"].get("b3", 0)
            await pg.goto(BASE + "/en/inventory/transfers", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Stock transfers")).to_be_visible()
            await expect(pg.locator("tbody tr")).not_to_have_count(0); ok("transfer list renders the seeded transfers")
            await settle(pg); await pg.screenshot(path=f"{OUT}/62_transfers.png")
            await pg.get_by_role("button", name="New transfer").click()
            await expect(pg.get_by_role("dialog").get_by_text("New stock transfer")).to_be_visible()
            await pg.get_by_role("button", name="Save draft").click()
            await expect(pg.get_by_role("dialog").get_by_role("alert")).not_to_have_count(0); ok("transfer: item line required")
            await pg.get_by_role("combobox", name="Item 1").click()
            await pg.get_by_role("option", name=re.compile(re.escape(pick["name"][:24]))).first.click()
            await pg.locator('[id="lines.0.qty"]').fill(str(int(b1) + 1000))
            await expect(pg.get_by_role("dialog").get_by_text("exceed the stock")).to_be_visible()
            await expect(pg.get_by_role("button", name="Save & approve")).to_be_disabled(); ok("transfer: over-stock blocks approval")
            await pg.locator('[id="lines.0.qty"]').fill("5")
            await settle(pg); await pg.screenshot(path=f"{OUT}/63_transfer_form.png")
            await pg.get_by_role("button", name="Save draft").click()
            await expect(pg.get_by_text(re.compile(r"TR-\d+ saved as draft"))).to_be_visible(); ok("transfer saved as draft")
            drafts = await jget(appr, "/transfers?process=Created&sort=no.desc&size=1")
            t = drafts["data"][0]
            after = await jget(appr, "/stock?size=500"); row = next(r for r in after["data"] if r["id"] == pick["id"])
            assert row["byBranch"].get("b1", 0) == b1, "draft moved stock"; ok("draft transfer does not move stock")
            await pg.goto(BASE + f"/en/inventory/transfers?view={t['id']}", wait_until="networkidle")
            await expect(pg.get_by_role("dialog").get_by_text(t["no"]).first).to_be_visible()
            await pg.get_by_role("dialog").get_by_role("button", name="Approve").click()
            await expect(pg.get_by_text(re.compile("approved"))).not_to_have_count(0)
            await pg.wait_for_timeout(400)
            after = await jget(appr, "/stock?size=500"); row = next(r for r in after["data"] if r["id"] == pick["id"])
            assert abs(row["byBranch"].get("b1", 0) - (b1 - 5)) < 1e-6 and abs(row["byBranch"].get("b3", 0) - (b3 + 5)) < 1e-6, row["byBranch"]
            assert abs(row["remain"] - pick["remain"]) < 1e-6, "company stock changed"; ok("approved transfer moves 5 units factory → store; company total unchanged")
            await pg.get_by_role("dialog").get_by_role("tab", name="History").click()
            await expect(pg.get_by_role("dialog").get_by_text("Approved").first).to_be_visible(); ok("transfer History tab lists the approval")
            await settle(pg); await pg.screenshot(path=f"{OUT}/64_transfer_history.png")
            await pg.keyboard.press("Escape")
            led = await jget(appr, f"/items/{pick['id']}/ledger?branch=b3")
            assert any(m["type"] == "transferIn" and m.get("ref") == t["no"] for m in led["entries"]), "no transferIn row"; ok("branch ledger shows the transfer in")
        except Exception as e: fail(2, e)

        # ── 3. Damage & wastage ──────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/inventory/damage?new=1", wait_until="networkidle")
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("New damage entry")).to_be_visible()
            await dlg.get_by_role("combobox", name="Reason").click()
            await pg.get_by_role("option", name="Lost / stolen").click()
            await expect(dlg.get_by_text("GD or insurance reference")).to_be_visible(); ok("damage: reason hint explains 'lost'")
            await dlg.get_by_role("combobox", name="Item 1").click()
            await pg.get_by_role("option").filter(has_not=pg.locator("[aria-disabled=true]")).first.click()
            await pg.locator('[id="lines.0.qty"]').fill("1")
            await pg.locator("#note").fill("gone")
            await dlg.get_by_role("button", name="Save draft").click()
            await expect(dlg.get_by_role("alert").filter(has_text="10 characters")).to_be_visible(); ok("damage: 'lost' needs a 10-character note")
            await pg.locator("#note").fill("GD 1234/26 Kaliakair PS — pallet missing")
            await settle(pg); await pg.screenshot(path=f"{OUT}/65_damage_form.png")
            await dlg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_text(re.compile(r"DM-\d+ approved"))).to_be_visible(); ok("damage entry approved (stock written off)")
            await pg.goto(BASE + "/en/inventory/damage", wait_until="networkidle")
            await settle(pg); await pg.screenshot(path=f"{OUT}/66_damage.png")
        except Exception as e: fail(3, e)

        # ── 4. Finished goods by branch + branch ledger ──────────────
        try:
            await pg.goto(BASE + "/en/inventory/finished-goods", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Finished goods")).to_be_visible()
            await expect(pg.get_by_text("Factory — Kaliakair").first).to_be_visible(); ok("finished goods shows stock by branch")
            await settle(pg); await pg.screenshot(path=f"{OUT}/67_finished_goods.png")
            await pg.goto(BASE + "/en/inventory/items?ledger=i1", wait_until="networkidle")
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_role("tab", name="Movements")).to_be_visible()
            await dlg.get_by_role("tab", name="History").click()
            await expect(dlg.get_by_text(re.compile("No changes recorded|Created|Edited")).first).to_be_visible(); ok("item ledger has a History tab")
            await pg.keyboard.press("Escape")
        except Exception as e: fail(4, e)

        # ── 5. Branch on sales & purchases, History on detail ────────
        try:
            await pg.goto(BASE + "/en/sales/new", wait_until="networkidle")
            await expect(pg.get_by_role("combobox", name="Branch / warehouse")).to_be_visible(); ok("sale form has a branch select")
            await expect(pg.get_by_text("Stock leaves this branch")).to_be_visible()
            await pg.goto(BASE + "/en/purchases/new", wait_until="networkidle")
            await expect(pg.get_by_role("combobox", name="Receiving branch")).to_be_visible(); ok("purchase form has a receiving-branch select")
            await pg.goto(BASE + "/en/sales/s1", wait_until="networkidle")
            await expect(pg.get_by_text("Factory — Kaliakair").first).to_be_visible(); ok("sale detail shows the branch")
            await pg.get_by_role("tab", name="History").click()
            await expect(pg.get_by_text("Open in audit trail")).to_be_visible(); ok("sale History tab links to the filtered audit trail")
            await settle(pg); await pg.screenshot(path=f"{OUT}/68_sale_history.png")
            await pg.get_by_role("tab", name="Mushak 6.3").click()
            await expect(pg.get_by_text(re.compile("Address of issue: Factory — Kaliakair"))).to_be_visible(); ok("Mushak 6.3 prints the issuing branch address")
            await pg.goto(BASE + "/en/purchases/p1", wait_until="networkidle")
            await pg.get_by_role("tab", name="History").click()
            await expect(pg.get_by_text("Open in audit trail")).to_be_visible(); ok("purchase detail has a History tab")
            # viewer without audit.view on a sale: explained, not an error. Operators lack audit.view.
            op = await login_ctx(b, "kamal", viewport=VP); opg = await op.new_page(); watch(opg, errs)
            await opg.goto(BASE + "/en/sales/s1?tab=history", wait_until="networkidle")
            await expect(opg.get_by_text("visible to users with audit access")).to_be_visible(); ok("History explains missing audit access")
            await op.close()
        except Exception as e: fail(5, e)

        # ── 6. Audit trail knows the new record types ────────────────
        try:
            ev = await jget(appr, "/audit?entity=transfer&size=5")
            assert ev["total"] > 0, "no transfer audit events"; ok("transfer approvals are audited")
            await pg.goto(BASE + "/en/master/audit?entity=transfer,damage,unit", wait_until="networkidle")
            await expect(pg.locator("tbody tr")).not_to_have_count(0)
            await pg.locator("tbody tr").first.click()
            await expect(pg.get_by_role("dialog").get_by_text("Open record")).to_be_visible(); ok("audit sheet links to transfers/damage/units")
            await pg.keyboard.press("Escape")
        except Exception as e: fail(6, e)

        # ── 7. Dashboard charts load after first paint (S4-03) ───────
        try:
            await pg.goto(BASE + "/en", wait_until="domcontentloaded")
            await expect(pg.locator(".recharts-surface").first).to_be_visible(timeout=15000)
            await expect(pg.locator(".recharts-wrapper")).to_have_count(2); ok("both dashboard charts render (deferred chunk)")
        except Exception as e: fail(7, e)

        # ── 8. Bangla ─────────────────────────────────────────────────
        try:
            bn = await login_ctx(b, "arif", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            for u in ("/bn/master/units", "/bn/inventory/finished-goods", "/bn/inventory/damage", "/bn/inventory/transfers"):
                await bp.goto(BASE + u, wait_until="networkidle"); await bp.wait_for_timeout(400)
            await expect(bp.get_by_role("heading", name="মজুদ স্থানান্তর")).to_be_visible()
            await settle(bp); await bp.screenshot(path=f"{OUT}/69_transfers_bn.png"); ok("Sprint 4 pages render in Bangla")
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
