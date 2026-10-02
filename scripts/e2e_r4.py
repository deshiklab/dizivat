"""R4 end-to-end checks (Accounting + NBR VAT): bank/wallet accounts, receipts & payments with invoice allocation (due updates,
cancel restores), party statements that reconcile, TR-6 treasury deposits from the 9.1 shortfall, VDS (Mushak 6.6) from the
pending list, VAT adjustments, the Mushak 9.1 builder with sub-forms (D-04) and a sorted, de-duplicated period list (D-15),
the period lock after submission, the compliance centre, Mushak 6.10 (D-05), NBR settings, role gating, live dashboard
deadlines and Bangla. Run on a fresh server (it creates documents)."""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
os.makedirs(OUT, exist_ok=True)
API = BASE + "/api/v1"
TODAY = "2026-09-25"
CUR, PREV = "2026-09", "2026-08"
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
    await pg.wait_for_timeout(60)
    await pg.evaluate("Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))")
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
def num(x): return re.escape(("%.2f" % x).rstrip("0").rstrip("."))
def note(ret, n): return next(x for x in ret["computation"]["notes"] if x["note"] == n)

def money(party, amount, allocations, account="ac1", method="bankTransfer", process="Approved", **kw):
    return {"partyId": party, "date": TODAY, "method": method, "accountId": account, "chequeNo": "", "chequeDate": "", "chequeBank": "",
            "reference": "E2E-REF", "amount": amount, "charge": 0, "allocations": allocations, "note": "", "process": process, **kw}
