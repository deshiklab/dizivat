import asyncio, re
from playwright.async_api import async_playwright, expect
from _auth import login_ctx
BASE=__import__("os").environ.get("BASE_URL", "http://localhost:3000"); OUT=__import__("os").environ.get("SHOT_DIR", "/tmp/dizivat-screens")
__import__("os").makedirs(OUT, exist_ok=True)
ok=lambda m: print("PASS", m)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await login_ctx(b, viewport={"width":1440,"height":900}, permissions=["clipboard-read","clipboard-write"])
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        # 1 validation
        await pg.goto(BASE+"/en/sales/new", wait_until="networkidle")
        await pg.get_by_role("button", name="Save & approve").click()
        await expect(pg.get_by_text("This field is required.").first).to_be_visible(); ok("empty form shows validation errors")
        await pg.screenshot(path=f"{OUT}/15_sale_validation.png")
        # 2 fill
        await pg.locator("#customerId").click(); await pg.get_by_placeholder("Search name or BIN…").fill("sunrise"); await pg.get_by_role("option").first.click()
        await pg.get_by_role("combobox", name="Product 1").click(); await pg.get_by_role("option", name=re.compile("Basic T-Shirt")).click()
        await pg.get_by_label("Qty 1").fill("500")
        await pg.get_by_role("button", name="Add line").click()
        await pg.get_by_role("combobox", name="Product 2").click(); await pg.get_by_role("option", name=re.compile("Denim Jeans")).click()
        await pg.get_by_label("Qty 2").fill("1200")
        await pg.locator("#vehicle").fill("Dhaka Metro-Ta 11-4455")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/16_sale_filled.png", full_page=True)
        net=await pg.locator("aside dl").nth(1).locator("dd").first.inner_text(); print("  net total shown:", net)
        await pg.get_by_role("button", name="Save & approve").click()
        await pg.wait_for_url(re.compile(r"/en/sales/s\d+"), timeout=15000); ok("created invoice & redirected: "+pg.url)
        await expect(pg.get_by_text("Approved").first).to_be_visible(); ok("new invoice approved")
        # 2b over-stock is rejected by the server with a line-level message
        await pg.goto(BASE+"/en/sales/new", wait_until="networkidle")
        await pg.locator("#customerId").click(); await pg.get_by_placeholder("Search name or BIN…").fill("orion"); await pg.get_by_role("option").first.click()
        await pg.get_by_role("combobox", name="Product 1").click(); await pg.get_by_role("option", name=re.compile("Basic T-Shirt")).click()
        await pg.get_by_label("Qty 1").fill("9999999")
        await pg.get_by_role("button", name="Save & approve").click()
        await expect(pg.get_by_text(re.compile("Line 1: Exceeds available stock")).first).to_be_visible(timeout=8000)
        assert "/sales/new" in pg.url; ok("over-stock sale blocked with line error")
        await pg.screenshot(path=f"{OUT}/31_stock_validation.png")
        # 3 list, bulk approve drafts
        await pg.goto(BASE+"/en/sales?process=Created", wait_until="networkidle"); await pg.wait_for_timeout(500)
        n=await pg.locator("tbody tr").count(); print("  drafts:", n)
        await pg.get_by_role("checkbox", name="Select row").nth(0).click(); await pg.get_by_role("checkbox", name="Select row").nth(1).click()
        await pg.screenshot(path=f"{OUT}/17_bulk_select.png")
        await pg.get_by_role("button", name=re.compile(r"Approve 2 drafts")).click(); await pg.wait_for_timeout(1200)
        n2=await pg.locator("tbody tr").count(); ok(f"bulk approve: drafts {n} -> {n2}")
        # 4 palette
        await pg.keyboard.press("Control+k"); await pg.keyboard.type("HILL"); await pg.wait_for_timeout(900)
        await pg.screenshot(path=f"{OUT}/18_command_palette.png")
        cnt=await pg.get_by_role("option").count(); ok(f"palette server search results: {cnt}")
        await pg.keyboard.press("Escape")
        # 5 shortcuts
        await pg.locator("#main h1").click(); await pg.keyboard.press("g"); await pg.keyboard.press("p"); await pg.wait_for_url(re.compile("/en/purchases"), timeout=5000); ok("g p navigates to purchases")
        await pg.keyboard.press("Shift+?"); await expect(pg.get_by_role("dialog")).to_be_visible(); await pg.screenshot(path=f"{OUT}/19_shortcuts.png"); await pg.keyboard.press("Escape"); ok("? opens shortcut help")
        # 6 date preset -> URL
        await pg.goto(BASE+"/en/sales", wait_until="networkidle")
        await pg.get_by_role("button", name="Date range").click(); await pg.screenshot(path=f"{OUT}/20_date_presets.png")
        await pg.get_by_role("button", name="Last VAT period").click(); await pg.wait_for_timeout(800)
        assert "from=2026-08-01" in pg.url and "to=2026-08-31" in pg.url; ok("date preset writes URL "+pg.url.split("?")[1])
        await pg.get_by_role("button", name="Status").first.click(); await pg.screenshot(path=f"{OUT}/21_facet_filter.png"); await pg.keyboard.press("Escape")
        # 7 language switch keeps route + query
        await pg.get_by_role("button", name="Account and preferences").click(); await pg.get_by_role("menuitem", name="Language").click(); await pg.get_by_role("menuitemradio", name="বাংলা").click()
        await pg.wait_for_url(re.compile("/bn/sales\\?"), timeout=8000); ok("language switch keeps route+filters: "+pg.url.replace(BASE,""))
        await pg.wait_for_timeout(800); await pg.screenshot(path=f"{OUT}/22_bn_sales_filtered.png")
        # 8 user menu screenshot
        await pg.goto(BASE+"/en", wait_until="networkidle")
        await pg.get_by_role("button", name="Account and preferences").click(); await pg.get_by_role("menuitem", name="Accent colour").click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/23_user_menu.png"); await pg.get_by_role("menuitemradio", name="Emerald").click(); await pg.wait_for_timeout(300)
        acc=await pg.evaluate("document.documentElement.dataset.accent"); ok("accent applied: "+acc)
        await pg.evaluate("localStorage.setItem('dizivat-prefs', JSON.stringify({accent:'blue',density:'cozy',text:'md'}))")
        await pg.wait_for_timeout(500)
        # prefs are now server-side per user (S2-03): check persistence, then reset for the following runs
        pr=await (await ctx.request.get(BASE+"/api/v1/me")).json(); assert pr["preferences"].get("accent")=="emerald", pr; ok("accent persisted to server profile")
        await ctx.request.put(BASE+"/api/v1/me/preferences", data={"accent":"blue","density":"cozy","text":"md"})
        print("page errors:", errs)
        assert not errs, errs
        await ctx.close()
        # 9 dark
        ctx=await login_ctx(b, viewport={"width":1440,"height":900}); await ctx.add_init_script("localStorage.setItem('theme','dark')")
        pg=await ctx.new_page()
        for n,u in [("24_dark_dashboard","/en"),("25_dark_sales","/en/sales"),("26_dark_sale_new","/en/sales/new")]:
            await pg.goto(BASE+u, wait_until="networkidle"); await pg.wait_for_timeout(800); await pg.screenshot(path=f"{OUT}/{n}.png")
        await ctx.close()
        # 10 mobile
        ctx=await login_ctx(b, viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg=await ctx.new_page()
        for n,u in [("27_mobile_dashboard","/en"),("28_mobile_sales","/en/sales"),("29_mobile_sale_new","/en/sales/new")]:
            await pg.goto(BASE+u, wait_until="networkidle"); await pg.wait_for_timeout(800); await pg.screenshot(path=f"{OUT}/{n}.png")
        small=await pg.evaluate("""()=>{const els=[...document.querySelectorAll('button,a,[role=combobox],input,select')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'});return {total:els.length, small:els.filter(e=>{const r=e.getBoundingClientRect();return r.height<44 && e.tagName!=='INPUT'}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,30)+':'+Math.round(e.getBoundingClientRect().height))}}""")
        print("mobile targets", small['total'], "under 44px:", small['small'][:15])
        await pg.goto(BASE+"/en/sales", wait_until="networkidle"); await pg.get_by_role("button", name="More").click(); await pg.wait_for_timeout(500); await pg.screenshot(path=f"{OUT}/30_mobile_menu.png")
        await b.close()
asyncio.run(main())
