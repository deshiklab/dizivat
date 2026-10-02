"""R6.6 end-to-end checks — export proceeds (bank PRC file matching) and Mushak 9.3 / 9.4 return applications.

Proceeds: overview tiles / ageing vs the open list, the demonstration bank file matched by EXP / invoice / LC / amount,
a manual pick for the amount-only row, posting (realisations, UD + drawback proceeds), duplicates on re-import, batch
reversal (permissions, reason), CSV. Mushak 9.3: one live application per period, reject, create → file (operator) →
approve with a shorter extension (approver), the extension waiving the late-return penalty but not interest, the return
page banner, printable form + PDF. Mushak 9.4: the seeded decrease approved → amended (decreasing adjustment posted in a
later open period), a new increase via the UI (declaration required) → filed → approved → amended with difference +
interest (short deposit refused), printable form + PDF. Bangla pages. Run after e2e_r65; works on mock and PostgreSQL.
"""
import asyncio, csv, io, os, re, time
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
    pg.on("console", lambda m: errs.append(m.text[:240]) if m.type == "error" and "status of 4" not in m.text else None)
VP = {"width": 1440, "height": 900}
near = lambda a, b, tol=0.011: abs((a or 0) - (b or 0)) <= tol
digits = lambda s: re.sub(r"[^\d.]", "", s)

async def jget(ctx, path):
    r = await ctx.request.get(API + path); assert r.ok, f"GET {path} → {r.status}"; return await r.json()
async def send(ctx, method, path, data=None):
    r = await ctx.request.fetch(API + path, method=method, data=data)
    ct = r.headers.get("content-type", "")
    return r.status, (await r.json() if ct.startswith(("application/json", "application/problem")) else None)
async def shot(pg, name):
    await pg.screenshot(path=os.path.join(OUT, f"r66-{name}.png"), full_page=False)
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

