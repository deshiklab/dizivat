"""Mushak 4.3 register and copyright line — end-to-end checks.
Mushak 4.3: sidebar entry under NBR VAT, compliance-centre link, command palette in English and Bangla (digit-insensitive),
the register (show filter, search, selection kept in the URL, official form, drafts/superseded notes, print, back to the
BOM), "Help for this page" and the help article. Copyright: status footer, sign-in page, phone drawer, Bangla labels and
the HTML/Markdown exports. Read-only: creates no documents, so it can run at any point."""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
DL = os.path.join(OUT, "downloads"); os.makedirs(DL, exist_ok=True)
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
CREDIT_EN = "© BITSCOL (www.bitscol.com), Email: sales@bitscol.com, Mobile: +8801711853769"
CREDIT_BN = "© BITSCOL (www.bitscol.com), ইমেইল: sales@bitscol.com, মোবাইল: +8801711853769"
FORM = "article[aria-label='Mushak 4.3 input-output coefficient declaration']"
PRINT_STUB = "window.print = () => { window.__prints = (window.__prints || 0) + 1 }"

async def settle(pg):
    await pg.wait_for_timeout(60)
    await pg.evaluate("Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))")
    await pg.wait_for_timeout(100)

async def check_credit(loc, text):
    got = " ".join((await loc.inner_text()).split())
    assert got == text, got
    assert await loc.locator("a[href='https://www.bitscol.com']").count() == 1
    assert await loc.locator("a[href='mailto:sales@bitscol.com']").count() == 1
    assert await loc.locator("a[href='tel:+8801711853769']").count() == 1

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        ctx = await login_ctx(b, "arif", viewport=VP, accept_downloads=True)
        await ctx.add_init_script(PRINT_STUB)
        pg = await ctx.new_page(); watch(pg, errs)
        boms = (await (await ctx.request.get(f"{BASE}/api/v1/production/boms?size=200")).json())["data"]
        active = [x for x in boms if x["status"] == "active"]
        superseded = [x for x in boms if x["status"] == "superseded"]

        # ── 1. Finding it: sidebar, compliance centre, palette ────────
        try:
            await pg.goto(BASE + "/en/production/bom", wait_until="networkidle")
            side = pg.locator("[data-sidebar='sidebar']").first
            await expect(side.get_by_role("link", name="Bill of materials (4.3)")).to_be_visible()
            await pg.goto(BASE + "/en/vat/mushak", wait_until="networkidle")
            await expect(side.get_by_role("link", name="Mushak 4.3", exact=True)).to_be_visible()
            main_ = pg.locator("main")
            await expect(main_.locator("a[href$='/vat/mushak-4-3']").first).to_be_visible()
            await main_.locator("a[href$='/vat/mushak-4-3']").first.click()
            await expect(pg).to_have_url(re.compile(r"/en/vat/mushak-4-3"))
            ok("NBR VAT › Mushak 4.3 in the sidebar; BOM entry labelled (4.3); compliance-centre 4.3 card opens the register")
            await pg.goto(BASE + "/en/purchases", wait_until="networkidle")
            await pg.keyboard.press("Control+k")
            await pg.get_by_role("combobox").fill("mushak 4.3")
            await expect(pg.get_by_role("option", name=re.compile(r"NBR VAT › Mushak 4\.3"))).to_be_visible()
            await pg.keyboard.press("Enter")
            await expect(pg).to_have_url(re.compile(r"/en/vat/mushak-4-3"))
            await pg.goto(BASE + "/bn/purchases", wait_until="networkidle")
            await pg.keyboard.press("Control+k")
            await pg.get_by_role("combobox").fill("মূসক 4.3")
            await expect(pg.get_by_role("option", name=re.compile("এনবিআর ভ্যাট › মূসক ৪\\.৩"))).to_be_visible()
            await pg.keyboard.press("Enter")
            await expect(pg).to_have_url(re.compile(r"/bn/vat/mushak-4-3"))
            ok("command palette finds Mushak 4.3 in English and Bangla (Latin digits match ৪.৩)")
        except Exception as e: fail(1, e)

        # ── 2. The register ───────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/vat/mushak-4-3", wait_until="networkidle")
            await expect(pg.get_by_role("heading", level=1, name=re.compile("Mushak 4.3"))).to_be_visible()
            items = pg.locator("main section[aria-label='Declarations'] ul li button")
            await expect(items.first).to_be_visible()
            assert await items.count() == len(active), (await items.count(), len(active))
            form = pg.locator(FORM)
            await expect(form).to_be_visible()
            await expect(form).to_contain_text(active[0]["no"])
            await expect(form).to_contain_text("মূসক-৪.৩")
            await settle(pg); await pg.screenshot(path=f"{OUT}/120_mushak43.png")
            ok(f"register lists the {len(active)} active declarations and shows the official form for the first")
            if len(active) > 1:
                await items.nth(1).click()
                await expect(pg).to_have_url(re.compile(rf"id={active[1]['id']}"))
                await expect(form).to_contain_text(active[1]["no"])
                await expect(items.nth(1)).to_have_attribute("aria-current", "true")
            q = active[0]["sku"]
            await pg.get_by_label("Search").fill(q)
            await expect(items).to_have_count(sum(1 for x in active if q.lower() in f"{x['no']} {x['itemName']} {x['sku']} {x['hsCode']}".lower() or any(q.lower() in i["name"].lower() for i in x["inputs"])))
            await expect(pg).to_have_url(re.compile(r"q="))
            ok("selecting a declaration swaps the form and is kept in the URL; search narrows the list")
            await pg.goto(BASE + "/en/vat/mushak-4-3?show=all", wait_until="networkidle")
            await expect(items.first).to_be_visible()
            assert await items.count() == len([x for x in boms]), await items.count()
            if superseded:
                s = superseded[0]
                await pg.goto(BASE + f"/en/vat/mushak-4-3?show=all&id={s['id']}", wait_until="networkidle")
                await expect(form).to_contain_text(s["no"])
                await expect(pg.get_by_role("status").filter(has_text="Replaced by a newer version")).to_be_visible()
            ok(f"'All versions' lists every declaration ({len(boms)}), superseded ones with a note")
            await pg.goto(BASE + f"/en/vat/mushak-4-3?id={active[0]['id']}", wait_until="networkidle")
            await expect(form).to_be_visible()
            await pg.get_by_role("button", name="Print / PDF").click()
            await pg.wait_for_function("(window.__prints || 0) >= 1")
            await pg.get_by_role("link", name="Open in Bill of materials").click()
            await expect(pg).to_have_url(re.compile(rf"/en/production/bom\?view={active[0]['id']}"))
            await expect(pg.get_by_role("dialog")).to_be_visible()
            ok("Print / PDF opens the print dialog; Open in Bill of materials opens the same declaration")
            await pg.goto(BASE + "/en/vat/mushak-4-3", wait_until="networkidle")
            await pg.get_by_role("button", name="Help", exact=True).click()
            await pg.get_by_role("menuitem", name="Help for this page").click()
            await expect(pg).to_have_url(re.compile(r"/en/help/bom$"))
            await expect(pg.get_by_role("heading", name="Find and print Mushak 4.3")).to_be_visible()
            ok("Help for this page → the price-declaration article with a 'Find and print Mushak 4.3' section")
            await pg.goto(BASE + "/bn/vat/mushak-4-3", wait_until="networkidle")
            await expect(pg.get_by_role("heading", level=1, name=re.compile("মূসক ৪.৩"))).to_be_visible()
            await expect(pg.locator(FORM)).to_be_visible()
            ok("Bangla register")
        except Exception as e: fail(2, e)

        # ── 3. Copyright line ─────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en", wait_until="networkidle")
            await check_credit(pg.locator("footer [data-testid='credit']"), CREDIT_EN)
            await pg.goto(BASE + "/bn", wait_until="networkidle")
            await check_credit(pg.locator("footer [data-testid='credit']"), CREDIT_BN)
            ok("status footer shows the copyright line with web, e-mail and phone links (Bangla labels in Bangla)")
            anon = await b.new_context(viewport=VP)
            lp = await anon.new_page(); watch(lp, errs)
            await lp.goto(BASE + "/en/login", wait_until="networkidle")
            await check_credit(lp.locator("[data-testid='credit']"), CREDIT_EN)
            await anon.close()
            ok("sign-in page shows the copyright line")
            phone = await login_ctx(b, "arif", viewport={"width": 390, "height": 844})
            mp = await phone.new_page(); watch(mp, errs)
            await mp.goto(BASE + "/en", wait_until="networkidle")
            await mp.get_by_role("button", name=re.compile("Toggle sidebar", re.I)).first.click()
            await expect(mp.locator("[data-testid='credit']").first).to_be_visible()
            await phone.close()
            ok("phones: copyright line in the navigation drawer")
            await pg.goto(BASE + "/en/help/sales-invoices", wait_until="networkidle")
            await pg.get_by_role("button", name="Download").click()
            async with pg.expect_download() as d:
                await pg.get_by_role("menuitem", name="Web page (.html)").click()
            html = open(await (await d.value).path(), encoding="utf-8").read()
            assert 'class="credit"' in html and "BITSCOL" in html and 'href="mailto:sales@bitscol.com"' in html and 'href="tel:+8801711853769"' in html, "html credit"
            await pg.get_by_role("button", name="Download").click()
            async with pg.expect_download() as d:
                await pg.get_by_role("menuitem", name="Markdown (.md)").click()
            md = open(await (await d.value).path(), encoding="utf-8").read()
            assert md.rstrip().endswith(CREDIT_EN), md[-200:]
            ok("HTML and Markdown exports end with the copyright line")
        except Exception as e: fail(3, e)

        real = [e for e in errs if "418" not in e and "Failed to load resource" not in e]
        if real: failures.append(f"console errors: {real[:5]}")
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
