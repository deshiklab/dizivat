"""R6.2 end-to-end checks — RMG depth + NBR enlistment hardening.

RMG: UD / UP register (usage, warn/over states, bond licence watch-list, UD-fit on deemed-export invoices, edit locks),
export proceeds (PRC: tolerance, unique PRC, approver-only removal, register filter + totals, record from the register
and from the invoice), subcontracting (Mushak 6.4) register, Mushak 6.2.1 purchase-sales book.
Enlistment: VAT-officer role (time-boxed read-only access, every read audited), backups (two a day, verify, download),
bulk master-data import (CSV in the browser, dry run, all-or-nothing, duplicates), Mushak 6.5 on stock transfers.
Creates records (one UD, PRC entries, imported items, a VAT-officer account, backups) — run after the other suites.
Works against the in-memory mock and the PostgreSQL build alike.
"""
import asyncio, gzip, json, os, re, time
from playwright.async_api import async_playwright, expect
from _auth import BASE, PASSWORD, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
DL = os.path.join(OUT, "downloads"); os.makedirs(DL, exist_ok=True)
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
    await pg.screenshot(path=os.path.join(OUT, f"r62-{name}.png"), full_page=False)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        arif = await login_ctx(br, "arif", viewport=VP)
        admin = await login_ctx(br, "admin", viewport=VP)
        kamal = await login_ctx(br, "kamal", viewport=VP)
        auditor = await login_ctx(br, "auditor", viewport=VP)

        # ── 1. UD register (API) ─────────────────────────────────────────
        try:
            reg = await jget(arif, "/vat/uds")
            nos = {r["no"]: r for r in reg["rows"]}
            assert "BKMEA/UD/2026/08812" in nos and "BKMEA/UD/2025/11871" in nos, list(nos)
            assert nos["BKMEA/UD/2025/11871"]["state"] == "expired", nos["BKMEA/UD/2025/11871"]["state"]
            u2 = nos["BKMEA/UD/2026/08812"]
            assert u2["invoices"] >= 1 and 0 < u2["usedPct"], (u2["invoices"], u2["usedPct"])
            line = next(l for l in u2["lines"] if l["itemId"] == "i21")
            assert abs(line["remaining"] - (line["qty"] - line["used"])) < 1e-6
            assert reg["totals"]["expired"] >= 1 and sum(reg["totals"].values()) >= 3
            kinds = {b["kind"] for b in reg["bonds"]}
            assert "own" in kinds and "customer" in kinds, kinds
            ok(f"UD register: {len(reg['rows'])} UDs, states {sorted({r['state'] for r in reg['rows']})}, i21 used {line['used']:,.0f}/{line['qty']:,.0f}; bond watch-list own + customer")
            f = await jget(arif, "/vat/uds?customer=c10")
            assert f["rows"] and all(r["customerId"] == "c10" for r in f["rows"])
            assert not (await jget(arif, "/vat/uds?customer=c1"))["rows"]
            r = await arif.request.get(API + "/vat/uds?format=csv")
            assert r.ok and "text/csv" in r.headers["content-type"] and "BKMEA/UD/2026/08812" in await r.text()
            ok("UD register filters by exporter; CSV (one row per UD line)")
        except Exception as e: fail(1, e)

        # ── 2. UD-fit + create / edit-lock / delete (API) ────────────────
        try:
            st, fit = await send(arif, "POST", "/vat/uds/fit", {"customerId": "c10", "issueDate": TODAY, "udNo": "BKMEA/UD/2026/08812", "lines": [{"itemId": "i21", "qty": 1000}]})
            assert st == 200 and fit and fit["udId"] == "ud2", (st, fit)
            assert fit["ok"] is True, fit
            st, fit2 = await send(arif, "POST", "/vat/uds/fit", {"customerId": "c10", "issueDate": TODAY, "udNo": "BKMEA/UD/2026/08812", "lines": [{"itemId": "i21", "qty": 10_000_000}]})
            assert st == 200 and fit2["ok"] is False and fit2["problems"], fit2
            st, fit3 = await send(arif, "POST", "/vat/uds/fit", {"customerId": "c10", "issueDate": TODAY, "udNo": "NOT-IN-REGISTER", "lines": [{"itemId": "i21", "qty": 1}]})
            assert st == 200 and fit3 is None, fit3
            ok(f"UD fit: within quantity ok; over-quantity → {fit2['problems']}; unknown UD → no check")

            no = f"BKMEA/UD/2026/E2E{RUN}"
            body = {"kind": "UD", "no": no, "date": "2026-09-20", "customerId": "c10", "masterLcNo": f"EXP-LC-26-{RUN}", "buyer": "E2E BUYER", "expiry": "2027-03-31",
                    "lines": [{"itemId": "i21", "qty": 5000}]}
            st, bad = await send(arif, "POST", "/vat/uds", {**body, "expiry": "2026-01-01"})
            assert st == 422 and "expiry" in bad["errors"], (st, bad)
            st, made = await send(arif, "POST", "/vat/uds", body)
            assert st == 201, (st, made)
            st, dup = await send(arif, "POST", "/vat/uds", body)
            assert st == 422 and "no" in dup["errors"], (st, dup)
            st, nc = await send(arif, "POST", "/vat/uds", {**body, "no": no + "X", "customerId": "c1"})
            assert st == 422 and "customerId" in nc["errors"], (st, nc)
            st, _ = await send(auditor, "DELETE", f"/vat/uds/{made['id']}")
            assert st == 403, st
            st, upd = await send(arif, "PUT", f"/vat/uds/{made['id']}", {**body, "note": "edited by e2e"})
            assert st == 200 and upd.get("note") == "edited by e2e", (st, upd)
            ok("UD create: 422 expiry before date / duplicate number / non-exporter customer; viewer cannot delete; edit saves")
            in_use = (await jget(arif, "/vat/uds"))["rows"]
            used = next(r for r in in_use if r["no"] == "BKMEA/UD/2026/08812")
            st, lock = await send(arif, "PUT", f"/vat/uds/{used['id']}", {"kind": "UD", "no": "BKMEA/UD/2026/99999", "date": used["date"], "customerId": "c10", "masterLcNo": used["masterLcNo"], "expiry": used["expiry"], "lines": [{"itemId": l["itemId"], "qty": l["qty"]} for l in used["lines"]]})
            assert st == 422 and "no" in lock["errors"], (st, lock)
            st, _ = await send(arif, "DELETE", f"/vat/uds/{used['id']}")
            assert st == 409, st
            ok("UD in use: number locked (422) and delete refused (409)")
            arif._ud_new = made  # type: ignore[attr-defined]
        except Exception as e: fail(2, e)

        # ── 3. Export proceeds (API) ─────────────────────────────────────
        try:
            er = await jget(arif, "/vat/exports")
            rows = er["rows"] if "rows" in er else er["data"]
            states = {r["proceeds"] for r in rows}
            assert {"realised", "overdue"} <= states, states
            t = er["totals"]
            assert t["overdue"]["count"] >= 1 and t["unrealised"]["count"] >= t["overdue"]["count"], t
            od = (await jget(arif, "/vat/exports?proceeds=overdue"))
            od_rows = od["rows"] if "rows" in od else od["data"]
            assert od_rows and all(r["proceeds"] == "overdue" for r in od_rows)
            ok(f"export register: proceeds states {sorted(states)}; {t['overdue']['count']} overdue (Tk {t['overdue']['value']:,.0f}); ?proceeds=overdue filters")
            target = max(od_rows, key=lambda r: r["outstandingFc"])
            sid, out = target["id"], target["outstandingFc"]
            sale = await jget(arif, f"/sales/{sid}")
            rate = sale["export"]["exchangeRate"]
            base = {"date": TODAY, "bank": "Eastern Bank PLC, Gulshan", "fcAmount": round(out / 2, 2), "rate": rate}
            st, e1 = await send(arif, "POST", f"/sales/{sid}/realisations", {**base, "fcAmount": round(out * 1.2, 2), "prcNo": f"PRC/26/E{RUN}A"})
            assert st == 422 and "fcAmount" in e1["errors"], (st, e1)
            st, e2 = await send(arif, "POST", f"/sales/{sid}/realisations", {**base, "date": "2030-01-01", "prcNo": f"PRC/26/E{RUN}A"})
            assert st == 422 and "date" in e2["errors"], (st, e2)
            st, s1 = await send(arif, "POST", f"/sales/{sid}/realisations", {**base, "prcNo": f"PRC/26/E{RUN}A"})
            assert st == 201, (st, s1)
            st, e3 = await send(arif, "POST", f"/sales/{sid}/realisations", {**base, "prcNo": f"PRC/26/E{RUN}A"})
            assert st == 422 and "prcNo" in e3["errors"], (st, e3)
            st, s2 = await send(arif, "POST", f"/sales/{sid}/realisations", {**base, "fcAmount": round(out - round(out / 2, 2), 2), "prcNo": f"PRC/26/E{RUN}B"})
            assert st == 201, (st, s2)
            after = await jget(arif, f"/vat/exports?q={target['invoiceNo']}")
            arow = next(r for r in (after["rows"] if "rows" in after else after["data"]) if r["id"] == sid)
            assert arow["proceeds"] == "realised" and abs(arow["outstandingFc"]) < 0.01 * max(1, out), arow
            ok(f"proceeds: over-tolerance / future date / duplicate PRC → 422; two PRCs realise {target['invoiceNo']} in full")
            rid = (await jget(arif, f"/sales/{sid}"))["export"]["realisations"][-1]["id"]
            st, _ = await send(kamal, "DELETE", f"/sales/{sid}/realisations?rid={rid}")
            assert st == 403, st
            st, _ = await send(arif, "DELETE", f"/sales/{sid}/realisations?rid={rid}")
            assert st == 200, st
            draft = next((r for r in rows if r.get("process") and r["process"] != "Approved"), None)
            if draft:
                st, nr = await send(arif, "POST", f"/sales/{draft['id']}/realisations", {**base, "prcNo": f"PRC/26/E{RUN}C"})
                assert st == 409, (st, nr)
            ok("proceeds: operator cannot remove a PRC (403), approver can; unapproved invoice → 409 notRealisable")
            aud = await jget(arif, f"/audit?entityId={sid}&pageSize=10")
            assert any(e["action"] == "realised" for e in aud["data"]), [e["action"] for e in aud["data"]]
            ok("proceeds are in the audit trail")
        except Exception as e: fail(3, e)

        # ── 4. Subcontracting register + 6.2.1 + batches (API) ───────────
        try:
            sc = await jget(arif, "/production/subcontract?from=2026-01-01&to=2026-09-30")
            assert sc["rows"], "no contractual batches"
            assert all(r["process"] for r in sc["rows"]) and all(abs(r["pending"] - max(0, r["issued"] - r["received"] - r["damaged"])) < 1e-6 or r["status"] in ("draft", "cancelled") for r in sc["rows"])
            ok(f"subcontract register: {len(sc['rows'])} batches, statuses {sorted({r['status'] for r in sc['rows']})}, material still out Tk {sc['totals']['pendingValue']:,.0f}")
            st, bad = await send(arif, "GET", "/production/subcontract?from=2026-09-30&to=2026-01-01")
            assert st == 422, st
            r = await arif.request.get(API + "/production/subcontract?from=2026-01-01&to=2026-09-30&format=csv")
            assert r.ok and "text/csv" in r.headers["content-type"]
            ok("subcontract register: 422 when To < From; CSV export")
            items = (await jget(arif, "/items?pageSize=200"))["data"]
            traded = next(i for i in items if i["group"] != "Finished Goods")
            b = await jget(arif, f"/mushak/6.2.1?item={traded['id']}&from=2026-07-01&to=2026-09-30")
            assert "rows" in b, list(b)
            ok(f"Mushak 6.2.1 book for {traded['name'][:30]}: {len(b['rows'])} rows")
        except Exception as e: fail(4, e)

        # ── 5. Bulk import (API) ─────────────────────────────────────────
        try:
            sku = f"E2E-{RUN}"
            rows = [{"name": f"E2E hanger {RUN}", "sku": sku, "hsCode": "3926.20.00", "group": "Packing Materials", "unit": "pcs"},
                    {"name": f"E2E poly bag {RUN}", "sku": sku.lower() + "b", "hsCode": "3923210000", "group": "packing", "unit": "PCS", "vatRate": "15"}]
            st, dry = await send(admin, "POST", "/import", {"entity": "items", "dryRun": True, "rows": rows})
            assert st == 200 and dry["valid"] == 2 and dry["created"] == 0 and not dry["issues"], dry
            st, bad = await send(admin, "POST", "/import", {"entity": "items", "dryRun": True, "rows": rows + [dict(rows[0])]})
            assert st == 200 and any(i["row"] == 4 for i in bad["issues"]), bad
            st, bad2 = await send(admin, "POST", "/import", {"entity": "items", "dryRun": False, "rows": rows + [{"name": "x"}]})
            assert bad2["created"] == 0 and bad2["issues"], bad2
            st, done = await send(admin, "POST", "/import", {"entity": "items", "dryRun": False, "rows": rows})
            assert st == 201 and done["created"] == 2, done
            st, again = await send(admin, "POST", "/import", {"entity": "items", "dryRun": False, "rows": rows})
            assert again["created"] == 0 and again["duplicates"] == 2, again
            st, _ = await send(kamal, "POST", "/import", {"entity": "items", "dryRun": True, "rows": rows})
            assert st == 403, st
            got = (await jget(admin, f"/items?q={sku}"))["data"]
            assert any(i["sku"] == sku and i["hsCode"] == "39262000" for i in got), got
            ok("bulk import: HS / group / unit / SKU normalised; in-file duplicate is an error (row = index + 2); all-or-nothing; DB duplicates skipped; operator 403")
            st, cust = await send(admin, "POST", "/import", {"entity": "customers", "dryRun": True, "rows": [{"name": f"E2E Garments {RUN}", "address": "Gazipur", "bin": "123", "type": "Local"}]})
            assert st == 200 and cust["issues"], cust
            ok(f"bulk import customers: invalid BIN reported ({cust['issues'][0]['field']})")
        except Exception as e: fail(5, e)

        # ── 6. Backups (API) ─────────────────────────────────────────────
        try:
            s = await jget(admin, "/backups")
            assert s["schedule"] == ["02:00", "14:00"] and s["retention"] == 30 and s["timezone"] == "Asia/Dhaka", s
            assert s["rows"] and any(r["kind"] == "scheduled" for r in s["rows"]), "no scheduled backup for the current slot"
            st, b = await send(admin, "POST", "/backups")
            assert st == 201 and b["size"] > 1000 and len(b["sha256"]) == 64, (st, b)
            st, v = await send(admin, "POST", f"/backups/{b['id']}/verify")
            assert st == 200 and v["ok"] is True, v
            r = await admin.request.get(API + f"/backups/{b['id']}")
            assert r.ok and r.headers["content-type"].startswith("application/gzip") and r.headers.get("x-backup-sha256") == b["sha256"]
            snap = json.loads(gzip.decompress(await r.body()))
            assert snap["format"] == "dizivat-backup/1" and snap["tables"], list(snap)
            flat = json.dumps(snap)[:5_000_000]
            assert "password_hash" not in flat and "scrypt$" not in flat
            st, _ = await send(arif, "GET", "/backups")
            assert st == 403, st
            st, _ = await send(admin, "POST", "/backups/bk999999/verify")
            assert st == 404, st
            ok(f"backups ({s['storage']}): scheduled slot taken, manual {round(b['size']/1024)} KB, SHA-256 verifies, gzip download without secrets; approver 403")
        except Exception as e: fail(6, e)

        # ── 7. VAT officer (API) ─────────────────────────────────────────
        officer = None
        try:
            uname = f"nbr{RUN}"
            body = {"username": uname, "name": "Md. Rafiq Hasan", "designation": "Revenue Officer, NBR", "email": f"rafiq{RUN}@nbr.example", "mobile": "", "department": "NBR",
                    "role": "vatOfficer", "active": True, "accessUntil": ""}
            st, e1 = await send(admin, "POST", "/users", body)
            assert st == 422 and e1["errors"].get("accessUntil") == ["required"], (st, e1)
            st, e2 = await send(admin, "POST", "/users", {**body, "accessUntil": "2099-01-01"})
            assert st == 422 and e2["errors"].get("accessUntil") == ["accessTooLong"], (st, e2)
            st, e3 = await send(admin, "POST", "/users", {**body, "accessUntil": "2020-01-01"})
            assert st == 422 and e3["errors"].get("accessUntil") == ["accessPast"], (st, e3)
            import datetime
            dhaka = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=6)).date()
            st, made = await send(admin, "POST", "/users", {**body, "accessUntil": str(dhaka + datetime.timedelta(days=14))})
            assert st == 201 and made["user"]["accessUntil"], (st, made)
            ok("VAT officer: access date required, ≤ 90 days, not in the past")
            officer = await br.new_context(viewport=VP)
            r = await officer.request.post(API + "/auth/login", data={"username": uname, "password": made["tempPassword"]})
            assert r.ok, r.status
            me = await r.json()
            assert "doc.create" not in me["permissions"] and "audit.view" in me["permissions"], me["permissions"]
            for path in ["/sales?pageSize=2", "/vat/exports", "/vat/uds", "/audit?pageSize=2"]:
                assert (await officer.request.get(API + path)).ok, path
            st, _ = await send(officer, "POST", "/vat/uds", {"kind": "UD"})
            assert st == 403, st
            st, _ = await send(officer, "GET", "/users")
            assert st == 403, st
            acc = (await jget(admin, f"/audit?entity=access&actor={made['user']['name']}&pageSize=50"))["data"]
            refs = {e["ref"] for e in acc if e["actorId"] == made["user"]["id"]} if acc and "actorId" in acc[0] else {e["ref"] for e in acc}
            assert {"/sales", "/vat/exports", "/vat/uds", "/audit"} <= refs, refs
            ok(f"VAT officer: reads allowed, writes and user admin 403; every read audited ({len(refs)} paths)")
            arif._officer = (uname, made)  # type: ignore[attr-defined]
        except Exception as e: fail(7, e)

        # ── 8. UI: UD register ───────────────────────────────────────────
        try:
            errs = []; pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/vat/ud-register", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="UD / bond register")).to_be_visible()
            table = pg.get_by_role("table", name="UD / UP register")
            await expect(table.get_by_text("BKMEA/UD/2026/08812")).to_be_visible()
            await shot(pg, "ud-register")
            await table.get_by_text("BKMEA/UD/2026/08812").click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg).to_be_visible()
            await expect(dlg.get_by_text("EXP-LC-26-0881")).to_be_visible()
            await shot(pg, "ud-sheet")
            await pg.keyboard.press("Escape")
            await pg.get_by_role("tab", name="Bond licences").click()
            await expect(pg.get_by_role("table", name=re.compile("bond", re.I))).to_be_visible()
            await expect(pg).to_have_url(re.compile(r"tab=bonds"))
            await pg.get_by_role("tab").first.click()
            await pg.get_by_role("button", name="New UD").click()
            form = pg.get_by_role("dialog")
            await form.get_by_role("button", name=re.compile("^Save")).click()
            await expect(form.locator('[aria-invalid="true"]').first).to_be_visible()
            await shot(pg, "ud-form-errors")
            await pg.keyboard.press("Escape")
            assert not errs, errs[:3]
            ok("UI UD register: table, detail sheet, bond-licence tab (URL state), new-UD form validates")
            await pg.close()
        except Exception as e: fail(8, e)

        # ── 9. UI: export register proceeds + record PRC ─────────────────
        try:
            errs = []; pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/vat/export-compliance?proceeds=overdue", wait_until="networkidle")
            btn = pg.get_by_role("button", name=re.compile("^Record proceeds for"))
            await expect(btn.first).to_be_visible()
            n_before = await btn.count()
            await shot(pg, "export-proceeds")
            await btn.first.click()
            dlg = pg.get_by_role("dialog")
            await expect(dlg.get_by_label("PRC number")).to_be_visible()
            await dlg.get_by_label("PRC number").fill(f"PRC/26/UI{RUN}")
            await dlg.get_by_label("Bank and branch").fill("Dutch-Bangla Bank PLC, Motijheel")
            await dlg.locator("#prc-date").fill(TODAY)
            await shot(pg, "prc-dialog")
            await dlg.get_by_role("button", name="Record proceeds").click()
            await expect(pg.get_by_text(re.compile("^Proceeds recorded on"))).to_be_visible()
            await expect(dlg).to_be_hidden()
            await expect(btn).to_have_count(n_before - 1, timeout=10_000)
            assert not errs, errs[:3]
            ok(f"UI export register: overdue filter ({n_before} rows), record PRC dialog saves and the row leaves the filter")
            await pg.close()
        except Exception as e: fail(9, e)

        # ── 10. UI: invoice proceeds card + UD fit ───────────────────────
        try:
            errs = []; pg = await arif.new_page(); watch(pg, errs)
            er = await jget(arif, "/vat/exports?proceeds=realised")
            rid = (er["rows"] if "rows" in er else er["data"])[0]["id"]
            await pg.goto(f"{BASE}/en/sales/{rid}", wait_until="networkidle")
            await expect(pg.get_by_text("Export proceeds", exact=True).first).to_be_visible()
            await expect(pg.get_by_text(re.compile(r"PRC/\d\d/")).first).to_be_visible()
            await shot(pg, "sale-proceeds")
            deemed = [s for s in (await jget(arif, "/sales?pageSize=200"))["data"] if (s.get("export") or {}).get("udNo") == "BKMEA/UD/2026/08812"]
            if deemed:
                await pg.goto(f"{BASE}/en/sales/{deemed[0]['id']}", wait_until="networkidle")
                await expect(pg.get_by_text(re.compile("BKMEA/UD/2026/08812")).first).to_be_visible()
                await expect(pg.get_by_text(re.compile("UD balance|Remaining", re.I)).first).to_be_visible()
                await shot(pg, "sale-udfit")
            assert not errs, errs[:3]
            ok(f"UI invoice: proceeds card with PRC; deemed-export checklist shows the UD balance ({len(deemed)} invoices on UD 08812)")
            await pg.close()
        except Exception as e: fail(10, e)

        # ── 11. UI: subcontracting register, 6.2.1, 6.5 ─────────────────
        try:
            errs = []; pg = await arif.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/production/subcontract", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Subcontracting register")).to_be_visible()
            await expect(pg.get_by_role("table", name="Contractual batches").locator("tbody tr").first).to_be_visible()
            await shot(pg, "subcontract")
            await pg.goto(f"{BASE}/en/vat/mushak-6-2-1", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name=re.compile("Mushak 6.2.1"))).to_be_visible()
            await shot(pg, "m621")
            tlist = (await jget(arif, "/transfers?pageSize=5"))["data"]
            assert tlist, "no transfers in the seed"
            await pg.goto(f"{BASE}/en/inventory/transfers?view={tlist[0]['id']}", wait_until="networkidle")
            await pg.get_by_role("tab", name="Mushak 6.5").click()
            await expect(pg.get_by_text("মূসক-৬.৫").first).to_be_visible()
            await shot(pg, "m65")
            assert not errs, errs[:3]
            ok("UI: subcontracting register, Mushak 6.2.1 book and Mushak 6.5 transfer challan render")
            await pg.close()
        except Exception as e: fail(11, e)

        # ── 12. UI: bulk import ──────────────────────────────────────────
        try:
            errs = []; pg = await admin.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/master/import", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Data import")).to_be_visible()
            csv = f"name,sku,hsCode,group,unit,vatRate\nUI carton {RUN},UI-{RUN},48191000,Packing Materials,pcs,15\nUI gum tape {RUN},UI-{RUN}T,39191000,Packing Materials,pcs,15\n"
            await pg.locator("#imp-file").set_input_files(files=[{"name": "items.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
            await expect(pg.get_by_role("region", name="Preview of the first rows").get_by_text(f"UI carton {RUN}")).to_be_visible()
            imp = pg.get_by_role("button", name=re.compile(r"^Import \d"))
            await expect(imp).to_be_disabled()
            await pg.get_by_role("button", name="Validate").click()
            await expect(pg.get_by_text("All rows passed — 2 will be created.")).to_be_visible()
            await shot(pg, "import-validated")
            await imp.click()
            await expect(pg.get_by_text("Import complete")).to_be_visible()
            await shot(pg, "import-done")
            got = (await jget(admin, f"/items?q=UI-{RUN}"))["data"]
            assert len(got) == 2, got
            bad = "name,sku\nOnly name,X1\n"
            await pg.get_by_role("button", name="Clear").click()
            await pg.locator("#imp-file").set_input_files(files=[{"name": "bad.csv", "mimeType": "text/csv", "buffer": bad.encode()}])
            await expect(pg.get_by_text(re.compile("^Required columns missing"))).to_be_visible()
            assert not errs, errs[:3]
            ok("UI import: CSV preview, Import enabled only after a clean Validate, 2 items created; missing columns flagged")
            await pg.close()
        except Exception as e: fail(12, e)

        # ── 13. UI: backups ──────────────────────────────────────────────
        try:
            errs = []; pg = await admin.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/master/backups", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Backups", exact=True)).to_be_visible()
            table = pg.get_by_role("table", name="Backups")
            n0 = await table.locator("tbody tr").count()
            await pg.get_by_role("button", name="Back up now").click()
            await expect(pg.get_by_text(re.compile(r"^Backup taken"))).to_be_visible()
            await expect(table.locator("tbody tr")).to_have_count(min(30, n0 + 1), timeout=10_000)
            await table.get_by_role("button", name=re.compile("^Verify backup")).first.click()
            await expect(pg.get_by_text("Checksum matches — backup intact")).to_be_visible()
            async with pg.expect_download() as d:
                await table.get_by_role("link", name=re.compile("^Download backup")).first.click()
            dl = await d.value
            path = os.path.join(DL, dl.suggested_filename); await dl.save_as(path)
            assert dl.suggested_filename.endswith(".json.gz") and os.path.getsize(path) > 1000
            await shot(pg, "backups")
            assert not errs, errs[:3]
            ok(f"UI backups: back up now, verify, download {dl.suggested_filename}")
            await pg.close()
        except Exception as e: fail(13, e)

        # ── 14. UI: users — VAT officer access ───────────────────────────
        try:
            errs = []; pg = await admin.new_page(); watch(pg, errs)
            await pg.goto(f"{BASE}/en/master/users", wait_until="networkidle")
            off = getattr(arif, "_officer", None)
            if off:
                await expect(pg.get_by_text(off[1]["user"]["name"]).first).to_be_visible()
                await expect(pg.get_by_text(re.compile(r"until \d{1,2} \w+ 20\d\d|until 20\d\d-")).first).to_be_visible()
            await shot(pg, "users-officer")
            assert not errs, errs[:3]
            ok("UI users: VAT officer listed with the access end date")
            await pg.close()
            if off:
                oc = await br.new_context(viewport=VP)
                await oc.request.post(API + "/auth/login", data={"username": off[0], "password": off[1]["tempPassword"]})
                pg = await oc.new_page(); errs = []; watch(pg, errs)
                await pg.goto(f"{BASE}/en/vat/export-compliance", wait_until="networkidle")
                if "/password" in pg.url or "change" in pg.url:
                    ok("UI officer: first sign-in asks for a new password (temporary password)")
                else:
                    await expect(pg.get_by_role("button", name=re.compile("^Record proceeds for"))).to_have_count(0)
                    ok("UI officer: export register is read-only (no Record PRC buttons)")
                await oc.close()
        except Exception as e: fail(14, e)

        # ── 15. Bangla ──────────────────────────────────────────────────
        try:
            errs = []; pg = await arif.new_page(); watch(pg, errs)
            for path, h in [("/bn/vat/ud-register", None), ("/bn/production/subcontract", None), ("/bn/vat/mushak-6-2-1", None)]:
                await pg.goto(BASE + path, wait_until="networkidle")
                await expect(pg.locator("h1").first).to_be_visible()
                txt = await pg.locator("h1").first.inner_text()
                assert re.search(r"[\u0980-\u09FF]", txt), (path, txt)
            await shot(pg, "bn-subcontract")
            pga = await admin.new_page(); watch(pga, errs)
            for path in ["/bn/master/import", "/bn/master/backups"]:
                await pga.goto(BASE + path, wait_until="networkidle")
                assert re.search(r"[\u0980-\u09FF]", await pga.locator("h1").first.inner_text()), path
            assert not [e for e in errs if "MISSING_MESSAGE" in e or "pageerror" in e], errs[:3]
            ok("Bangla: UD register, subcontracting, 6.2.1, import and backups headings in Bangla, no missing messages")
            await pg.close(); await pga.close()
        except Exception as e: fail(15, e)

        # ── cleanup: the e2e UD (unused) can be deleted ──────────────────
        try:
            made = getattr(arif, "_ud_new", None)
            if made:
                st, _ = await send(arif, "DELETE", f"/vat/uds/{made['id']}")
                assert st == 200, st
                ok("unused UD deleted")
        except Exception as e: fail(16, e)

        await br.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  ✗", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