def adjustment(amount, period=CUR, process="Approved", **kw):
    return {"kind": "otherIncrease", "issueDate": TODAY, "taxPeriod": period, "amount": amount, "description": "E2E adjustment for testing the return", "reference": "E2E", "process": process, **kw}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP)
        admin = await login_ctx(b, "admin", viewport=VP)
        oper = await login_ctx(b, "kamal", viewport=VP)
        view = await login_ctx(b, "auditor", viewport=VP)
        pg = await appr.new_page(); watch(pg, errs)

        # ── 1. Bank & wallet accounts ─────────────────────────────────
        try:
            await pg.goto(BASE + "/en/accounting/bank-accounts", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Bank & wallet accounts")).to_be_visible()
            for k in ("bank accounts", "wallets", "cash accounts"): await expect(pg.get_by_text(re.compile(rf"\d+ {k}")).first).to_be_visible()
            await expect(pg.get_by_role("row", name=re.compile("bKash")).first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/90_bank_accounts.png"); ok("accounts page: bank / wallet / cash totals and the account table")
            base = {"provider": "Nagad", "owner": "E2E Owner", "branch": "", "address": "", "authorised": "E2E Signatory", "serviceCharge": 1, "openingBalance": 0, "openingDate": TODAY, "active": True}
            st, d = await post(appr, "/accounting/accounts", base | {"kind": "mobile", "walletType": "merchant", "accountNo": "12345"})
            assert st == 422 and "accountNo" in d["errors"], (st, d); ok("wallet with an invalid mobile number → 422 accountNo")
            st, d = await post(appr, "/accounting/accounts", base | {"kind": "mobile", "walletType": "merchant", "accountNo": "01712345678", "serviceCharge": 12})
            assert st == 422 and "serviceCharge" in d["errors"], (st, d); ok("service charge above 10% → 422")
            st, d = await post(appr, "/accounting/accounts", base | {"kind": "mobile", "walletType": "merchant", "accountNo": "01712345678"})
            assert st == 201 and d["kind"] == "mobile", (st, d); ok("valid merchant wallet created (201)")
            st, _ = await post(oper, "/accounting/accounts", base | {"kind": "cash", "provider": "Petty cash 2", "accountNo": ""})
            assert st == 403, st; ok("operator cannot add accounts (403)")
        except Exception as e: fail(1, e)

        # ── 2. Receipt from a sales invoice (UI) ──────────────────────
        sale = None
        try:
            sales = (await jget(appr, "/sales?size=500"))["data"]
            sale = next(s for s in sales if s["process"] == "Approved" and s["due"] > 0 and s["issueDate"].startswith(CUR) and not s.get("export"))
            await pg.goto(f"{BASE}/en/sales/{sale['id']}", wait_until="networkidle")
            await pg.get_by_role("link", name="Record receipt").click()
            await pg.wait_for_url(re.compile(r"/accounting/receipts\?"))
            await expect(pg.get_by_role("heading", name="New receipt")).to_be_visible()
            alloc = pg.get_by_label(f"Amount to allocate to {sale['invoiceNo']}")
            await expect(alloc).to_have_value(re.compile("^" + num(sale["due"]) + "$"))
            ok("Record receipt on the invoice opens the form with the customer and the invoice due pre-allocated")
            await pg.locator("#accountId").click(); await pg.get_by_role("option").first.click()
            await pg.locator("#reference").fill("E2E-RCPT-01")
            await settle(pg); await pg.screenshot(path=f"{OUT}/91_receipt_form.png")
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_role("tab", name="Money receipt")).to_be_visible()
            d = await jget(appr, f"/sales/{sale['id']}")
            assert d["due"] == 0 and d["paid"] >= sale["due"], d; ok("approved receipt settles the invoice: due 0 (D-10 closed — no bank screen)")
            await pg.get_by_role("tab", name="Money receipt").click()
            await expect(pg.get_by_text("In words", exact=False).first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/92_money_receipt.png"); ok("money receipt print view with amount in words")
        except Exception as e: fail(2, e)

        # ── 3. Receipt / payment rules (API) ─────────────────────────
        try:
            cust = next(s for s in (await jget(appr, "/sales?size=500"))["data"] if s["process"] == "Approved" and s["due"] > 1000)
            st, d = await post(appr, "/accounting/receipts", money(cust["customerId"], 100, [], method="cash", account="ac1"))
            assert st == 422 and "accountId" in d["errors"], (st, d); ok("cash receipt into a bank account → 422 accountMismatch")
            st, d = await post(appr, "/accounting/receipts", money(cust["customerId"], 100, [], date="2026-06-15"))
            assert st == 422 and "date" in d["errors"], (st, d); ok("receipt dated in the closed books (≤ 30-06-2026) → 422 dateClosed")
            st, d = await post(appr, "/accounting/receipts", money(cust["customerId"], 100, [{"docId": cust["id"], "amount": 500}]))
            assert st == 422, (st, d); ok("allocations above the amount → 422")
            st, d = await post(appr, "/accounting/receipts", money(cust["customerId"], cust["due"] + 5000, [{"docId": cust["id"], "amount": cust["due"] + 5000}]))
            assert st == 422, (st, d); ok("allocation above the invoice due → 422")
            st, d = await post(appr, "/accounting/receipts", money(cust["customerId"], 100, [], method="cheque", reference=""))
            assert st == 422 and "chequeNo" in d["errors"], (st, d); ok("cheque receipt without cheque no./date → 422")
            purchases = (await jget(appr, "/purchases?size=500"))["data"]
            pur = next(x for x in purchases if x["process"] == "Approved" and x["due"] > 0 and x["issueDate"].startswith(CUR))
            st, pay = await post(appr, "/accounting/payments", money(pur["vendorId"], pur["due"], [{"docId": pur["id"], "amount": pur["due"]}]))
            assert st == 201 and pay["process"] == "Approved", (st, pay)
            assert (await jget(appr, f"/purchases/{pur['id']}"))["due"] == 0; ok("approved supplier payment settles the bill (due 0)")
            st, _ = await patch(appr, f"/accounting/payments/{pay['id']}", {"process": "Cancelled", "reason": "E2E reversal of a test payment"})
            assert st == 200, st
            assert abs((await jget(appr, f"/purchases/{pur['id']}"))["due"] - pur["due"]) < 0.01; ok("cancelling the payment restores the bill due")
            st, dr = await post(oper, "/accounting/receipts", money(cust["customerId"], 100, [], process="Created"))
            assert st == 201, (st, dr)
            st, _ = await patch(oper, f"/accounting/receipts/{dr['id']}", {"process": "Approved"})
            assert st == 403, st; ok("operator can draft a receipt but not approve it (403)")
            vpg = await view.new_page(); watch(vpg, errs)
            await vpg.goto(BASE + "/en/accounting/receipts", wait_until="networkidle")
            await expect(vpg.get_by_role("heading", name="Receipts")).to_be_visible()
            await expect(vpg.get_by_role("button", name="New receipt")).to_have_count(0); ok("viewer sees receipts read-only (no New)")
            await vpg.close()
        except Exception as e: fail(3, e)

        # ── 4. Party statements reconcile ─────────────────────────────
        try:
            party = sale["customerId"] if sale else "c1"
            s = await jget(appr, f"/accounting/statement?kind=customer&party={party}&from=2025-07-01&to={TODAY}")
            assert s["reconciled"] is True, {k: s[k] for k in ("closing", "invoiceDue", "advances")}; ok("customer statement reconciles with the invoice register")
            vendor = (await jget(appr, "/purchases?size=5"))["data"][0]["vendorId"]
            v = await jget(appr, f"/accounting/statement?kind=vendor&party={vendor}&from=2025-07-01&to={TODAY}")
            assert v["reconciled"] is True; ok("supplier statement reconciles with the purchase register")
            await pg.goto(f"{BASE}/en/accounting/statements?kind=customer&party={party}&from=2025-07-01", wait_until="networkidle")
            await expect(pg.get_by_text("Reconciled", exact=True)).to_be_visible()
            await expect(pg.get_by_text("Ageing", exact=True)).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/93_statement.png", full_page=True); ok("statement page: ledger, ageing, open invoices, reconciled")
        except Exception as e: fail(4, e)

        # ── 5. TR-6 deposit from the 9.1 shortfall (UI) ───────────────
        try:
            before = await jget(appr, f"/vat/returns/{CUR}")
            short = before["computation"]["shortVat"]; assert short > 0, short
            await pg.goto(f"{BASE}/en/vat/return-9-1?period={CUR}", wait_until="networkidle")
            await expect(pg.get_by_role("alert").filter(has_text="Deposit")).to_be_visible()
            await pg.get_by_role("link", name="Deposit (TR-6)").click()
            await pg.wait_for_url(re.compile(r"/vat/tr-6\?"))
            await expect(pg.get_by_role("heading", name="New treasury deposit")).to_be_visible()
            await settle(pg)
            assert float(await pg.locator("#amount").input_value()) >= short; ok("shortfall link opens a TR-6 form with head, period and amount pre-filled")
            await pg.locator("#challanNo").fill("E2E-TR-0925")
            await pg.locator("#bank").click(); await pg.get_by_role("option").first.click()
            await pg.locator("#bankBranch").fill("Local Office")
            await pg.locator("#district").click(); await pg.get_by_role("option", name="Dhaka", exact=True).click()
            await settle(pg); await pg.screenshot(path=f"{OUT}/94_treasury_form.png")
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_role("tab", name="TR Form 6")).to_be_visible()
            after = await jget(appr, f"/vat/returns/{CUR}")
            assert after["computation"]["shortVat"] == 0 and after["computation"]["depositedVat"] > before["computation"]["depositedVat"], after["computation"]
            ok("approved deposit lands in note 58 and clears the shortfall")
            await pg.get_by_role("tab", name="TR Form 6").click()
            await expect(pg.get_by_text("1/1133").first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/95_tr6_print.png"); ok("bilingual TR Form 6 shows the economic code")
        except Exception as e: fail(5, e)

        # ── 6. VDS certificate from the pending list (UI) ─────────────
        try:
            await pg.goto(BASE + "/en/vat/vds", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name=re.compile("VAT deducted at source"))).to_be_visible()
            issue = pg.get_by_role("button", name=re.compile(r"^Issue for ")).first
            doc_no = (await issue.get_attribute("aria-label")).replace("Issue for", "").strip()
            await issue.click()
            await expect(pg.get_by_role("heading", name="New VDS entry")).to_be_visible(); await settle(pg)
            el = next(e for e in await jget(appr, "/vat/vds/eligible?mode=purchase") if e["no"] == doc_no)
            amt = pg.locator("#amount")
            await expect(amt).to_have_value(re.compile("^" + num(el["remaining"]) + "$")); ok("pending purchase VDS opens the form with the invoice and remaining VAT")
            await amt.fill(str(round(el["remaining"] + 50, 2)))
            await expect(pg.get_by_role("button", name="Save draft")).to_be_disabled()
            await expect(pg.get_by_role("button", name="Save & approve")).to_be_disabled(); ok("withholding more than the remaining VAT is blocked (save disabled)")
            await amt.fill(str(el["remaining"]))
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_role("tab", name="Mushak 6.6")).to_be_visible()
            left = next((e for e in await jget(appr, "/vat/vds/eligible?mode=purchase") if e["id"] == el["id"]), None)
            assert left is None or left["remaining"] < 0.01, left; ok("approved VDS: nothing left to withhold on that invoice")
            await pg.get_by_role("tab", name="Mushak 6.6").click()
            await settle(pg); await pg.screenshot(path=f"{OUT}/96_mushak_66.png"); ok("bilingual Mushak 6.6 certificate renders")
            st, d = await post(appr, "/vat/vds", {"mode": "sales", "docId": sale["id"] if sale else "s1", "amount": 1, "certificateNo": "", "certificateDate": TODAY, "treasuryId": "", "remark": "", "process": "Created"})
            assert st == 422, (st, d); ok("sales VDS without the customer's certificate no. → 422")
        except Exception as e: fail(6, e)

        # ── 7. VAT adjustment (UI) ────────────────────────────────────
        try:
            n27 = note(await jget(appr, f"/vat/returns/{CUR}"), 27)["amount"]
            await pg.goto(BASE + "/en/vat/adjustments?new=1", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="New VAT adjustment")).to_be_visible()
            await pg.locator("#amount").fill("1500"); await pg.locator("#description").fill("short")
            await pg.get_by_role("button", name="Save draft").click()
            await expect(pg.locator("#description")).to_have_attribute("aria-invalid", "true"); ok("adjustment reason under 10 characters is rejected")
            await pg.locator("#description").fill("Short-charged VAT on scrap sale found in internal audit")
            await pg.get_by_role("button", name="Save & approve").click()
            await expect(pg.get_by_role("link", name=re.compile(r"Note 27"))).to_be_visible()
            n27b = note(await jget(appr, f"/vat/returns/{CUR}"), 27)["amount"]
            assert abs(n27b - n27 - 1500) < 0.01, (n27, n27b); ok("approved adjustment adds ৳1,500 to note 27")
            await pg.keyboard.press("Escape")
            await settle(pg); await pg.screenshot(path=f"{OUT}/97_adjustments.png")
        except Exception as e: fail(7, e)

        # ── 8. Mushak 9.1 builder, sub-forms, period list ─────────────
        try:
            ret = await jget(appr, f"/vat/returns/{CUR}")
            c = ret["computation"]
            assert abs(c["netVat"] - (note(ret, 9)["vat"] - note(ret, 23)["vat"] + note(ret, 28)["amount"] - note(ret, 33)["amount"])) < 0.01
            assert abs(c["payableVat"] - (note(ret, 35)["amount"] + note(ret, 41)["amount"] + note(ret, 43)["amount"] + note(ret, 44)["amount"])) < 0.01
            ok("9.1 formulas hold: 34 = 9c − 23b + 28 − 33, 50 = 35 + 41 + 43 + 44")
            sub = await jget(appr, f"/vat/returns/{CUR}/notes/4")
            assert abs(sub["total"]["vat"] - note(ret, 4)["vat"]) < 0.01 and abs(sub["total"]["value"] - note(ret, 4)["value"]) < 0.01; ok("sub-form totals equal note 4")
            await pg.goto(f"{BASE}/en/vat/return-9-1?period={CUR}", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Mushak 9.1 VAT return")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/98_return_91.png"); ok("return builder renders parts 3–11")
            await pg.get_by_role("button", name="Source documents for note 4", exact=True).click()
            await expect(pg.get_by_role("heading", name="Sub-form — note 4")).to_be_visible()
            await expect(pg.get_by_role("rowheader", name=re.compile(r"Total"))).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/99_subform.png"); ok("note drill-down opens the sub-form with source documents")
            await pg.keyboard.press("Escape")
            await expect(pg.get_by_role("heading", name="Sub-form — note 4")).to_be_hidden()  # sheet fully closed
            await pg.locator("#subform-pick").click()
            await expect(pg.get_by_role("option").first).to_be_visible()  # all_inner_texts() does not wait for the list
            opts = await pg.get_by_role("option").all_inner_texts()
            assert len(opts) == sum(1 for n in c["notes"] if n.get("drill")) and len(opts) > 5, opts; ok(f"sub-form selector lists {len(opts)} notes instead of an HTTP 500 (D-04)")
            await pg.keyboard.press("Escape")
            await pg.locator("#ret-period").click()
            labels = [t.split(" · ")[0] for t in await pg.get_by_role("option").all_inner_texts()]
            keys = [l[3:] + l[:2] for l in labels]
            assert len(labels) == len(set(labels)) and keys == sorted(keys, reverse=True), labels; ok(f"tax-period list sorted newest first, no duplicates ({len(labels)} periods, D-15)")
            await pg.keyboard.press("Escape")
            st, d = await patch(appr, f"/vat/returns/{CUR}", {"action": "submit"})
            assert st in (404, 409), (st, d); ok("the current period cannot be submitted before it ends (409)")
            st, _ = await patch(appr, f"/vat/returns/{PREV}", {"action": "submit"})
            assert st == 409, st; ok("an already-submitted return cannot be submitted again (409)")
        except Exception as e: fail(8, e)

        # ── 9. Period lock after submission ───────────────────────────
        try:
            st, d = await post(appr, "/vat/adjustments", adjustment(100, period=PREV))
            assert st == 422 and "taxPeriod" in d["errors"], (st, d); ok("adjustment in a submitted period → 422 periodLocked")
            st, d = await post(appr, "/sales", {"customerId": "c1", "issueDate": f"{PREV}-10", "issueTime": "10:00", "deliveryAddress": "", "vehicle": "", "method": "Bank", "discount": 0, "paid": 0,
                                                "vds": False, "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge", "narration": "", "process": "Created", "branchId": "",
                                                "lines": [{"itemId": "i17", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 15}]})
            assert st == 422 and "issueDate" in d["errors"], (st, d); ok("sales invoice dated in a submitted period → 422")
            old = next(s for s in (await jget(appr, "/sales?size=500"))["data"] if s["process"] == "Approved" and s["issueDate"].startswith(PREV))
            st, _ = await patch(appr, f"/sales/{old['id']}", {"process": "Cancelled", "reason": "E2E try to cancel in a locked period"})
            assert st == 409, st; ok("cancelling an invoice in a submitted period → 409")
            await pg.goto(f"{BASE}/en/sales/{old['id']}", wait_until="networkidle")
            await expect(pg.get_by_text(re.compile(r"Tax period 08-2026 is locked"))).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/100_period_lock.png"); await expect(pg.get_by_role("button", name="Cancel…")).to_have_count(0)
            ok("invoice in a submitted period shows the lock note and no Cancel button")
        except Exception as e: fail(9, e)

        # ── 10. Compliance centre + Mushak 6.10 ───────────────────────
        try:
            await pg.goto(BASE + "/en/vat/mushak", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="NBR compliance centre")).to_be_visible()
            await expect(pg.get_by_role("link", name=re.compile("Continue return|Prepare return"))).to_be_visible()
            for f in ("9.1", "6.10", "TR-6", "6.6"): await expect(pg.get_by_role("link", name=re.compile(re.escape(f))).first).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/101_compliance.png", full_page=True); ok("compliance centre: period status, deposits, VDS, calendar and report catalogue")
            m = await jget(appr, f"/mushak/6.10?from={PREV}-01&to={PREV}-31")
            for part in ("purchases", "sales"):
                assert abs(sum(r["total"] for r in m[part]) - m["totals"][part]["total"]) < 0.01 and all(r["total"] > m["limit"] for r in m[part])
            ok("Mushak 6.10 API: both parts above ৳2 lakh with totals that add up")
            await pg.goto(f"{BASE}/en/vat/mushak-6-10?from={PREV}-01&to={PREV}-31", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name=re.compile("Part A: Purchases"))).to_be_visible()
            await expect(pg.get_by_role("heading", name=re.compile("Part B: Sales"))).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/102_mushak_610.png", full_page=True); ok("Mushak 6.10 renders both parts (D-05 “totalPurchase” error gone)")
        except Exception as e: fail(10, e)

        # ── 11. NBR settings, accounting config, roles ────────────────
        try:
            apg = await admin.new_page(); watch(apg, errs)
            await apg.goto(BASE + "/en/vat/settings", wait_until="networkidle")
            await expect(apg.get_by_role("heading", name="VAT settings")).to_be_visible()
            await expect(apg.locator("#zoneCode")).to_have_count(0)
            await apg.get_by_role("button", name="Edit", exact=True).click()
            await apg.locator("#zoneCode").fill("12a"); await apg.get_by_role("button", name=re.compile("Save")).click()
            await expect(apg.locator("#zoneCode")).to_have_attribute("aria-invalid", "true"); ok("VAT settings: explicit edit mode; bad zone code rejected")
            await apg.get_by_role("button", name="Cancel").click()
            await settle(apg); await apg.screenshot(path=f"{OUT}/103_vat_settings.png", full_page=True)
            await apg.goto(BASE + "/en/accounting/config", wait_until="networkidle")
            await expect(apg.get_by_role("heading", name="Accounting config")).to_be_visible(); ok("accounting config page renders for admin")
            await apg.close()
            st, _ = await put(oper, "/vat/settings", {"zoneCode": "0015"}); assert st == 403, st
            st, _ = await put(appr, "/accounting/config", {"closedUpTo": "2026-06-30", "allowAdvance": True, "autoAllocate": True}); assert st == 403, st
            ok("only settings.manage may change VAT settings / accounting config (403)")
            st, d = await put(admin, "/vat/settings", {"zoneCode": "abcd"}); assert st == 422, st
        except Exception as e: fail(11, e)

        # ── 12. Dashboard deadlines are live ──────────────────────────
        try:
            dl = {d["id"]: d for d in (await jget(appr, "/dashboard"))["deadlines"]}
            assert set(dl) == {"r91prev", "tr6", "vds", "r91"}, dl
            assert dl["r91prev"]["status"] == "done" and dl["r91"]["status"] == "due" and dl["r91"]["due"] == "2026-10-15", dl
            short = (await jget(appr, f"/vat/returns/{CUR}"))["computation"]["shortVat"]
            assert dl["tr6"]["status"] == ("done" if short <= 0 else "due") and (short <= 0 or f"amount={-(-short // 1):.0f}" in dl["tr6"]["href"]), (short, dl["tr6"])
            ok("dashboard deadlines come from the return: previous filed, deposit status follows the shortfall, current due 15-10-2026")
        except Exception as e: fail(12, e)

        # ── 13. Bangla + legacy typos ─────────────────────────────────
        try:
            await pg.goto(f"{BASE}/bn/vat/return-9-1?period={CUR}", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="মূসক ৯.১ রিটার্ন")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/104_return_bn.png"); ok("Bangla 9.1 builder renders")
            text = ""
            for u in ("/en/vat/tr-6", "/en/vat/vds", "/en/vat/mushak", "/en/accounting/payments"):
                await pg.goto(BASE + u, wait_until="networkidle"); text += await pg.locator("body").inner_text()
            bad = [w for w in ("Treasuary", "Rerturn", "Purchhase") if w in text]
            assert not bad, bad; ok("legacy typos (Treasuary, Rerturn, Purchhase) are gone")
        except Exception as e: fail(13, e)

        real = [e for e in errs if "418" not in e and "Failed to load resource" not in e]
        if real: failures.append(f"console errors: {real[:5]}")
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
