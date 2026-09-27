import asyncio, json
from playwright.async_api import async_playwright
from _auth import login_ctx
BASE=__import__("os").environ.get("BASE_URL", "http://localhost:3000")
AXE=open(__import__("pathlib").Path(__file__).resolve().parent.parent / "node_modules/axe-core/axe.min.js").read()
urls=["/en","/en/sales","/en/sales/new","/en/sales/s1","/en/sales/s1?tab=mushak","/en/purchases","/en/purchases/new","/en/purchases/p1","/en/inventory/items","/en/inventory/items?new=1","/en/vat/return-9-1","/bn","/bn/sales","/en/master/customers","/en/master/customers?edit=c1","/en/master/vendors","/en/inventory/items?ledger=i1","/en/sales/s1/edit","/en/master/users","/en/master/users?tab=roles","/en/master/users?edit=u3","/en/master/company","/en/vat/tariff","/en/master/audit","/en/master/audit?entity=company&event=a1","/en/master/units","/en/master/units?edit=un1","/en/inventory/finished-goods","/en/inventory/transfers","/en/inventory/transfers?new=1","/en/inventory/transfers?view=t1","/en/inventory/damage","/en/inventory/damage?view=d1","/en/sales/s1?tab=history"]
async def main():
    res={}
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for theme in ["light","dark"]:
            ctx=await login_ctx(b, "admin", viewport={"width":1440,"height":900}, color_scheme=theme)
            await ctx.add_init_script(f"localStorage.setItem('theme','{theme}')")
            pg=await ctx.new_page()
            for u in urls + ["/en/login"]:
                if u == "/en/login": await ctx.clear_cookies()
                await pg.goto(BASE+u, wait_until="networkidle"); await pg.wait_for_timeout(700)
                await pg.add_script_tag(content=AXE)
                r=await pg.evaluate("""async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes.slice(0,3).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').slice(0,160))}))}""")
                res[f"{theme} {u}"]=r
                print(theme,u,"violations:",sum(v['n'] for v in r), [ (v['id'],v['n']) for v in r])
            await ctx.close()
        await b.close()
    json.dump(res,open("/tmp/axe.json","w"),indent=1)
    bad = {k: v for k, v in res.items() if v}
    if bad: raise SystemExit(f"axe: {len(bad)} page(s) with violations: {list(bad)}")
    print(f"axe: 0 violations on {len(res)} runs")
asyncio.run(main())
