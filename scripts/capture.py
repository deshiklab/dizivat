import asyncio, sys, json, datetime
from playwright.async_api import async_playwright
from _auth import login_ctx

# Baselines must not depend on when CI runs: the dashboard greeting follows the browser clock.
# Freeze it at the demo's "today" (25 Sep 2026, 10:30 Dhaka) — timers keep running.
FROZEN = datetime.datetime(2026, 9, 25, 10, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=6)))
BASE=__import__("os").environ.get("BASE_URL", "http://localhost:3000")
OUT=__import__("os").environ.get("SHOT_DIR", "/home/user/RBS_VAT_Frontend_Plan/screenshots")
__import__("os").makedirs(OUT, exist_ok=True)
pages=[
 ("01_dashboard","/en",None),
 ("02_sales_list","/en/sales",None),
 ("03_sales_filtered","/en/sales?process=Approved&payment=unpaid,partial&from=2026-07-01&to=2026-09-25&sort=due.desc",None),
 ("04_sale_new","/en/sales/new",None),
 ("05_sale_detail","/en/sales/s1",None),
 ("06_mushak63","/en/sales/s1?tab=mushak",None),
 ("07_purchases","/en/purchases",None),
 ("08_purchase_new","/en/purchases/new",None),
 ("09_purchase_detail","/en/purchases/p1",None),
 ("10_items","/en/inventory/items",None),
 ("11_item_sheet","/en/inventory/items?edit=i1",None),
 ("12_return_current","/en/vat/return-9-1",None),
 ("13_bn_dashboard","/bn",None),
 ("14_bn_sales","/bn/sales",None),
 # R2: purchase & inventory
 ("r1_import_new","/en/purchases/new?type=import",None),
 ("r2_debit_notes","/en/purchases/debit-notes",None),
 ("r3_master_items","/en/inventory/master-items",None),
 ("r4_mushak61","/en/vat/mushak-6-1?item=i6",None),
 # R4: NBR VAT & accounting
 ("r5_return91","/en/vat/return-9-1?period=2026-08",None),
 ("r6_compliance","/en/vat/mushak?period=2026-08",None),
 ("r7_receipts","/en/accounting/receipts",None),
 ("r8_tr6_print","/en/vat/tr-6?view=tc1&tab=print",None),
]
# Sprint 3: visual coverage beyond light desktop — dark theme, 390 px phone, Bangla form
variants=[
 ("v1_dark_dashboard","/en","dark",None),
 ("v2_dark_sales","/en/sales","dark",None),
 ("v3_dark_sale_new","/en/sales/new","dark",None),
 ("v4_mobile_dashboard","/en","light",{"width":390,"height":844}),
 ("v5_mobile_sales","/en/sales","light",{"width":390,"height":844}),
 ("v6_bn_sale_new","/bn/sales/new","light",None),
]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await login_ctx(b, viewport={"width":1440,"height":900}, device_scale_factor=1, timezone_id="Asia/Dhaka")
        pg=await ctx.new_page()
        await pg.clock.set_fixed_time(FROZEN)
        errs=[]
        pg.on("console", lambda m: errs.append((m.type, m.text[:300])) if m.type in ("error","warning") else None)
        pg.on("pageerror", lambda e: errs.append(("pageerror", str(e)[:300])))
        for name,url,_ in pages:
            await pg.goto(BASE+url, wait_until="networkidle")
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=f"{OUT}/{name}.png", full_page=False)
            print(name, "ok")
        for name,url,theme,vp in variants:
            c=await login_ctx(b, viewport=vp or {"width":1440,"height":900}, device_scale_factor=1, color_scheme=theme, is_mobile=bool(vp), has_touch=bool(vp), timezone_id="Asia/Dhaka")
            await c.add_init_script(f"localStorage.setItem('theme','{theme}')")
            vpg=await c.new_page()
            await vpg.clock.set_fixed_time(FROZEN)
            vpg.on("pageerror", lambda e: errs.append(("pageerror", str(e)[:300])))
            await vpg.goto(BASE+url, wait_until="networkidle"); await vpg.wait_for_timeout(900)
            await vpg.screenshot(path=f"{OUT}/{name}.png", full_page=False)
            print(name, "ok"); await c.close()
        print(json.dumps(errs[:30], indent=0, ensure_ascii=False))
        await b.close()
        if errs: sys.exit(f"{len(errs)} console/page errors")
asyncio.run(main())
