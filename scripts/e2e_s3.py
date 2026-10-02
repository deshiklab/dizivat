"""Sprint 3 end-to-end checks: users & roles, forced password change, company profile, tariff + HS lookup,
audit trail, notifications. Run after e2e_s2.py (it mutates users; restart the server for a fresh seed)."""
import asyncio, os, random, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
os.makedirs(OUT, exist_ok=True)
results = []
def ok(m): results.append(("PASS", m)); print("PASS", m)
failures = []
def fail(section, e):
    """Record and continue: later sections are mostly independent, so one run reports every broken check."""
    import traceback
    msg = f"section {section}: {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"
    failures.append(msg); print("FAIL", msg); traceback.print_exc(limit=1)
def watch(pg, errs):
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)[:200]))
    pg.on("console", lambda m: errs.append(m.text[:240]) if m.type == "error" else None)
VP = {"width": 1440, "height": 900}

async def settle(pg):
    """Screenshots must not catch a sheet/dialog/popover mid-transition: wait for every running animation."""
    await pg.wait_for_timeout(50)
    await pg.evaluate("Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))")
    await pg.wait_for_timeout(80)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        uname = f"e2e{random.randint(1000, 9999)}"

        # ── 1. Admin invites a user → one-time password ───────────────
        try:
            admin = await login_ctx(b, "admin", viewport=VP)
            pg = await admin.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/master/users", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Users & roles")).to_be_visible()
            await expect(pg.locator("tbody tr")).to_have_count(6); ok("users list shows the 6 seeded accounts")
            await settle(pg); await pg.screenshot(path=f"{OUT}/46_users.png")
            await pg.get_by_role("button", name="Invite user").click()
            await pg.get_by_role("button", name="Invite", exact=True).click()
            await expect(pg.get_by_role("alert").filter(has_text="This field is required")).to_have_count(4); ok("invite: required fields flagged inline")
            await pg.locator("#name").fill("E2E Tester"); await pg.locator("#username").fill(uname)
            await pg.locator("#designation").fill("QA Officer"); await pg.locator("#email").fill(f"{uname}@example.com")
            await pg.locator("#mobile").fill("12345")
            await pg.get_by_role("radio", name=re.compile("^Operator")).click()
            await pg.get_by_role("button", name="Invite", exact=True).click()
            await expect(pg.get_by_role("alert").filter(has_text="Bangladeshi mobile")).to_be_visible(); ok("invite: mobile format validated")
            await pg.locator("#mobile").fill("01711-555666")
            await settle(pg); await pg.screenshot(path=f"{OUT}/47_user_invite.png")
            await pg.get_by_role("button", name="Invite", exact=True).click()
            pw_el = pg.get_by_test_id("temp-password")
            await expect(pw_el).to_be_visible(); temp = (await pw_el.inner_text()).strip()
            assert re.fullmatch(r"Kac-[a-z]{4}-\d{4}", temp), temp; ok("invite → temporary password shown once")
            await settle(pg); await pg.screenshot(path=f"{OUT}/48_temp_password.png")
            await pg.get_by_role("button", name="Done").click()
            row = pg.locator("tbody tr").filter(has_text="E2E Tester")
            await expect(row.get_by_text("Password change pending")).to_be_visible(); ok("new user flagged 'password change pending'")
            # duplicate username via API
            r = await admin.request.post(BASE + "/api/v1/users", data={"username": uname, "name": "Dup", "designation": "Tester", "email": "d@x.co", "mobile": "", "department": "", "role": "viewer", "active": True})
            assert r.status == 422 and (await r.json())["errors"]["username"] == ["duplicate"]; ok("duplicate username → 422")
        except Exception as e: fail(1, e)

        # ── 2. First sign-in with temp password → forced change ───────
        try:
            ctx = await b.new_context(viewport=VP); upg = await ctx.new_page(); watch(upg, errs)
            await upg.goto(BASE + "/en/login"); await upg.locator("#username").fill(uname); await upg.locator("#password").fill(temp)
            await upg.get_by_role("button", name="Sign in", exact=True).click(); await upg.wait_for_url(BASE + "/en")
            dlg = upg.get_by_role("dialog", name="Choose a new password")
            await expect(dlg).to_be_visible(); await upg.keyboard.press("Escape"); await upg.wait_for_timeout(300)
            await expect(dlg).to_be_visible(); ok("temp password → forced change dialog that Escape cannot dismiss")
            await upg.locator("#pw-current").fill(temp); await upg.locator("#pw-next").fill("abcdefgh"); await upg.locator("#pw-confirm").fill("abcdefgh")
            await dlg.get_by_role("button", name="Change password").click()
            await expect(dlg.get_by_text("Include at least one letter and one digit")).to_be_visible(); ok("password policy enforced client-side")
            await settle(upg); await upg.screenshot(path=f"{OUT}/49_forced_password.png")
            await upg.locator("#pw-next").fill("Packaging2026"); await upg.locator("#pw-confirm").fill("Packaging2026")
            await dlg.get_by_role("button", name="Change password").click()
            await expect(dlg).to_be_hidden(); await expect(upg.get_by_text("Password changed.")).to_be_visible(); ok("password changed; dialog released")
            r = await ctx.request.get(BASE + "/api/v1/me"); assert r.ok and not (await r.json())["user"].get("mustChangePassword"); ok("session survives the change (fresh cookie)")
            r = await ctx.request.get(BASE + "/api/v1/users"); assert r.status == 403; ok("operator → /users API 403")
            await upg.goto(BASE + "/en/master/users", wait_until="networkidle")
            await expect(upg.get_by_text("You don't have access to this page")).to_be_visible(); ok("operator → users page shows no-access state")
            assert await upg.get_by_role("link", name="Users & roles").count() == 0; ok("operator: Users nav item hidden")
            await ctx.close()
        except Exception as e: fail(2, e)

        # ── 3. Guards, reset password, deactivate ─────────────────────
        try:
            await pg.goto(BASE + "/en/master/users?edit=u5", wait_until="networkidle")
            await expect(pg.get_by_role("radio", name=re.compile("^Approver"))).to_be_disabled()
            await expect(pg.get_by_text("This is your account")).to_be_visible(); ok("own account: role/status locked in the sheet")
            await pg.keyboard.press("Escape")
            r = await admin.request.put(BASE + "/api/v1/users/u5", data={"name": "System Administrator", "designation": "IT", "email": "it@kanchanjhara-apparel.example", "mobile": "", "department": "", "role": "viewer", "active": True})
            assert r.status == 422 and (await r.json())["errors"]["role"] == ["self"]; ok("API: own role change → 422 self")
            farzana = await login_ctx(b, "farzana")
            await pg.goto(BASE + "/en/master/users", wait_until="networkidle")
            await pg.locator("tbody tr").filter(has_text="Farzana Akter").get_by_role("button", name=re.compile("^Actions for")).click()
            await pg.get_by_role("menuitem", name="Reset password").click()
            await pg.get_by_role("alertdialog").get_by_role("button", name="Reset password").click()
            await expect(pg.get_by_test_id("temp-password")).to_be_visible(); ok("reset password via row menu → new one-time password")
            await pg.get_by_role("button", name="Done").click()
            assert (await farzana.request.get(BASE + "/api/v1/me")).status == 401; ok("reset revokes the user's existing sessions")
            await farzana.close()
            target = await login_ctx(b, "auditor")
            await pg.locator("tbody tr").filter(has_text="Sabbir Rahman").get_by_role("button", name=re.compile("^Actions for")).click()
            await pg.get_by_role("menuitem", name="Deactivate").click()
            await pg.get_by_role("alertdialog").get_by_role("button", name="Deactivate").click()
            await expect(pg.locator("tbody tr").filter(has_text="Sabbir Rahman").get_by_text("Inactive")).to_be_visible(); ok("deactivate via row menu (with confirmation)")
            assert (await target.request.get(BASE + "/api/v1/me")).status == 401; ok("deactivation ends the user's session immediately")
            await target.close()
            ovf = await pg.evaluate("[...document.querySelectorAll('main .overflow-auto')].map(e => e.scrollWidth - e.clientWidth)"); assert ovf, 'table scroller not found'
            assert max(ovf or [0]) <= 1, ovf; ok("users table fits 1440 px without horizontal scroll (with pending-password pills)")
            await settle(pg); await pg.screenshot(path=f"{OUT}/50_users_after.png")
            lg = await b.new_context(viewport=VP); lp = await lg.new_page()
            await lp.goto(BASE + "/en/login"); await lp.locator("#username").fill("auditor"); await lp.locator("#password").fill("demo1234")
            await lp.get_by_role("button", name="Sign in", exact=True).click()
            await expect(lp.get_by_role("alert").filter(has_text="deactivated")).to_be_visible(); ok("deactivated user sees a clear sign-in message")
            await lg.close()
            await pg.goto(BASE + "/en/master/users?tab=roles", wait_until="networkidle")
            await expect(pg.get_by_role("cell", name="Allowed").first).to_be_visible()
            await expect(pg.get_by_text("settings.manage")).to_be_visible(); ok("roles & permissions matrix")
            await settle(pg); await pg.screenshot(path=f"{OUT}/51_roles_matrix.png")
        except Exception as e: fail(3, e)

        # ── 4. Company profile ────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/master/company", wait_until="networkidle")
            await expect(pg.locator("#name")).to_have_value("KANCHANJHARA APPAREL COMPOSITE LTD")
            await pg.locator("#tin").fill("12345"); await pg.locator("#tin").blur()
            await expect(pg.get_by_text("Enter the 12-digit TIN.")).to_be_visible(); ok("company: TIN validated inline")
            await pg.locator("#tin").fill("512378904461")
            await pg.locator("#name").fill("KANCHANJHARA APPAREL COMPOSITE LIMITED")
            await expect(pg.get_by_text("You have unsaved changes.")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/52_company.png")
            await pg.get_by_role("button", name="Save", exact=True).click()
            await expect(pg.get_by_text("Company profile saved.")).to_be_visible()
            await expect(pg.locator("footer, [role=contentinfo]").get_by_text("KANCHANJHARA APPAREL COMPOSITE LIMITED").first).to_be_visible(); ok("saved name updates the shell footer without reload")
            await pg.goto(BASE + "/en/sales/s1?tab=mushak", wait_until="networkidle")
            await expect(pg.get_by_label("Mushak 6.3 tax invoice").get_by_text("KANCHANJHARA APPAREL COMPOSITE LIMITED").first).to_be_visible(); ok("Mushak 6.3 prints the saved company name")
            r = await admin.request.get(BASE + "/api/v1/company"); c = await r.json()
            c["name"] = "KANCHANJHARA APPAREL COMPOSITE LTD"; [c.pop(k, None) for k in ("updatedAt", "updatedBy")]
            assert (await admin.request.put(BASE + "/api/v1/company", data=c)).ok  # restore for later runs
            appr = await login_ctx(b, "arif", viewport=VP); ap = await appr.new_page(); watch(ap, errs)
            await ap.goto(BASE + "/en/master/company", wait_until="networkidle")
            await expect(ap.get_by_text("Only an administrator can change")).to_be_visible()
            await expect(ap.locator("#name")).to_be_disabled(); ok("approver: company profile read-only")
            assert (await appr.request.put(BASE + "/api/v1/company", data=c)).status == 403; ok("approver: company PUT → 403")
            await settle(ap); await ap.screenshot(path=f"{OUT}/53_company_readonly.png")
        except Exception as e: fail(4, e)

        # ── 5. Tariff + HS lookup in the item sheet ───────────────────
        try:
            await ap.goto(BASE + "/en/vat/tariff", wait_until="networkidle")
            want = (await (await appr.request.get(BASE + "/api/v1/tariff?q=7607&size=50")).json())["total"]
            assert want >= 3, want
            await ap.get_by_placeholder("Search HS code or description…").fill("7607")
            await expect(ap.locator("tbody tr")).to_have_count(want); ok(f"tariff search by HS heading (7607 → {want} lines, matches API)")
            await settle(ap); await ap.screenshot(path=f"{OUT}/54_tariff.png")
            await ap.goto(BASE + "/en/inventory/items?edit=i11", wait_until="networkidle")
            await expect(ap.get_by_text("Printing ink, other than black")).to_be_visible()
            await expect(ap.get_by_text("Item rates match the tariff")).to_be_visible(); ok("item sheet: HS code resolved against the tariff")
            await ap.locator("#hsCode").fill("99999999")
            await expect(ap.get_by_text("isn't in the NBR tariff")).to_be_visible(); ok("item sheet: unknown HS code warned")
            await ap.locator("#hsCode").fill("32089090")
            await ap.get_by_role("button", name="Use tariff rates").click()
            await expect(ap.locator("#sdRate")).to_have_value("20"); ok("'Use tariff rates' copies VAT/SD into the item")
            await settle(ap); await ap.screenshot(path=f"{OUT}/55_item_hs_lookup.png")
            await ap.keyboard.press("Escape")
        except Exception as e: fail(5, e)

        # ── 6. Audit trail ────────────────────────────────────────────
        try:
            await ap.goto(BASE + "/en/master/audit?entity=company", wait_until="networkidle")
            await expect(ap.locator("tbody tr").first).to_contain_text("System Administrator")
            await ap.locator("tbody tr").first.click()
            sheet = ap.get_by_role("dialog")
            await expect(sheet.get_by_role("rowheader", name="Name")).to_be_visible()
            await expect(sheet.get_by_text("KANCHANJHARA APPAREL COMPOSITE LIMITED").first).to_be_visible(); ok("audit: company edit recorded with before/after")
            await settle(ap); await ap.screenshot(path=f"{OUT}/57_audit_detail.png")
            await ap.keyboard.press("Escape")
            await ap.goto(BASE + "/en/master/audit?entity=user", wait_until="networkidle")
            for a in ("Invited", "Password reset", "Deactivated"):
                await expect(ap.locator("tbody").get_by_text(a, exact=True).first).to_be_visible()
            ok("audit: invite, reset and deactivation logged")
            await ap.goto(BASE + "/en/master/audit?action=signInFailed", wait_until="networkidle")
            await expect(ap.locator("tbody tr").first).to_be_visible(); ok("audit: failed sign-ins logged")
            await ap.goto(BASE + "/en/master/audit", wait_until="networkidle")
            await settle(ap); await ap.screenshot(path=f"{OUT}/56_audit.png")
            r = await appr.request.get(BASE + "/api/v1/audit?format=csv&entity=user")
            body = await r.text()
            assert r.ok and r.headers["content-type"].startswith("text/csv") and "Time (UTC)" in body[:40] and "invited" in body; ok("audit CSV export")
        except Exception as e: fail(6, e)

        # ── 7. Notifications ──────────────────────────────────────────
        try:
            op = await login_ctx(b, "kamal", viewport=VP)
            # the seed has no draft purchases — the operator raises one (mock DB only), the approver approves it
            me = (await (await op.request.get(BASE + "/api/v1/me")).json())["user"]
            r = await op.request.post(BASE + "/api/v1/purchases", data={
                "vendorId": "v8", "issueDate": "2026-09-25", "challanNo": f"E2E-{uname}", "challanDate": "2026-09-25",
                "method": "Bank", "discount": 0, "paid": 0, "issuedBy": me["name"], "designation": me["designation"],
                "narration": "", "process": "Created",
                "lines": [{"itemId": "i16", "qty": 10, "price": 37.29, "sdRate": 0, "vatRate": 0, "rebateable": False, "vds": False}]})
            assert r.status in (200, 201), (r.status, await r.text())
            draft = await r.json(); draft = draft.get("data", draft)
            r = await appr.request.patch(BASE + f"/api/v1/purchases/{draft['id']}", data={"process": "Approved"}); assert r.ok, r.status
            doc_no = (await (await appr.request.get(BASE + f"/api/v1/purchases/{draft['id']}")).json())["invoiceNo"]
            opg = await op.new_page(); watch(opg, errs)
            await opg.goto(BASE + "/en", wait_until="networkidle")
            bell = opg.get_by_role("button", name=re.compile(r"Notifications|notification"))
            await bell.first.click()
            item = opg.get_by_text(f"Arif Hossain approved {doc_no}")
            await expect(item).to_be_visible(); ok("issuer notified when someone else approves their document")
            await settle(opg); await opg.screenshot(path=f"{OUT}/58_notifications.png")
            before = (await (await op.request.get(BASE + "/api/v1/notifications")).json())["unread"]
            await opg.get_by_role("button", name="Mark all read").click(); await opg.wait_for_timeout(500)
            after = (await (await op.request.get(BASE + "/api/v1/notifications")).json())["unread"]
            assert before > 0 and after == 0, (before, after); ok("mark all read clears the unread count")
            await op.close()
        except Exception as e: fail(7, e)

        # ── 8. Bangla ─────────────────────────────────────────────────
        try:
            bn = await login_ctx(b, "admin", viewport=VP); bp = await bn.new_page(); watch(bp, errs)
            for u in ("/bn/master/users", "/bn/master/company", "/bn/vat/tariff", "/bn/master/audit"):
                await bp.goto(BASE + u, wait_until="networkidle"); await bp.wait_for_timeout(400)
            await settle(bp); await bp.screenshot(path=f"{OUT}/59_audit_bn.png"); ok("Sprint 3 pages render in Bangla")
            await bn.close(); await appr.close(); await admin.close()
        except Exception as e: fail(8, e)

        bad = [e for e in errs if "MISSING_MESSAGE" in e or "FORMATTING_ERROR" in e or e.startswith("pageerror")]
        print("console/page errors:", len(errs), errs[:8])
        assert not bad, bad; ok("no page errors or missing/invalid i18n messages")
        await b.close()
    print(f"\n{sum(1 for r in results if r[0]=='PASS')} checks passed, {len(failures)} section(s) failed")
    if failures: raise SystemExit("\n".join(failures))

asyncio.run(main())
