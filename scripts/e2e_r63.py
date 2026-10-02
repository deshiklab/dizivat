"""R6.3 end-to-end checks — RMG demo company + four compliance features.

Demo company: KANCHANJHARA APPAREL COMPOSITE LTD (knit + woven), RMG items and parties.
SD on exported inputs (9.1 note 40): six-month register, pro-rata claim linked to a purchase line and a direct
export, over-claim / non-export / window rules, note 40 in the return.
UD amendments + back-to-back LC values: BB-LC usage per UD, amendment history, reason required once used.
Interest & penalty (§127 / §85): exposure, quote, 24-month cap, the compliance-centre calculator.
Restore drill: GET /backups carries the last drill; the backups page shows it.
Creates (then cancels / deletes) one SD claim and amends one UD — run after the other suites.
Works against the in-memory mock and the PostgreSQL build alike.
"""
import asyncio, os, re, time
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

async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def send(ctx, method, path, data=None):
    r = await ctx.request.fetch(API + path, method=method, data=data)
    ct = r.headers.get("content-type", "")
    return r.status, (await r.json() if ct.startswith(("application/json", "application/problem")) else None)
async def shot(pg, name):
    await pg.screenshot(path=os.path.join(OUT, f"r63-{name}.png"), full_page=False)
async def note(ctx, period, n):
    v = await jget(ctx, f"/vat/returns/{period}")
    row = next((x for x in v["computation"]["notes"] if x["note"] == n), None)
    return round((row or {}).get("amount") or 0, 2)
def claim(**kw):
    base = {"kind": "sdExport", "issueDate": TODAY, "taxPeriod": "2026-09", "amount": 1, "description": f"E2E SD on exported inputs {RUN}", "reference": "", "process": "Created"}
    return base | kw
