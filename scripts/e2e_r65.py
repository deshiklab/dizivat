"""R6.5 end-to-end checks — RMG: own UD / UP bond settlement and duty-drawback claims.

UD settlement: statement per UD (imports against it vs its exports × BOM coefficient), states, brought forward,
excess imports, the seeded settlement (carry forward + duty paid) and its effect on the bond register, settle via the
UI, validation / permissions, create + edit, PDF, links from imports.
Drawback claims: seeded history (refunded / sanctioned / filed / rejected / draft), claim status on the drawback view,
create from the drawback tab, file, sanction (partial needs a reason), refund, reject frees the export, draft delete,
PDF, CSVs, audit trail. Run after e2e_r64. Works against the mock and the PostgreSQL build.
"""
import asyncio, os, time
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens"); os.makedirs(OUT, exist_ok=True)
DL = os.path.join(OUT, "pdf"); os.makedirs(DL, exist_ok=True)
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
    await pg.screenshot(path=os.path.join(OUT, f"r65-{name}.png"), full_page=False)
async def pdf(pg):
    btn = pg.locator("[data-testid=pdf-download]:visible").first
    await expect(btn).to_be_enabled()
    async with pg.expect_download(timeout=60_000) as d:
        await btn.click()
    dl = await d.value
    path = os.path.join(DL, dl.suggested_filename); await dl.save_as(path)
    data = open(path, "rb").read()
    assert data[:5] == b"%PDF-" and len(data) > 5000, (dl.suggested_filename, len(data))
    return dl.suggested_filename

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        arif = await login_ctx(br, "arif", viewport=VP)
        kamal = await login_ctx(br, "kamal", viewport=VP)
        auditor = await login_ctx(br, "auditor", viewport=VP)
        errs = []
        uds = {}

        # ── 1. UD register: states, statement maths, settlement, brought forward, excess ──
        try:
            reg = await jget(arif, "/vat/bond-uds")
            uds = {u["id"]: u for u in reg["rows"]}
            assert {"bu1", "bu2", "bu3", "bu4", "bu5"} <= set(uds), list(uds)
            assert uds["bu1"]["state"] == "settled" and uds["bu2"]["state"] == "ready" and all(uds[k]["state"] == "inProgress" for k in ("bu3", "bu4", "bu5")), {k: u["state"] for k, u in uds.items()}
            for u in reg["rows"]:
                for l in u["lines"]:
                    assert near(l["available"], l["imported"] + l["broughtForward"], 0.002), l
                    assert near(l["balance"] - l["fromOtherStock"], l["available"] - l["consumed"], 0.002), l
                    assert near(l["excessImport"], max(0, l["available"] - l["permitted"]), 0.002), l
            sales = await jget(arif, "/sales?size=500&category=all")
            polo = sum(l["qty"] for s in sales["data"] if s["id"] in ("s132", "s170") for l in s["lines"] if l["itemId"] == "i18")
            y = next(l for l in uds["bu1"]["lines"] if l["itemId"] == "i9")
            assert y["imported"] == 10000 and near(y["consumed"], polo * 0.2856, 0.002) and near(y["balance"], 2974.24, 0.002), y
            st = uds["bu1"]["settlement"]
            assert st["bondRef"] == "CBC/DHK/UD-SET/2026/0417" and st["date"] == "2026-09-15", st
            sl = st["lines"][0]
            assert near(sl["dutyPaidQty"], 974.24, 0.002) and sl["carryQty"] == 2000 and sl["carryTo"] == "BKMEA/UD/2026/03390" and near(sl["dutyPaid"], round(974.24 * sl["dutyPerUnit"], 2), 0.02), sl
            assert near(st["dutyPaid"], reg["totals"]["dutyPaid"], 0.01) and uds["bu1"]["dutyOnBalance"] == 0
            bf = next(l for l in uds["bu5"]["lines"] if l["itemId"] == "i9")
            assert bf["broughtForward"] == 2000 and bf["carriedIn"][0]["fromUd"] == "BKMEA/UD/2026/02114" and near(bf["dutyPerUnit"], sl["dutyPerUnit"], 0.001), bf
            pk = next(l for l in uds["bu3"]["lines"] if l["itemId"] == "i4")
            assert pk["excessImport"] == 500 and "excessImport" in uds["bu3"]["warnings"], (pk, uds["bu3"]["warnings"])
            dn = next(l for l in uds["bu2"]["lines"] if l["itemId"] == "i5")
            assert dn["state"] == "topUp" and dn["balance"] == 0 and dn["fromOtherStock"] > 0 and "expired" in uds["bu2"]["warnings"], dn
            assert near(uds["bu4"]["shippedPct"], 31.3, 0.06), uds["bu4"]["shippedPct"]
            assert reg["totals"]["ready"] == 1 and reg["totals"]["settled"] == 1 and near(reg["totals"]["dutyOnBalance"], sum(u["dutyOnBalance"] for u in reg["rows"]), 0.05)
            ok(f"UD register: 5 UDs (1 settled · 1 ready · 3 in progress); polo UD consumed {y['consumed']} kg = {polo} polos × 0.2856, 974.24 kg cleared for ৳{st['dutyPaid']:,.2f} + 2,000 kg brought forward; jeans UD 500 m pocketing over")
        except Exception as e: fail(1, e)

        # ── 2. Settlement in the bond register (cleared on duty leaves the bond) ──
        try:
            reg = await jget(arif, "/vat/bond")
            lot = next(l for l in reg["lots"] if l["boeNo"] == "C-1022835")
            # other suites may ship more polos (more FIFO consumption) — the clearance itself is fixed
            assert near(lot["cleared"], 974.24, 0.002) and near(lot["balance"], lot["qty"] - lot["consumed"] - lot["cleared"], 0.002) and lot["udNo"] == "BKMEA/UD/2026/02114" and lot["udId"] == "bu1", lot
            row = next(r for r in reg["rows"] if r["itemId"] == "i9")
            assert near(row["clearedOut"], 974.24, 0.002) and near(row["closing"], row["opening"] + row["bondedIn"] - row["bondedUsed"] - row["clearedOut"], 0.002), row
            before = await jget(arif, "/vat/bond?to=2026-09-14")
            lot0 = next(l for l in before["lots"] if l["boeNo"] == "C-1022835")
            assert lot0["cleared"] == 0 and near(lot0["balance"], 2974.24, 0.002), lot0
            ok("bond register: compact-yarn BoE shows 974.24 kg cleared on duty (balance 2,000 kg, linked to its UD); before 15 Sep the full 2,974.24 kg was still bonded")
        except Exception as e: fail(2, e)

        # ── 3. Settle API: validation, permissions ───────────────────────
        try:
            st, b = await send(arif, "POST", "/vat/bond-uds/bu3/settle", {"date": TODAY, "bondRef": "X-REF-1"})
            assert st == 422 and "state" in b["errors"], (st, b)
            st, b = await send(arif, "POST", "/vat/bond-uds/bu1/settle", {"date": TODAY, "bondRef": "X-REF-1"})
            assert st == 409, st
            st, b = await send(arif, "POST", "/vat/bond-uds/bu2/settle", {"date": "2026-12-01", "bondRef": "X-REF-1"})
            assert st == 422 and b["errors"].get("date") == ["afterToday"], (st, b)
            st, b = await send(arif, "POST", "/vat/bond-uds/bu2/settle", {"date": TODAY, "bondRef": ""})
            assert st == 422 and "bondRef" in b["errors"], (st, b)
            st, b = await send(arif, "POST", "/vat/bond-uds/bu2/settle", {"date": TODAY, "bondRef": "X-REF-1", "lines": [{"itemId": "i5", "dutyPaidQty": 5}]})
            assert st == 422 and any(k.startswith("lines.0") for k in b["errors"]), (st, b)
            st, _ = await send(kamal, "POST", "/vat/bond-uds/bu2/settle", {"date": TODAY, "bondRef": "X-REF-1"})
            assert st == 403, st
            st, _ = await send(auditor, "POST", "/vat/bond-uds/bu2/settle", {"date": TODAY, "bondRef": "X-REF-1"})
            assert st == 403, st
            ok("settle API: not ready → 422 state; settled → 409; future date, missing reference, disposal of a zero balance → 422; operator and auditor → 403")
        except Exception as e: fail(3, e)

        # ── 4. Pages: UD tab, settled UD detail, PDF ─────────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption?tab=uds", wait_until="networkidle")
            for k in ("bu1", "bu2", "bu3", "bu4", "bu5"): await expect(pg.get_by_test_id(f"bud-row-{k}")).to_be_visible()
            await expect(pg.get_by_test_id("bud-row-bu2").get_by_text("Ready to settle")).to_be_visible()
            await expect(pg.get_by_test_id("bud-row-bu3").get_by_text("500 Meter imported beyond the UD")).to_be_visible()
            await shot(pg, "uds")
            await pg.get_by_role("link", name="BKMEA/UD/2026/02114").click()
            await pg.wait_for_url("**/vat/bond-consumption/uds/bu1")
            await expect(pg.get_by_test_id("bud-settlement")).to_contain_text("CBC/DHK/UD-SET/2026/0417")
            await expect(pg.get_by_test_id("ud-statement")).to_contain_text("Carried to BKMEA/UD/2026/03390: 2,000")
            await expect(pg.get_by_test_id("bud-settle")).to_have_count(0)
            name = await pdf(pg)
            assert name == "UD-settlement_BKMEA_UD_2026_02114.pdf", name
            await shot(pg, "ud-settled")
            await pg.close()
            ok(f"pages: UD tab lists the 5 UDs with states and the excess warning; settled UD shows the Commissionerate ref and disposal; {name}")
        except Exception as e: fail(4, e)

        # ── 5. Settle the ready jeans UD through the UI ──────────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption/uds/bu2", wait_until="networkidle")
            await expect(pg.get_by_test_id("bud-warnings")).to_contain_text("expired")
            await pg.get_by_test_id("bud-settle").click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg).to_contain_text("Nothing is left over")
            await dlg.get_by_label("Bond Commissionerate reference").fill(f"CBC/DHK/UD-SET/2026/E{RUN}")
            await dlg.get_by_test_id("st-submit").click()
            await expect(dlg).to_be_hidden()
            await expect(pg.get_by_test_id("bud-settlement")).to_contain_text(f"E{RUN}")
            u = await jget(arif, "/vat/bond-uds/bu2")
            assert u["state"] == "settled" and u["settlement"]["dutyPaid"] == 0 and u["settlement"]["date"] == TODAY and u["settlement"]["by"] == "Arif Hossain", u["settlement"]
            aud = await jget(arif, "/audit?q=BGMEA%2FUD%2F2026%2F00412&size=20")
            assert any(e["entity"] == "bondUd" and e["action"] == "approved" for e in aud["data"]), [(e["entity"], e["action"]) for e in aud["data"]]
            await shot(pg, "ud-settle-ui")
            await pg.close()
            ok("settle in the UI: the expired jeans UD (nothing left over) settled with the Commissionerate reference; audit trail records it")
        except Exception as e: fail(5, e)

        # ── 6. Own UD create / edit / links from imports ─────────────────
        try:
            no = f"BGMEA/UD/2026/E{RUN}"
            body = {"kind": "UD", "issuer": "BGMEA", "no": no, "date": "2026-09-20", "expiry": "2027-03-31", "masterLcNo": f"EXP-LC-E2E-{RUN}", "masterLcValue": 50000,
                    "currency": "USD", "buyer": "E2E BUYER", "inputs": [{"itemId": "i5", "qty": 9000}], "garments": [{"itemId": "i22", "qty": 6000}]}
            st, u = await send(arif, "POST", "/vat/bond-uds", body)
            assert st == 201 and u["state"] == "inProgress" and u["no"] == no.upper(), (st, u)
            st, b = await send(arif, "POST", "/vat/bond-uds", body)
            assert st == 422 and b["errors"].get("no") == ["duplicate"], (st, b)
            st, b = await send(arif, "POST", "/vat/bond-uds", {**body, "no": no + "X", "inputs": [{"itemId": "i22", "qty": 5}]})
            assert st == 422 and "inputs.0.itemId" in b["errors"], (st, b)
            st, b = await send(arif, "POST", "/vat/bond-uds", {**body, "no": no + "Y", "expiry": "2026-01-01"})
            assert st == 422 and "expiry" in b["errors"], (st, b)
            st, u2 = await send(arif, "PUT", f"/vat/bond-uds/{u['id']}", {**body, "expiry": "2027-04-30"})
            assert st == 200 and u2["expiry"] == "2027-04-30", (st, u2)
            st, b = await send(arif, "POST", f"/vat/bond-uds/{u['id']}/settle", {"date": TODAY, "bondRef": "X-REF-2"})
            assert st == 422 and b["errors"].get("state") == ["notReady"], (st, b)
            imp = {"vendorId": "v2", "issueDate": "2026-09-23", "challanNo": f"C-78{RUN}", "challanDate": "2026-09-23", "method": "Transaction", "discount": 0, "paid": 0,
                   "issuedBy": "E2E R6.5", "designation": "Tester", "narration": "", "process": "Created", "branchId": "",
                   "lines": [{"itemId": "i5", "qty": 1500, "usd": 3750, "usdRate": 122.5, "cdRate": 10, "rdRate": 3, "sdRate": 0, "vatRate": 15, "aitRate": 5, "atRate": 2, "rebateable": True}],
                   "boe": {"lcNo": f"BB-LC-E2E5-{RUN}", "lcDate": "2026-09-01", "customsHouse": "301", "origin": "China", "cnfFirm": "", "receiveAddress": "", "bonded": True, "udNo": "NO/SUCH/UD"}}
            st, b = await send(arif, "POST", "/purchases", imp)
            assert st == 422 and b["errors"].get("boe.udNo") == ["unknownUd"], (st, b)
            st, b = await send(arif, "POST", "/purchases", {**imp, "boe": {**imp["boe"], "udNo": "BKMEA/UD/2026/02114"}})
            assert st == 422 and b["errors"].get("boe.udNo") == ["settledUd"], (st, b)
            st, pu = await send(arif, "POST", "/purchases", {**imp, "process": "Approved", "boe": {**imp["boe"], "udNo": no.lower()}})
            assert st in (200, 201) and pu["boe"]["udNo"] == no.upper(), (st, pu)
            u3 = await jget(arif, f"/vat/bond-uds/{u['id']}")
            l = next(x for x in u3["lines"] if x["itemId"] == "i5")
            assert l["imported"] == 1500 and l["boes"][0]["purchaseId"] == pu["id"] and near(l["dutyForegone"], pu["lines"][0]["duty"]["foregone"]["total"], 0.02), l
            st, b = await send(arif, "PUT", f"/vat/bond-uds/{u['id']}", {**body, "no": no + "Z"})
            assert st == 422 and b["errors"].get("no") == ["udInUse"], (st, b)
            st, _ = await send(arif, "PATCH", f"/purchases/{pu['id']}", {"process": "Cancelled", "reason": "E2E R6.5 bonded import — cleaning up"})
            assert st == 200, st
            ok("own UD: create → in progress; duplicate / garment as input / expiry before date → 422; edit; settle → notReady; imports quoting an unknown or settled UD → 422, a valid one feeds the statement; number locked once quoted")
        except Exception as e: fail(6, e)

        # ── 7. Seeded claims and the drawback view ───────────────────────
        claims = {}
        try:
            cl = await jget(arif, "/vat/drawback-claims")
            claims = {c["no"]: c for c in cl["rows"]}
            exp = {"DBK-11250001": "paid", "DBK-12250002": "paid", "DBK-03260003": "sanctioned", "DBK-04260004": "rejected", "DBK-05260005": "filed", "DBK-07260006": "filed", "DBK-09260007": "draft"}
            assert {k: claims[k]["status"] for k in exp} == exp, {k: claims.get(k, {}).get("status") for k in exp}
            c1 = claims["DBK-11250001"]
            assert c1["sanctioned"] == 61200 and near(c1["disallowed"], c1["claimed"] - 61200) and c1["paid"] == 61200 and c1["disallowedReason"], c1
            for c in cl["rows"]: assert near(c["claimed"], c["cd"] + c["rd"]) and near(c["claimed"], sum(l["total"] for l in c["lines"]), 0.02), c["no"]
            t = cl["totals"]
            assert near(t["refunded"], sum(c.get("paid") or 0 for c in cl["rows"] if c["status"] == "paid"), 0.02) and near(t["disallowed"], c1["disallowed"], 0.02), t
            assert near(t["pending"], claims["DBK-05260005"]["claimed"] + claims["DBK-07260006"]["claimed"], 0.02), t
            db = (await jget(arif, "/vat/bond"))["drawback"]
            rows = {r["saleId"]: r for r in db["rows"]}
            assert rows["s170"]["claim"]["status"] == "draft" and rows["s118"]["claim"]["no"] == "DBK-05260005", rows["s170"]
            assert "claim" not in rows["s112"] or rows["s112"].get("claim") is None, "rejected claim must not count"
            assert not rows["s137"].get("claim") and rows["s137"]["state"] == "expiring" and not rows["s182"].get("claim")
            unclaimed = lambda d: round(sum(r["total"] for r in d["rows"] if not r.get("claim") and r["state"] != "lapsed"), 2)
            assert near(db["totals"]["claimable"], unclaimed(db), 0.02) and db["totals"]["claimable"] >= rows["s137"]["total"] + rows["s182"]["total"] - 0.01, db["totals"]
            assert near(db["totals"]["claimed"], sum(r["total"] for r in db["rows"] if r.get("claim")), 0.02)
            ok(f"claims: 7 seeded (2 refunded · 1 sanctioned · 2 filed · 1 rejected · 1 draft), refunded ৳{t['refunded']:,.2f}, disallowed ৳{t['disallowed']:,.2f}; drawback view: claimable ৳{db['totals']['claimable']:,.2f} = the expiring export + the June shipment")
        except Exception as e: fail(7, e)

        # ── 8. Create-claim validation ───────────────────────────────────
        try:
            for ids, code in ((["s132"], "lapsed"), (["s118"], "alreadyClaimed"), (["s999"], "notClaimable"), (["s137", "s137"], "duplicate")):
                st, b = await send(arif, "POST", "/vat/drawback-claims", {"saleIds": ids})
                assert st == 422 and code in sum(b["errors"].values(), []), (ids, st, b)
            st, b = await send(arif, "POST", "/vat/drawback-claims", {"saleIds": []})
            assert st == 422, st
            st, _ = await send(auditor, "POST", "/vat/drawback-claims", {"saleIds": ["s137"]})
            assert st == 403, st
            ok("create claim: lapsed / already claimed / not on the drawback view / listed twice / empty → 422; auditor → 403")
        except Exception as e: fail(8, e)

        # ── 9. UI: tick exports, create the claim, file it, PDF ──────────
        new_id = None
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption?tab=drawback", wait_until="networkidle")
            await expect(pg.get_by_test_id("drawback-pick-s132")).to_have_count(0)
            await expect(pg.get_by_test_id("drawback-pick-s170")).to_have_count(0)
            await expect(pg.get_by_test_id("drawback-s170").get_by_test_id("claim-link-DBK-09260007")).to_be_visible()
            await pg.get_by_test_id("drawback-pick-s137").click()
            await pg.get_by_test_id("drawback-pick-s182").click()
            await expect(pg.get_by_text("2 exports selected")).to_be_visible()
            await shot(pg, "drawback-select")
            await pg.get_by_test_id("claim-create").click()
            await pg.wait_for_url("**/vat/bond-consumption/claims/**")
            new_id = pg.url.rstrip("/").split("/")[-1]
            c = await jget(arif, f"/vat/drawback-claims/{new_id}")
            assert c["status"] == "draft" and sorted(l["saleId"] for l in c["lines"]) == ["s137", "s182"] and c["deadline"] == TODAY and c["no"].startswith("DBK-0926"), c
            tot = (await pg.get_by_test_id("claim-statement-total").inner_text()).replace(",", "")
            assert near(float(tot), c["claimed"], 0.01), (tot, c["claimed"])
            await pg.get_by_test_id("claim-action-file").click()
            dlg = pg.get_by_role("dialog")
            await dlg.get_by_label("DEDO reference / diary no.").fill(f"DEDO/DHK/2026/E{RUN}")
            await dlg.get_by_test_id("claim-action-submit").click()
            await expect(dlg).to_be_hidden()
            await expect(pg.get_by_role("heading", level=1)).to_contain_text("Filed")
            name = await pdf(pg)
            assert name == f"Drawback-claim_{c['no']}.pdf", name
            c = await jget(arif, f"/vat/drawback-claims/{new_id}")
            assert c["status"] == "filed" and c["filedOn"] == TODAY and c["dedoRef"] == f"DEDO/DHK/2026/E{RUN}", c
            await shot(pg, "claim-filed")
            await pg.close()
            db = (await jget(arif, "/vat/bond"))["drawback"]
            rows9 = {r["saleId"]: r for r in db["rows"]}
            assert rows9["s137"]["claim"]["id"] == new_id and rows9["s182"]["claim"]["id"] == new_id and db["totals"]["expiring"] == 0, db["totals"]
            assert near(db["totals"]["claimable"], round(sum(r["total"] for r in db["rows"] if not r.get("claim") and r["state"] != "lapsed"), 2), 0.02), db["totals"]
            ok(f"UI claim: lapsed and claimed exports cannot be ticked; 2 exports → draft {c['no']} (৳{c['claimed']:,.2f}), filed with DEDO on the last day of the window; {name}; both exports now on the claim")
        except Exception as e: fail(9, e)

        # ── 10. Sanction (partial needs a reason) → refund; wrong state, permissions ──
        try:
            assert new_id, "no claim from section 9"
            c = await jget(arif, f"/vat/drawback-claims/{new_id}")
            st, b = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "sanction", "date": TODAY, "amount": c["claimed"] + 100})
            assert st == 422 and b["errors"].get("amount") == ["aboveClaimed"], (st, b)
            st, b = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "sanction", "date": TODAY, "amount": c["claimed"] - 1000})
            assert st == 422 and "reason" in b["errors"], (st, b)
            st, _ = await send(kamal, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "sanction", "date": TODAY})
            assert st == 403, st
            st, _ = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "pay", "date": TODAY})
            assert st == 409, st
            st, c = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "sanction", "date": TODAY, "amount": round(c["claimed"] - 1000, 2), "reason": "E2E: one lot's wastage disallowed", "ref": "SO-E2E"})
            assert st == 200 and c["status"] == "sanctioned" and near(c["disallowed"], 1000, 0.02), (st, c)
            st, b = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "pay", "date": TODAY, "amount": c["sanctioned"] + 1})
            assert st == 422 and b["errors"].get("amount") == ["aboveSanctioned"], (st, b)
            st, c = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "pay", "date": TODAY, "ref": f"EFT-E2E-{RUN}"})
            assert st == 200 and c["status"] == "paid" and c["paid"] == c["sanctioned"], (st, c)
            st, _ = await send(arif, "POST", f"/vat/drawback-claims/{new_id}/action", {"action": "file", "date": TODAY})
            assert st == 409, st
            st, _ = await send(arif, "DELETE", f"/vat/drawback-claims/{new_id}")
            assert st == 409, st
            ok(f"lifecycle: sanction above claimed → 422, partial without reason → 422, operator → 403, refund before sanction → 409; sanctioned ৳{c['sanctioned']:,.2f} (৳1,000 disallowed), refunded; paid claim cannot be re-filed or deleted")
        except Exception as e: fail(10, e)

        # ── 11. Draft delete, reject frees the export ────────────────────
        try:
            d7 = claims.get("DBK-09260007") or {"id": "dc7"}
            st, _ = await send(kamal, "DELETE", f"/vat/drawback-claims/{d7['id']}")
            assert st == 200, st
            db = (await jget(arif, "/vat/bond"))["drawback"]
            s170 = next(r for r in db["rows"] if r["saleId"] == "s170")
            assert not s170.get("claim") and near(db["totals"]["claimable"], round(sum(r["total"] for r in db["rows"] if not r.get("claim") and r["state"] != "lapsed"), 2), 0.02) and db["totals"]["claimable"] >= s170["total"] - 0.01, (s170.get("claim"), db["totals"])
            st, c = await send(kamal, "POST", "/vat/drawback-claims", {"saleIds": ["s170"], "note": "E2E re-claim"})
            assert st == 201 and c["status"] == "draft", (st, c)
            st, c = await send(kamal, "POST", f"/vat/drawback-claims/{c['id']}/action", {"action": "file", "date": TODAY, "ref": f"DEDO/E2E/{RUN}"})
            assert st == 200 and c["status"] == "filed", (st, c)
            st, b = await send(arif, "POST", f"/vat/drawback-claims/{c['id']}/action", {"action": "reject", "date": TODAY})
            assert st == 422 and "reason" in b["errors"], (st, b)
            st, c = await send(arif, "POST", f"/vat/drawback-claims/{c['id']}/action", {"action": "reject", "date": TODAY, "reason": "E2E: endorsed bill of export missing"})
            assert st == 200 and c["status"] == "rejected", (st, c)
            db = (await jget(arif, "/vat/bond"))["drawback"]
            assert not next(r for r in db["rows"] if r["saleId"] == "s170").get("claim"), "rejected claim frees the export"
            st, c2 = await send(kamal, "POST", "/vat/drawback-claims", {"saleIds": ["s170"]})
            assert st == 201, (st, c2)
            aud = await jget(arif, f"/audit?q={c['no']}&size=20")
            acts = {e["action"] for e in aud["data"] if e["entity"] == "drawbackClaim"}
            assert {"created", "submitted", "cancelled"} <= acts, acts
            ok(f"draft deleted → export claimable again; re-claimed, filed by the operator, rejection needs a reason, rejected → claimable again ({c2['no']} drafted); audit: {sorted(acts)}")
        except Exception as e: fail(11, e)

        # ── 12. Claims tab, CSVs, Bangla, read-only auditor ──────────────
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/bond-consumption?tab=claims", wait_until="networkidle")
            await expect(pg.get_by_test_id("claim-row-DBK-11250001")).to_contain_text("Refunded")
            await expect(pg.get_by_test_id("claims-refunded")).to_be_visible()
            await pg.get_by_role("button", name="Rejected", exact=True).click()
            await expect(pg.get_by_test_id("claim-row-DBK-04260004")).to_be_visible()
            await expect(pg.get_by_test_id("claim-row-DBK-11250001")).to_have_count(0)
            await shot(pg, "claims")
            for path, first in (("/vat/bond-uds?format=csv", "UD / UP No"), ("/vat/drawback-claims?format=csv", "Claim")):
                r = await arif.request.get(API + path)
                assert r.ok and "text/csv" in r.headers.get("content-type", ""), (path, r.status)
                txt = (await r.text()).lstrip("\ufeff")
                assert txt.splitlines()[0].split(",")[0].strip('"') == first and len(txt.splitlines()) > 3, (path, txt.splitlines()[0])
            await pg.goto(BASE + "/bn/vat/bond-consumption?tab=uds", wait_until="networkidle")
            await expect(pg.get_by_role("tab", name="ইউডি নিষ্পত্তি")).to_be_visible()
            await expect(pg.get_by_test_id("bud-row-bu1")).to_contain_text("নিষ্পত্তি হয়েছে")
            await pg.close()
            ap = await auditor.new_page(); watch(ap, errs)
            await ap.goto(BASE + "/en/vat/bond-consumption/claims/dc5", wait_until="networkidle")
            await expect(ap.get_by_test_id("claim-statement")).to_be_visible()
            await expect(ap.get_by_test_id("claim-action-sanction")).to_have_count(0)
            await ap.goto(BASE + "/en/vat/bond-consumption?tab=uds", wait_until="networkidle")
            await expect(ap.get_by_test_id("bud-new")).to_have_count(0)
            await ap.close()
            ok("claims tab: status filter; settlement + claims CSVs; Bangla UD tab; auditor sees statements but no actions")
        except Exception as e: fail(12, e)

        bad = [e for e in errs if "favicon" not in e]
        if bad: failures.append(f"browser errors: {bad[:3]}"); print("FAIL browser errors", bad[:5])
        await br.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