FIELDS = {"Date": "date", "PRC No": "prcNo", "Bank": "bank", "Currency": "currency", "FC Amount": "fcAmount", "Rate": "rate", "EXP No": "expNo", "LC No": "lcNo", "Invoice No": "invoiceRef", "Remitter": "remitter"}
def csv_rows(txt):
    rd = list(csv.reader(io.StringIO(txt.lstrip("\ufeff"))))
    head, body = rd[0], [r for r in rd[1:] if any(r)]
    out = []
    for i, r in enumerate(body):
        row = {"line": i + 2}
        for h, v in zip(head, r):
            k = FIELDS.get(h)
            if k and v != "": row[k] = float(v) if k in ("fcAmount", "rate") else v
        out.append(row)
    return out

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        arif = await login_ctx(br, "arif", viewport=VP)
        kamal = await login_ctx(br, "kamal", viewport=VP)
        auditor = await login_ctx(br, "auditor", viewport=VP)
        errs = []
        sample_rows, batch_id, open0, m, ol = [], None, {}, {"rows": []}, []

        # ── 1. Proceeds overview: tiles = open list, ageing buckets, states (earlier suites realise some exports) ──
        try:
            d = await jget(arif, "/vat/proceeds")
            assert d["asOf"] == TODAY
            open_list = d["open"]
            open0 = {o["saleId"]: o for o in open_list}
            assert len(open_list) >= 3, [o["invoiceNo"] for o in open_list]
            assert d["outstanding"]["count"] == len(open_list) and near(d["outstanding"]["bdt"], sum(round(o["outstandingFc"] * o["rate"], 2) for o in open_list), 0.05)
            assert sum(a["count"] for a in d["ageing"]) == len(open_list) and near(sum(a["bdt"] for a in d["ageing"]), d["outstanding"]["bdt"], 0.05)
            over = [o for o in open_list if o["daysLeft"] < 0]
            assert d["overdue"]["count"] == len(over) and all(o["state"] == "overdue" for o in over), [(o["invoiceNo"], o["state"]) for o in over]
            from datetime import date
            for o in open_list:
                assert o["due"] > o["date"] and o["daysLeft"] == (date.fromisoformat(o["due"]) - date.fromisoformat(TODAY)).days, o
                assert (date.fromisoformat(o["due"]) - date.fromisoformat(o["date"])).days == 120, o
                assert o["outstandingFc"] > 0 and o["outstandingFc"] <= o["fcValue"] + 0.01, o
            assert "s182" in open0 and open0["s182"].get("expNo") is None, "the June jeans shipment (no EXP) stays open"
            nos = [b["no"] for b in d["batches"]]
            assert {"PB-05260001", "PB-06260002", "PB-08260003", "PB-09260004"} <= set(nos) and next(b for b in d["batches"] if b["no"] == "PB-09260004")["status"] == "reversed"
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/proceeds", wait_until="networkidle")
            await expect(pg.get_by_test_id("prc-outstanding-n")).to_contain_text(str(d["outstanding"]["count"]))
            await expect(pg.get_by_test_id("prc-overdue-n")).to_contain_text(str(d["overdue"]["count"]))
            for o in open_list:
                await expect(pg.get_by_test_id(f"prc-open-{o['invoiceNo']}")).to_contain_text(f"{o['outstandingFc']:,.2f}"[-6:])
            for a in d["ageing"]: await expect(pg.get_by_test_id(f"prc-age-{a['bucket']}")).to_be_visible()
            await shot(pg, "proceeds-open")
            await pg.get_by_role("tab", name="Bank files").click()
            await expect(pg.get_by_test_id("prc-batch-PB-09260004")).to_be_visible()
            await pg.close()
            ok(f"proceeds overview: {d['outstanding']['count']} open = tiles = ageing; {d['overdue']['count']} overdue past 120 days; seeded batches incl. a reversed one")
        except Exception as e: fail(1, e)

        # ── 2. Match the demonstration bank file (API): EXP / invoice / LC / amount, manual-pick row, duplicate ──
        try:
            ol = list(open0.values())
            r = await arif.request.get(API + "/vat/proceeds/sample")
            assert r.ok and r.headers["content-type"].startswith("text/csv")
            txt = await r.text()
            assert txt.splitlines()[0].startswith("Date,PRC No,Bank,Currency,FC Amount,Rate,EXP No,LC No,Invoice No,Remitter")
            sample_rows = csv_rows(txt)
            n = min(5, len(ol))
            assert len(sample_rows) == n + 1, (len(sample_rows), n)
            st, m = await send(arif, "POST", "/vat/proceeds/match", {"fileName": "sample.csv", "rows": sample_rows})
            assert st == 200, (st, m)
            by = {x["line"]: x for x in m["rows"]}
            inv = lambda x: [a["invoiceNo"] for a in x["allocations"]]
            r0, r1, r2_ = by[2], by[3], by[4]
            want0 = "exp" if ol[0].get("expNo") else "lc" if ol[0].get("lcNo") else "amount"
            assert r0["state"] in ("matched", "split") and inv(r0)[0] == ol[0]["invoiceNo"] and r0["allocations"][0]["basis"] == want0, (r0, ol[0])
            assert near(r0["bdt"], round(r0["fcAmount"] * r0["rate"], 2), 0.02)
            assert r1["state"] == "partial" and inv(r1) == [ol[1]["invoiceNo"]] and r1["allocations"][0]["basis"] == "invoice" and r1["allocations"][0]["fcAmount"] < ol[1]["outstandingFc"], r1
            if ol[2].get("lcNo"): assert r2_["state"] in ("matched", "split") and ol[2]["invoiceNo"] in inv(r2_) and r2_["allocations"][0]["basis"] == "lc", r2_
            if n >= 4:
                r3 = by[5]
                assert r3["state"] in ("unmatched", "ambiguous", "matched"), r3
                if r3["state"] == "unmatched": assert not r3["allocations"] and "noOpenExport" in r3["problems"] and r3["candidates"], r3
            dup = by[n + 2]
            assert dup["state"] == "duplicate", dup
            t = m["totals"]; assert t["rows"] == len(sample_rows) and t["matched"] + t["review"] + t["skipped"] == t["rows"] and t["skipped"] >= 1, t
            # nothing saved by a match
            assert len((await jget(arif, "/vat/proceeds/batches"))["rows"]) == len(d["batches"])
            # file-level validation: missing PRC no. / future date flagged per row, not fatal
            st, m2 = await send(arif, "POST", "/vat/proceeds/match", {"rows": [{"line": 2, "date": "2026-09-20", "prcNo": "", "currency": "USD", "fcAmount": 10, "rate": 122}, {"line": 3, "date": "2026-10-20", "prcNo": "X-1", "currency": "USD", "fcAmount": 10, "rate": 122}]})
            assert st == 200 and all(x["state"] == "invalid" for x in m2["rows"]), m2
            st, _ = await send(kamal, "POST", "/vat/proceeds/match", {"rows": sample_rows}); assert st == 200
            st, _ = await send(auditor, "POST", "/vat/proceeds/match", {"rows": sample_rows}); assert st == 403
            ok(f"bank file of {len(sample_rows)} rows matched: by {want0} → {ol[0]['invoiceNo']}, by invoice (short by charges) → {ol[1]['invoiceNo']}, by LC → {ol[2]['invoiceNo']}; review / duplicate rows; nothing saved; auditor 403")
        except Exception as e: fail(2, e)

        # ── 3. Import in the UI: use sample, manual pick for review rows, post → batch page; realisations everywhere ──
        posted = {}
        try:
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/proceeds", wait_until="networkidle")
            await pg.get_by_test_id("prc-tab-import").click()
            await pg.get_by_test_id("prc-sample").click()
            await expect(pg.get_by_test_id("prc-summary")).to_contain_text(f"{len(sample_rows)} ")
            dup_line = len(sample_rows) + 1
            await expect(pg.get_by_test_id("prc-on-2")).to_be_checked()
            await expect(pg.get_by_test_id(f"prc-on-{dup_line}")).to_be_disabled()
            # over-allocation is shown before posting (row 3 = invoice row)
            amt = pg.get_by_test_id("prc-amt-3-0")
            orig = await amt.input_value()
            await amt.fill(f"{float(orig) + 130:.2f}")
            await expect(pg.get_by_test_id("prc-left-3")).to_have_text(re.compile(r"130(\.00)?$"))
            await amt.fill(orig)
            await expect(pg.get_by_test_id("prc-left-3")).to_have_text(re.compile(r":\s*0(\.00)?$"))
            # review rows: pick the first suggested / open invoice
            picked = 0
            for x in m["rows"]:
                if x["state"] in ("unmatched", "ambiguous"):
                    sel = pg.get_by_test_id(f"prc-add-{x['line']}")
                    if await sel.count():
                        await sel.select_option(index=1); picked += 1
                        await expect(pg.get_by_test_id(f"prc-on-{x['line']}")).to_be_checked()
            n_post = sum(1 for x in m["rows"] if x["state"] in ("matched", "partial", "split")) + picked
            await expect(pg.get_by_test_id("prc-post-summary")).to_contain_text(f"{n_post} ")
            await shot(pg, "proceeds-import")
            await pg.get_by_test_id("prc-post").click()
            await pg.wait_for_url(re.compile(r"/vat/proceeds/batches/[^/?]+$"), timeout=20_000)
            batch_id = pg.url.rsplit("/", 1)[-1]
            await expect(pg.get_by_test_id(f"prc-line-{sample_rows[0]['prcNo']}")).to_contain_text(ol[0]["invoiceNo"])
            await expect(pg.get_by_test_id("prc-reverse")).to_be_visible()
            await shot(pg, "proceeds-batch")
            b = await jget(arif, f"/vat/proceeds/batches/{batch_id}")
            assert b["status"] == "posted" and len(b["lines"]) == n_post and b["skipped"] == len(sample_rows) - n_post, (b["status"], len(b["lines"]), b["skipped"], n_post)
            assert re.fullmatch(r"PB-\d{8}", b["no"]) and near(b["bdt"], sum(l["bdt"] for l in b["lines"]), 0.05)
            if picked: assert any(a["basis"] == "manual" for l in b["lines"] for a in l["allocations"])
            for l in b["lines"]:
                for a in l["allocations"]: posted[a["saleId"]] = round(posted.get(a["saleId"], 0) + a["fcAmount"], 2)
            d2 = await jget(arif, "/vat/proceeds")
            op = {o["saleId"]: o for o in d2["open"]}
            for sid, fc in posted.items():
                left = round(open0[sid]["outstandingFc"] - fc, 2)
                if left <= 0.01: assert sid not in op, (sid, op.get(sid))
                else: assert near(op[sid]["outstandingFc"], left, 0.02) and op[sid]["state"] in ("partial", "overdue"), (sid, op[sid], left)
            full = {sid for sid, fc in posted.items() if open0[sid]["outstandingFc"] - fc <= 0.01}
            # the invoice carries the realisation with the PRC no. and batch
            sid0 = next(a["saleId"] for a in b["lines"][0]["allocations"])
            s = await jget(arif, f"/sales/{sid0}")
            assert any(x.get("prcNo") == b["lines"][0]["prcNo"] and x.get("batchId") == batch_id for x in s["export"].get("realisations", [])), s["export"].get("realisations")
            # UD / drawback claim proceeds follow
            claims = (await jget(arif, "/vat/drawback-claims"))["rows"]
            hit = None
            for c in claims:
                for l in (c.get("proceeds") or {}).get("lines", []):
                    if l["saleId"] in full:
                        assert l["state"] == "realised" and any(p_ in l["prcNos"] for p_ in (x["prcNo"] for x in b["lines"])), l
                        hit = hit or (c["id"], l["prcNos"][-1])
            for u in (await jget(arif, "/vat/bond-uds"))["rows"]:
                for l in (u.get("proceeds") or {}).get("lines", []):
                    if l["saleId"] in full: assert l["state"] == "realised", (u["id"], l)
            if hit:
                await pg.goto(BASE + f"/en/vat/bond-consumption/claims/{hit[0]}", wait_until="networkidle")
                await expect(pg.get_by_test_id("proceeds-list")).to_contain_text(hit[1])
            await pg.close()
            ok(f"imported in the UI: {n_post} PRCs ({picked} picked by hand) posted as {b['no']}; {len(full)} invoices fully realised; open amounts, invoice realisations, UD / drawback-claim proceeds updated{' (claim ' + hit[0] + ')' if hit else ''}")
        except Exception as e: fail(3, e)

        # ── 4. Re-import = duplicates; server-side checks on posting; batch reversal ──
        try:
            assert batch_id
            b = await jget(arif, f"/vat/proceeds/batches/{batch_id}")
            prcs = {l["prcNo"] for l in b["lines"]}
            st, mm = await send(arif, "POST", "/vat/proceeds/match", {"rows": [x for x in sample_rows if x["prcNo"] in prcs]})
            assert st == 200 and all(x["state"] == "duplicate" for x in mm["rows"]), [x["state"] for x in mm["rows"]]
            some = next(iter((await jget(arif, "/vat/proceeds"))["open"]))
            st, e = await send(arif, "POST", "/vat/proceeds/batches", {"fileName": "again.csv", "rows": [{**sample_rows[0], "allocations": [{"saleId": some["saleId"], "fcAmount": 0.01, "basis": "manual"}]}]})
            assert st == 422 and "rows.0.prcNo" in e["errors"], (st, e)
            st, e = await send(arif, "POST", "/vat/proceeds/batches", {"fileName": "over.csv", "rows": [{"line": 2, "date": TODAY, "prcNo": f"PRC/T/{RUN}", "currency": some["currency"], "fcAmount": 0.5, "rate": 122, "allocations": [{"saleId": some["saleId"], "fcAmount": 0.75, "basis": "manual"}]}]})
            assert st == 422 and "rows.0.fcAmount" in e["errors"], (st, e)
            st, e = await send(arif, "POST", "/vat/proceeds/batches", {"fileName": "x.csv", "rows": [{"line": 2, "date": TODAY, "prcNo": f"PRC/T/{RUN}", "currency": "USD", "fcAmount": 100, "rate": 122, "allocations": [{"saleId": "s1", "fcAmount": 100, "basis": "manual"}]}]})
            assert st == 422 and any(k.startswith("rows.0.allocations.0") for k in e["errors"]), (st, e)
            st, _ = await send(kamal, "POST", f"/vat/proceeds/batches/{batch_id}/reverse", {"date": TODAY, "reason": "Operator try"}); assert st == 403
            kp = await kamal.new_page(); watch(kp, errs)
            await kp.goto(BASE + f"/en/vat/proceeds/batches/{batch_id}", wait_until="networkidle")
            await expect(kp.get_by_test_id(f"prc-line-{sample_rows[0]['prcNo']}")).to_be_visible()
            await expect(kp.get_by_test_id("prc-reverse")).to_have_count(0)
            await kp.close()
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + f"/en/vat/proceeds/batches/{batch_id}", wait_until="networkidle")
            await pg.get_by_test_id("prc-reverse").click()
            dlg = pg.get_by_role("dialog")
            await dlg.get_by_label("Reason").fill("x")
            await pg.get_by_test_id("prc-reverse-submit").click()
            await expect(dlg.get_by_role("alert").first).to_be_visible()
            await dlg.get_by_label("Reason").fill("Bank recalled the credit advice — wrong customer account")
            await pg.get_by_test_id("prc-reverse-submit").click()
            await expect(pg.get_by_test_id("prc-reversed")).to_contain_text("wrong customer account")
            await expect(pg.get_by_test_id("prc-reverse")).to_have_count(0)
            await shot(pg, "proceeds-reversed")
            await pg.close()
            d = await jget(arif, "/vat/proceeds")
            op = {o["saleId"]: o for o in d["open"]}
            for sid in posted:
                assert sid in op and near(op[sid]["outstandingFc"], open0[sid]["outstandingFc"], 0.02) and op[sid]["state"] == open0[sid]["state"], (sid, op.get(sid), open0[sid])
            st, _ = await send(arif, "POST", f"/vat/proceeds/batches/{batch_id}/reverse", {"date": TODAY, "reason": "Second reversal"}); assert st == 409
            # PRC numbers of a reversed batch can be imported again
            st, mm = await send(arif, "POST", "/vat/proceeds/match", {"rows": sample_rows[:1]})
            assert mm["rows"][0]["state"] in ("matched", "split"), mm["rows"][0]
            r = await arif.request.get(API + "/vat/proceeds?format=csv")
            body = (await r.text()).lstrip("\ufeff")
            assert r.ok and "text/csv" in r.headers["content-type"] and ol[0]["invoiceNo"] in body and len(body.splitlines()) == len(d["open"]) + 1, body[:200]
            ok("re-import flagged duplicate; posting re-validated (known PRC, over-allocation, unknown invoice); operator cannot reverse; reversal needs a reason and restores the open amounts; reversed PRCs importable again; CSV")
        except Exception as e: fail(4, e)

        # ── 5. Mushak 9.3: one live application per period; reject; operator creates + files; approver approves ──
        lf_new = None
        try:
            st, e = await send(arif, "POST", "/vat/late-filings", {"period": "2026-09", "reasonKind": "systemFailure", "reason": "Server outage during the filing week", "requestedDate": "2026-11-01"})
            assert st == 422 and e["errors"]["period"] == ["duplicate"], (st, e)
            st, e = await send(arif, "POST", "/vat/late-filings", {"period": "2026-08", "reasonKind": "systemFailure", "reason": "Server outage during the filing week", "requestedDate": "2026-10-01"})
            assert st == 422 and e["errors"]["period"] == ["alreadySubmitted"], (st, e)
            st, _ = await send(kamal, "POST", "/vat/late-filings/lf2/action", {"action": "reject", "date": TODAY, "reason": "Operator cannot decide"}); assert st == 403
            q0 = await jget(arif, "/vat/penalty?period=2026-09&vat=100000&paidOn=2026-11-10&filedOn=2026-11-10")
            assert q0["result"]["lateFiling"] is True and q0["result"]["penaltyLate"] > 0 and near(q0["result"]["interestVat"], 1000), q0["result"]
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/return-applications/late/lf2", wait_until="networkidle")
            await expect(pg.get_by_test_id("mushak-93")).to_be_visible()
            await pg.get_by_test_id("late-action-reject").click()
            await pg.get_by_test_id("la-submit").click()
            await expect(pg.get_by_role("dialog").get_by_role("alert").first).to_be_visible()
            await pg.get_by_test_id("la-reason").fill("Grounds not substantiated — no outage report attached")
            await pg.get_by_test_id("la-submit").click()
            await expect(pg.get_by_test_id("late-reject-reason")).to_contain_text("no outage report")
            await pg.close()
            st, e = await send(kamal, "POST", "/vat/late-filings", {"period": "2026-09", "reasonKind": "other", "reason": "Accountant on medical leave", "requestedDate": "2026-11-20"})
            assert st == 422 and "requestedDate" in e["errors"], (st, e)
            st, e = await send(kamal, "POST", "/vat/late-filings", {"period": "2026-09", "reasonKind": "other", "reason": "Accountant on medical leave", "requestedDate": "2026-10-10"})
            assert st == 422 and "requestedDate" in e["errors"], (st, e)
            st, _ = await send(auditor, "POST", "/vat/late-filings", {"period": "2026-09", "reasonKind": "other", "reason": "Accountant on medical leave", "requestedDate": "2026-11-10"}); assert st == 403
            kp = await kamal.new_page(); watch(kp, errs)
            await kp.goto(BASE + "/en/vat/return-applications?tab=late", wait_until="networkidle")
            await expect(kp.get_by_test_id("late-row-LF-01260001")).to_be_visible()
            await kp.get_by_test_id("late-new").click()
            await expect(kp.get_by_test_id("lf-period")).to_have_value("2026-09")
            await expect(kp.get_by_test_id("lf-date")).to_have_value("2026-11-15")
            await kp.get_by_test_id("lf-date").fill("2026-11-10")
            await kp.get_by_test_id("lf-reason").fill("short")
            await kp.get_by_test_id("lf-save").click()
            await expect(kp.get_by_role("dialog").get_by_role("alert").first).to_be_visible()
            await kp.get_by_test_id("lf-reason").fill("ERP migration over the period close — sales ledger not reconciled")
            await kp.get_by_test_id("lf-save").click()
            await kp.wait_for_url(re.compile(r"/vat/return-applications/late/[^/?]+$"), timeout=20_000)
            lf_new = kp.url.rsplit("/", 1)[-1]
            await expect(kp.get_by_test_id("m93-requested")).to_contain_text("10")
            await kp.get_by_test_id("late-action-file").click()
            await kp.get_by_test_id("la-submit").click()
            await expect(kp.get_by_test_id("late-action-approve")).to_have_count(0)
            row = await jget(kamal, f"/vat/late-filings/{lf_new}")
            assert row["state"] == "filed" and row["filedOn"] == TODAY and row["deemedOn"] > TODAY, row
            await kp.close()
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + f"/en/vat/return-applications/late/{lf_new}", wait_until="networkidle")
            await pg.get_by_test_id("late-action-approve").click()
            await expect(pg.get_by_test_id("la-granted")).to_have_value("2026-11-10")
            await pg.get_by_test_id("la-granted").fill("2026-11-20")
            await pg.get_by_test_id("la-submit").click()
            await expect(pg.get_by_role("dialog").get_by_role("alert").first).to_be_visible()
            await pg.get_by_test_id("la-granted").fill("2026-11-08")
            await pg.get_by_test_id("la-submit").click()
            await expect(pg.get_by_test_id("late-effect")).to_be_visible()
            await expect(pg.get_by_test_id("m93-decision")).to_contain_text("granted")
            await shot(pg, "mushak-9-3")
            fn = await pdf(pg)
            row = await jget(arif, f"/vat/late-filings/{lf_new}")
            assert row["state"] == "approved" and row["effectiveDate"] == "2026-11-08" and row["grantedDate"] == "2026-11-08" and row["returnStatus"] == "none", row
            assert row["no"].startswith("LF-") and row["due"] == "2026-10-15" and row["maxDate"] == "2026-11-15" and row["applyBy"] == "2026-10-07"
            q1 = await jget(arif, "/vat/penalty?period=2026-09&vat=100000&paidOn=2026-11-08&filedOn=2026-11-08")
            assert q1["result"]["lateFiling"] is False and q1["result"]["penaltyLate"] == 0 and near(q1["result"]["interestVat"], 1000), q1["result"]
            q2 = await jget(arif, "/vat/penalty?period=2026-09&vat=100000&paidOn=2026-11-12&filedOn=2026-11-12")
            assert q2["result"]["lateFiling"] is True and q2["result"]["penaltyLate"] > 0, q2["result"]
            st, _ = await send(arif, "POST", f"/vat/late-filings/{lf_new}/action", {"action": "approve", "date": TODAY, "grantedDate": "2026-11-08"}); assert st == 409
            lst = await jget(arif, "/vat/late-filings")
            assert lst["totals"]["allowed"] >= 1 and lst["totals"]["rejected"] >= 2, lst["totals"]
            await pg.goto(BASE + "/en/vat/return-9-1?period=2026-09", wait_until="networkidle")
            await expect(pg.get_by_test_id("return-apps-banner")).to_contain_text(row["no"])
            await pg.close()
            ok(f"Mushak 9.3: duplicate / submitted periods refused; seeded LF rejected (reason required); {row['no']} created + filed by the operator, approved to 08-Nov (≤ requested); penalty waived inside the extension, interest kept; PDF {fn}")
        except Exception as e: fail(5, e)

        # ── 6. Mushak 9.4 decrease: seeded AM-09260002 approved → amended, decreasing adjustment posted ──
        try:
            st, _ = await send(kamal, "POST", "/vat/return-amendments/am2/action", {"action": "approve", "date": TODAY}); assert st == 403
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + "/en/vat/return-applications/amend/am2", wait_until="networkidle")
            await expect(pg.get_by_test_id("mushak-94")).to_be_visible()
            await expect(pg.get_by_test_id("m94-effect")).to_contain_text("27,000")
            await pg.get_by_test_id("amend-action-approve").click()
            await expect(pg.get_by_test_id("aa-adj")).to_have_value("2026-09")
            await pg.get_by_test_id("aa-submit").click()
            await expect(pg.get_by_test_id("amend-action-amend")).to_be_visible()
            await pg.get_by_test_id("amend-action-amend").click()
            await pg.get_by_test_id("aa-submit").click()
            await expect(pg.get_by_test_id("amend-done")).to_be_visible()
            await shot(pg, "mushak-9-4-decrease")
            await pg.close()
            row = await jget(arif, "/vat/return-amendments/am2")
            assert row["state"] == "amended" and row["adjustPeriod"] == "2026-09" and row["amended"]["ackNo"], row
            ids = row["amended"]["adjustmentIds"]
            adj = [a for a in (await jget(arif, "/vat/adjustments?size=500"))["data"] if a["id"] in ids]
            assert len(adj) == 1 and adj[0]["note"] == 32 and near(adj[0]["amount"], 27000) and adj[0]["taxPeriod"] == "2026-09" and adj[0]["process"] == "Approved", adj
            assert near(row["computation"]["netVatAfter"], row["effect"]["netVatTo"], 0.02)
            ok(f"Mushak 9.4 decrease: AM-09260002 approved with the adjustment in Sep 2026, amended return {row['amended']['ackNo']} filed, decreasing adjustment {adj[0]['no']} (note 32, ৳27,000) posted")
        except Exception as e: fail(6, e)

        # ── 7. Mushak 9.4 increase via the UI: declaration, file, approve, deposit difference + interest ──
        try:
            st, e = await send(arif, "POST", "/vat/return-amendments", {"period": "2026-08", "reasonKind": "underpaid", "description": "Missed sale invoice", "noAudit": True, "corrections": [{"note": 4, "field": "vat", "to": 0, "explanation": "Typing error"}, {"note": 4, "field": "vat", "to": 1, "explanation": "Typing error"}]})
            assert st == 422 and "corrections.1.note" in e["errors"], (st, e)
            kp = await kamal.new_page(); watch(kp, errs)
            await kp.goto(BASE + "/en/vat/return-applications?tab=amend", wait_until="networkidle")
            await expect(kp.get_by_test_id("amend-row-AM-05260001")).to_be_visible()
            await kp.get_by_test_id("amend-new").click()
            await kp.get_by_test_id("am-period").select_option("2026-08")
            await kp.get_by_test_id("am-desc").fill("Export-linked local sale invoice S-0826 omitted from note 4")
            await kp.get_by_test_id("am-add").click()
            await kp.get_by_test_id("am-note-0").select_option("4")
            frm = float(digits(await kp.get_by_test_id("am-from-0").inner_text()))
            await kp.get_by_test_id("am-to-0").fill(f"{frm + 50000:.2f}")
            await kp.get_by_test_id("am-expl-0").fill("Invoice S-0826 VAT 50,000 omitted")
            await kp.get_by_test_id("am-save").click()
            await expect(kp.get_by_role("dialog").get_by_role("alert").first).to_be_visible()
            await kp.get_by_test_id("am-noaudit").click()
            await kp.get_by_test_id("am-save").click()
            await kp.wait_for_url(re.compile(r"/vat/return-applications/amend/[^/?]+$"), timeout=20_000)
            am_new = kp.url.rsplit("/", 1)[-1]
            await expect(kp.get_by_test_id("m94-delta-vat")).to_contain_text("50,000")
            row = await jget(kamal, f"/vat/return-amendments/{am_new}")
            ef = row["effect"]
            assert ef["direction"] == "increase" and near(ef["deltaVat"], 50000) and ef["months"] == 1 and near(ef["interestVat"], 500) and near(ef["toPay"], 50500), ef
            assert row["applyBy"] == "2030-09-12" and row["state"] == "draft" and row["revision"] == 1, (row["applyBy"], row["state"], row.get("revision"))
            st, e = await send(kamal, "POST", "/vat/return-amendments", {"period": "2026-08", "reasonKind": "underpaid", "description": "Second open application", "noAudit": True, "corrections": [{"note": 4, "field": "vat", "to": frm + 1, "explanation": "Typing error"}]})
            assert st == 422 and e["errors"]["period"] == ["duplicate"], (st, e)
            await kp.get_by_test_id("amend-action-file").click()
            await kp.get_by_test_id("aa-submit").click()
            await expect(kp.get_by_test_id("amend-action-approve")).to_have_count(0)
            await kp.close()
            pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(BASE + f"/en/vat/return-applications/amend/{am_new}", wait_until="networkidle")
            await pg.get_by_test_id("amend-action-approve").click()
            await pg.get_by_test_id("aa-submit").click()
            await pg.get_by_test_id("amend-action-amend").click()
            await expect(pg.get_by_test_id("aa-amount")).to_have_value("50500")
            await pg.get_by_test_id("aa-challan").fill(f"TR-{RUN}")
            await pg.get_by_test_id("aa-amount").fill("50000")
            await pg.get_by_test_id("aa-submit").click()
            await expect(pg.get_by_role("dialog").get_by_role("alert").first).to_be_visible()
            await pg.get_by_test_id("aa-amount").fill("50500")
            await pg.get_by_test_id("aa-submit").click()
            await expect(pg.get_by_test_id("amend-done")).to_be_visible()
            await expect(pg.get_by_test_id("m94-decision")).to_be_visible()
            await shot(pg, "mushak-9-4-increase")
            fn = await pdf(pg)
            await pg.get_by_role("tab", name="Amended computation").click()
            await expect(pg.get_by_test_id("amend-computation")).to_contain_text("Note 41")
            row = await jget(arif, f"/vat/return-amendments/{am_new}")
            assert row["state"] == "amended" and row["amended"]["payment"]["challanNo"] == f"TR-{RUN}" and near(row["amended"]["payment"]["amount"], 50500), row["amended"]
            n41 = next(n for n in row["computation"]["notes"] if n["note"] == 41)["amount"]
            b41 = next(n for n in row["base"]["notes"] if n["note"] == 41)["amount"]
            assert near(n41 - b41, 500), (n41, b41)
            assert near(row["computation"]["netVatAfter"] - row["base"]["netVatAfter"], 50000, 0.02)
            await pg.goto(BASE + "/en/vat/return-9-1?period=2026-08", wait_until="networkidle")
            await expect(pg.get_by_test_id("return-apps-banner")).to_contain_text(row["no"])
            await pg.close()
            lst = await jget(arif, "/vat/return-amendments")
            assert lst["totals"]["amended"] >= 3 and lst["totals"]["paid"] >= 49725 + 50500, lst["totals"]
            ok(f"Mushak 9.4 increase: {row['no']} via the UI (declaration required), difference ৳50,000 + 1 month interest ৳500, filed by the operator, approved, short deposit refused, amended with challan; note 41 carries the interest; PDF {fn}")
        except Exception as e: fail(7, e)

        # ── 8. Lists, CSVs, Bangla, auditor read-only ──
        try:
            for path, first in (("/vat/late-filings?format=csv", "Application"), ("/vat/return-amendments?format=csv", "Application")):
                r = await arif.request.get(API + path)
                assert r.ok and "text/csv" in r.headers.get("content-type", ""), (path, r.status)
                txt = (await r.text()).lstrip("\ufeff")
                assert len(txt.splitlines()) >= 3, (path, txt[:200])
            ap = await auditor.new_page(); watch(ap, errs)
            await ap.goto(BASE + "/en/vat/return-applications?tab=late", wait_until="networkidle")
            await expect(ap.get_by_test_id("late-row-LF-01260001")).to_be_visible()
            await expect(ap.get_by_test_id("late-new")).to_have_count(0)
            await ap.goto(BASE + "/en/vat/return-applications/amend/am1", wait_until="networkidle")
            await expect(ap.get_by_test_id("mushak-94")).to_be_visible()
            await expect(ap.get_by_test_id("amend-action-file")).to_have_count(0)
            await ap.goto(BASE + "/en/vat/proceeds?tab=import", wait_until="networkidle")
            await expect(ap.get_by_test_id("prc-sample")).to_have_count(0)
            await ap.close()
            pg = await arif.new_page(); watch(pg, errs)
            for path in ("/bn/vat/proceeds", "/bn/vat/return-applications?tab=late", "/bn/vat/return-applications?tab=amend", "/bn/vat/return-applications/late/lf1", "/bn/vat/return-applications/amend/am1"):
                await pg.goto(BASE + path, wait_until="networkidle")
                body = await pg.locator("main").inner_text()
                assert not re.search(r"\b(prc|rapp)\.[a-zA-Z]", body), (path, re.findall(r"\b(?:prc|rapp)\.[\w.]+", body)[:5])
                assert re.search(r"[\u0980-\u09FF]{3}", body), path
            await shot(pg, "return-apps-bn")
            await pg.close()
            ok("9.3 / 9.4 CSVs; auditor sees lists and forms without actions or import; Bangla pages render without raw keys")
        except Exception as e: fail(8, e)

        bad = [e for e in errs if "favicon" not in e]
        if bad: failures.append(f"browser errors: {bad[:3]}"); print("FAIL browser errors", bad[:5])
        await br.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