def ud_body(u, **kw):
    keep = ("kind", "no", "date", "customerId", "masterLcNo", "buyer", "expiry", "note", "status")
    b = {k: u.get(k) or "" for k in keep}
    b["masterLcValue"] = u.get("masterLcValue"); b["currency"] = u.get("currency") or "USD"
    b["lines"] = [{"itemId": l["itemId"], "qty": l["qty"], **({"value": l["value"]} if l.get("value") is not None else {})} for l in u["lines"]]
    b["amendReason"] = ""; b["amendDate"] = TODAY
    return b | kw

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        arif = await login_ctx(br, "arif", viewport=VP)
        admin = await login_ctx(br, "admin", viewport=VP)
        kamal = await login_ctx(br, "kamal", viewport=VP)

        # ── 1. RMG demo company ───────────────────────────────────────────
        try:
            c = await jget(arif, "/company")
            assert "KANCHANJHARA" in c["name"].upper() and c["bin"] == "004937518-0102", (c["name"], c["bin"])
            assert "Gazipur" in c.get("address", ""), c.get("address")
            items = await jget(arif, "/items?size=100")
            names = " ".join(i["name"] for i in items["data"])
            for w in ("Denim", "Polo", "Polybag", "Carton", "Single Jersey"):
                assert w in names, w
            ok(f"demo company is the RMG composite {c['name']} (BIN {c['bin']}); garment items and inputs in the item master")
        except Exception as e: fail(1, e)

        # ── 2. SD on exported inputs — register (API) ─────────────────────
        try:
            reg = await jget(arif, "/vat/sd-eligible")
            by = {(r["purchaseId"], r["itemId"]): r for r in reg["rows"]}
            lapsed, polybag, carton = by[("p95", "i16")], by[("p96", "i16")], by[("p96", "i14")]
            assert lapsed["state"] == "lapsed" and lapsed["daysLeft"] < 0 and lapsed["remaining"] > 0, lapsed
            assert polybag["claimedQty"] == 31000 and polybag["state"] in ("open", "expiring"), polybag
            assert carton["claimedQty"] == 1540, carton  # the draft va6 reserves its quantity
            assert abs(polybag["remaining"] - round(polybag["sd"] - polybag["claimed"], 2)) < 0.02
            assert polybag["deadline"] == "2026-10-06" and polybag["state"] == "expiring", (polybag["deadline"], polybag["state"])
            t = reg["totals"]
            assert t["lapsedUnclaimed"] >= lapsed["remaining"] - 0.01 and t["claimable"] > 0 and t["expiring"] > 0, t
            assert any(x["saleId"] == "s170" for x in reg["exports"]), [x["saleId"] for x in reg["exports"]][:5]
            ok(f"SD register: {len(reg['rows'])} SD-paid lines — p95 polybag lapsed (৳{lapsed['remaining']:,.2f} lost), p96 window ends 6 Oct, drafts reserve quantity")
            ex = await jget(arif, "/vat/sd-eligible?exclude=va6")
            assert next(r for r in ex["rows"] if r["purchaseId"] == "p96" and r["itemId"] == "i14")["claimedQty"] == 0
            ok("?exclude=<draft> releases that draft's quantity (used while editing it)")
        except Exception as e: fail(2, e)

        # ── 3. SD claim — create, rules, note 40 (API) ────────────────────
        try:
            n40 = await note(arif, "2026-09", 40)
            st, d = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p96", itemId="i16", saleId="s182", qty=1000, amount=99999))
            assert st == 201, (st, d)
            assert d["note"] == 40 and d["amount"] == round(93772.8 * 1000 / 150000, 2), (d["note"], d["amount"])
            assert d["sdExport"]["saleId"] == "s182" and d["sdExport"]["qty"] == 1000 and d["sdExport"]["purchaseNo"], d["sdExport"]
            ok(f"claim {d['no']}: 1,000 polybags of 150,000 → ৳{d['amount']:,.2f} pro rata (the amount sent is ignored), linked to the export")
            st, e = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p96", itemId="i16", saleId="s182", qty=200000))
            assert st == 422 and e["errors"]["qty"] == ["sdExceeds"], (st, e)
            st, e = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p96", itemId="i16", saleId="s1", qty=1))
            assert st == 422 and e["errors"]["saleId"] == ["sdDirectExportOnly"], (st, e)
            st, e = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p96", itemId="i16", saleId="s137", qty=1))
            assert st == 422 and e["errors"]["saleId"] == ["sdWindow"], (st, e)
            st, e = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p95", itemId="i16", saleId="s182", qty=1))
            assert st == 422 and e["errors"]["issueDate"] == ["sdClaimLapsed"], (st, e)
            st, e = await send(arif, "POST", "/vat/adjustments", claim(purchaseId="p96", itemId="i17", saleId="s182", qty=1))
            assert st == 422 and "itemId" in e["errors"], (st, e)
            ok("422: over-claim (sdExceeds), local sale (sdDirectExportOnly), export before the purchase (sdWindow), lapsed line (sdClaimLapsed), line without SD")
            st, a = await send(arif, "PATCH", f"/vat/adjustments/{d['id']}", {"process": "Approved"})
            assert st == 200 and a["process"] == "Approved", (st, a)
            n40b = await note(arif, "2026-09", 40)
            assert abs(n40b - (n40 + d["amount"])) < 0.02, (n40, n40b, d["amount"])
            sub = await jget(arif, "/vat/returns/2026-09/notes/40")
            assert any(d["no"] in str(r) for r in sub["rows"]), "claim not in the note-40 sub-form"
            ok(f"approved: 9.1 note 40 for Sep 2026 ৳{n40:,.2f} → ৳{n40b:,.2f}; the claim is in the note's sub-form")
            st, _ = await send(arif, "PATCH", f"/vat/adjustments/{d['id']}", {"process": "Cancelled", "reason": "E2E cleanup of the SD claim"})
            assert st == 200, st
            assert abs(await note(arif, "2026-09", 40) - n40) < 0.02
            ok("cancelling the claim frees the quantity and removes it from note 40")
        except Exception as e: fail(3, e)

        # ── 4. UD amendments + BB-LC values (API) ─────────────────────────
        try:
            reg = await jget(arif, "/vat/uds")
            u2 = next(r for r in reg["rows"] if r["no"] == "BKMEA/UD/2026/08812")
            bb = u2["bblc"]
            assert bb["state"] == "ok" and 70 < bb["pct"] < 80 and bb["currency"] == "USD", bb
            assert any(l["lcNo"] == "BB-LC-0934-26-0117" for l in bb["lcs"]), bb["lcs"]
            assert abs(bb["remaining"] - round(bb["permitted"] - bb["used"], 2)) < 0.02
            assert len(u2.get("amendments") or []) == 1 and u2["masterLcValue"] == 268500, (u2.get("amendments"), u2.get("masterLcValue"))
            ok(f"UD 08812: BB-LC USD {bb['used']:,.2f} of {bb['permitted']:,.2f} ({bb['pct']} %, within value); export LC $268,500; 1 amendment on file")
            line = next(l for l in u2["lines"] if l["itemId"] == "i21")
            more = [{**l, "qty": l["qty"] + 5000} if l["itemId"] == "i21" else l for l in u2["lines"]]
            st, e = await send(arif, "PUT", f"/vat/uds/{u2['id']}", ud_body(u2 | {"lines": more}))
            assert st == 422 and "amendReason" in e["errors"], (st, e)
            low = [{**l, "qty": max(0, l["used"] - 1)} if l["itemId"] == "i21" else l for l in u2["lines"]]
            st, e = await send(arif, "PUT", f"/vat/uds/{u2['id']}", ud_body(u2 | {"lines": low}, amendReason=f"E2E amendment {RUN} below use"))
            assert st == 422, (st, e)
            ok("used UD: changing a quantity without a reason → 422 amendReason; below the quantity supplied → 422")
            st, u = await send(arif, "PUT", f"/vat/uds/{u2['id']}", ud_body(u2 | {"lines": more}, amendReason=f"BKMEA amendment E2E-{RUN}: +5,000 kg single jersey"))
            assert st == 200, (st, u)
            g = await jget(arif, f"/vat/uds/{u2['id']}")
            am = g["amendments"][-1]
            assert len(g["amendments"]) == 2 and am["no"] == 2 and f"E2E-{RUN}" in am["reason"], g["amendments"]
            ch = next(x for x in am["lines"] if x["itemId"] == "i21")
            assert ch["qtyFrom"] == line["qty"] and ch["qtyTo"] == line["qty"] + 5000, ch
            ok(f"amendment 2 recorded with reason, date and i21 {ch['qtyFrom']:,.0f} → {ch['qtyTo']:,.0f}")
        except Exception as e: fail(4, e)

        # ── 5. Interest & penalty (API) ───────────────────────────────────
        try:
            ex = await jget(arif, "/vat/penalty")
            assert ex["asOf"] == TODAY and isinstance(ex["rows"], list) and len(ex["rows"]) >= 12, (ex["asOf"], len(ex["rows"]))
            assert ex["periodsAtRisk"] == sum(1 for r in ex["rows"] if r["result"]["total"] > 0)
            ok(f"exposure over {len(ex['rows'])} periods: {ex['periodsAtRisk']} at risk, ৳{ex['total']:,.2f}")
            q = await jget(arif, "/vat/penalty?period=2026-08&vat=100000&sd=20000&paidOn=2026-11-20&filedOn=2026-11-20")
            r = q["result"]
            assert r["dueDate"] == "2026-09-15" and r["chargedMonths"] == 3 and r["ratePct"] == 1, r
            assert r["interestVat"] == 3000 and r["interestSd"] == 600 and r["penaltyLate"] == 10000 and r["total"] == 13600, r
            ok("Aug 2026 due 15 Sep; paid + filed 20 Nov → 3 months × 1 % → interest ৳3,000 (VAT) + ৳600 (SD) + penalty ৳10,000")
            q = await jget(arif, "/vat/penalty?period=2026-08&vat=100000&sd=0&paidOn=2026-09-15&filedOn=2026-09-15")
            assert q["result"]["total"] == 0 and not q["result"]["lateFiling"], q["result"]
            q = await jget(arif, "/vat/penalty?period=2025-07&vat=50000&sd=0&paidOn=2028-12-31&filedOn=2025-08-10&latePenalty=0")
            r = q["result"]
            assert r["capped"] and r["chargedMonths"] == 24 and r["interestVat"] == 12000 and r["penaltyLate"] == 0, r
            ok("on time → ৳0; interest caps at 24 months (৳50,000 → ৳12,000); late penalty can be overridden")
        except Exception as e: fail(5, e)

        # ── 6. Restore drill (API) ────────────────────────────────────────
        try:
            st, b = await send(admin, "GET", "/backups")
            assert st == 200 and "drill" in b, (st, list(b or {}))
            d = b["drill"]
            if d:
                assert {"ok", "at", "backupId", "tables", "rows", "auditChain", "boot"} <= set(d), d
                ok(f"GET /backups carries the last restore drill: {'passed' if d['ok'] else 'failed'}, {d['tables']} tables / {d['rows']} rows, audit chain {d['auditChain']}")
            else:
                ok("GET /backups carries drill = null (no drill recorded on this database yet)")
            st, _ = await send(kamal, "GET", "/backups")
            assert st == 403, st; ok("backups and the drill are admin-only (403 for operators)")
        except Exception as e: fail(6, e)

        errs = []
        # ── 7. UI: SD register + claim form ───────────────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/adjustments", wait_until="networkidle")
            win = pg.get_by_test_id("sd-window")
            await expect(win).to_be_visible()
            await expect(win.get_by_text("Lapsed").first).to_be_visible()
            await expect(win.get_by_text("Ends soon").first).to_be_visible()
            await shot(pg, "sd-window")
            ok("adjustments page opens with the six-month SD register (lapsed + ends-soon lines)")
            await win.get_by_role("button", name=re.compile(r"^Claim SD on Polybag.*P-04260007")).click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_text("SD on exported inputs").first).to_be_visible()
            await dlg.locator("#saleId").click(); await pg.get_by_role("option").first.click()
            await dlg.locator("#qty").fill("500")
            await expect(dlg.get_by_test_id("sd-amount")).to_contain_text("312.58")
            desc = await dlg.locator("#description").input_value()
            assert "export" in desc and len(desc) >= 10, desc
            await shot(pg, "sd-claim-form")
            ok("Claim pre-fills the purchase line; picking the export + 500 pcs computes ৳312.58 and the reason")
            await dlg.get_by_role("button", name="Save draft").click()
            await expect(pg.get_by_text(re.compile(r"VA-\d{8} saved as draft"))).to_be_visible()
            lst = await jget(arif, "/vat/adjustments?kind=sdExport&process=Created&size=50")
            mine = [a for a in lst["data"] if a["id"] != "va6" and a.get("sdExport", {}).get("qty") == 500]
            assert mine, [a["no"] for a in lst["data"]]
            st, _ = await send(arif, "DELETE", f"/vat/adjustments/{mine[0]['id']}")
            assert st == 200, st
            ok(f"draft claim {mine[0]['no']} saved from the UI (then deleted)")
            await pg.goto(BASE + f"/en/vat/adjustments?view=va5", wait_until="networkidle")
            await expect(pg.get_by_role("dialog").get_by_text("Input and export")).to_be_visible()
            ok("the claim's detail sheet shows the linked purchase and export")
            await pg.close()
        except Exception as e:
            fail(7, e)
            await pg.screenshot(path="/tmp/fail_r63_7.png")

        # ── 8. UI: UD register — BB-LC + amendments ───────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/ud-register", wait_until="networkidle")
            await expect(pg.get_by_test_id("ud-bblc").first).to_be_visible()
            ok("UD register rows show the BB-LC value used")
            u2id = next(r["id"] for r in (await jget(arif, "/vat/uds"))["rows"] if r["no"] == "BKMEA/UD/2026/08812")
            await pg.goto(BASE + f"/en/vat/ud-register?view={u2id}", wait_until="networkidle")
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_test_id("ud-bblc-section")).to_be_visible()
            await expect(dlg.get_by_test_id("ud-bblc-section")).to_contain_text("BB-LC-0934-26-0117")
            await expect(dlg.get_by_test_id("ud-amendments")).to_be_visible()
            await expect(dlg.get_by_text(f"E2E-{RUN}").first).to_be_visible()
            await shot(pg, "ud-bblc")
            ok("UD sheet: back-to-back LCs against the UD and the amendment history")
            await dlg.get_by_role("button", name="Edit").click()
            form = pg.get_by_role("dialog").filter(has_text="Amend BKMEA/UD/2026/08812")
            await expect(form.get_by_label(re.compile("Reason / amendment certificate"))).to_be_visible()
            await shot(pg, "ud-amend-form")
            await form.get_by_role("button", name=re.compile("Cancel|Close")).first.click()
            ok("editing a used UD asks for the amendment reason")
            await pg.close()
        except Exception as e:
            fail(8, e)
            await pg.screenshot(path="/tmp/fail_r63_8.png")

        # ── 9. UI: compliance centre — interest & penalty calculator ──────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/mushak", wait_until="networkidle")
            card = pg.get_by_test_id("penalty-card")
            await expect(card).to_be_visible()
            await card.scroll_into_view_if_needed()
            await card.get_by_label("Unpaid VAT (৳)").fill("100000")
            await card.get_by_label("Unpaid SD (৳)").fill("0")
            await card.get_by_label("Paid on").fill("2027-01-20")
            await card.get_by_label("Return filed on").fill("2027-01-20")
            await expect(card.get_by_test_id("penalty-total")).to_contain_text(re.compile(r"1[0-9],[0-9]{3}"))
            txt = await card.get_by_test_id("penalty-total").inner_text()
            await expect(card.get_by_text(re.compile(r"days late"))).to_be_visible()
            await shot(pg, "penalty-card")
            ok(f"calculator: ৳100,000 VAT paid late → total {txt.strip()} (interest + late-return penalty)")
            await expect(card.get_by_role("link", name=re.compile("Deposit the interest"))).to_be_visible()
            href = await card.get_by_role("link", name=re.compile("Deposit the interest")).get_attribute("href")
            assert "head=interest" in href and "amount=" in href, href
            ok("deposit link pre-fills a TR-6 challan for the interest")
            await pg.close()
        except Exception as e:
            fail(9, e)
            await pg.screenshot(path="/tmp/fail_r63_9.png")

        # ── 10. UI: backups — restore drill ──────────────────────────────
        try:
            pg = await admin.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/master/backups", wait_until="networkidle")
            drill = pg.get_by_test_id("restore-drill")
            await expect(drill).to_be_visible()
            await expect(drill).to_contain_text(re.compile("Last restore drill"))
            await expect(drill).to_contain_text(re.compile("Passed|Failed|Not run yet"))
            await shot(pg, "restore-drill")
            ok("backups page shows the last restore drill")
            await pg.close()
        except Exception as e: fail(10, e)

        # ── 11. Bangla ───────────────────────────────────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/bn/vat/adjustments", wait_until="networkidle")
            await expect(pg.get_by_test_id("sd-window")).to_be_visible()
            assert re.search(r"[\u0980-\u09FF]", await pg.get_by_test_id("sd-window").locator("h2").inner_text())
            await pg.goto(BASE + "/bn/vat/mushak", wait_until="networkidle")
            await expect(pg.get_by_test_id("penalty-card")).to_be_visible()
            assert re.search(r"[\u0980-\u09FF]", await pg.get_by_test_id("penalty-card").locator("[data-slot=card-title]").first.inner_text())
            await shot(pg, "bn-penalty")
            await pg.goto(BASE + "/bn/help/sd-on-exported-inputs", wait_until="networkidle")
            assert re.search(r"[\u0980-\u09FF]", await pg.locator("h1").first.inner_text())
            pga = await admin.new_page(); watch(pga, errs)
            await pga.goto(BASE + "/bn/master/backups", wait_until="networkidle")
            await expect(pga.get_by_test_id("restore-drill")).to_be_visible()
            assert not [e for e in errs if "MISSING_MESSAGE" in e or "pageerror" in e], errs[:3]
            ok("Bangla: SD register, penalty calculator, help article and restore drill in Bangla; no missing messages")
            await pg.close(); await pga.close()
        except Exception as e: fail(11, e)

        await br.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  ✗", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
