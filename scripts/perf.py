"""Performance budgets (FE-S3-05): LCP, CLS and transferred JS per page on a production build, with
4× CPU throttling and a "fast 4G"-like network via CDP (mid-range Android ≈ what factory staff use).
Budgets: LCP < 2.5 s, CLS < 0.1, initial JS < 400 KB compressed (chunks referenced by the server HTML — the
critical path, S4-03), total JS < 500 KB (initial + chunks loaded after first paint, e.g. dashboard charts). Writes /tmp/perf.json."""
import asyncio, json, sys
from playwright.async_api import async_playwright
from _auth import BASE, login_ctx

PAGES = ["/en", "/en/sales", "/en/sales/new", "/en/purchases", "/en/inventory/items", "/en/master/audit", "/en/login"]
BUDGET = {"lcp": 2500, "cls": 0.1, "js_kb": 400, "js_total_kb": 500}
OBS = """
window.__lcp = 0; window.__cls = 0;
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.renderTime || e.loadTime || e.startTime }).observe({type: 'largest-contentful-paint', buffered: true});
new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({type: 'layout-shift', buffered: true});
"""

async def measure(ctx, path):
    pg = await ctx.new_page()
    cdp = await ctx.new_cdp_session(pg)
    await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 40, "downloadThroughput": 9_000_000 / 8, "uploadThroughput": 3_000_000 / 8})
    # Cold browser cache for the measured visit (the warm-up only primes the server). A first visit is the
    # budget that matters on a factory-floor PC; cached chunks would otherwise report 0 bytes transferred.
    await cdp.send("Network.clearBrowserCache")
    await pg.add_init_script(OBS)
    resp = await pg.goto(BASE + path, wait_until="networkidle"); await pg.wait_for_timeout(1500)
    html = await resp.text() if resp else ""
    # LCP is final once the user interacts; a synthetic key press finalises it
    await pg.keyboard.press("Shift"); await pg.wait_for_timeout(200)
    lcp, cls = await pg.evaluate("[window.__lcp, window.__cls]")
    # Compressed JS bytes (Resource Timing encodedBodySize — independent of cache state)
    scripts = await pg.evaluate("""performance.getEntriesByType('resource')
        .filter(e => e.initiatorType === 'script' || /\\.js(\\?|$)/.test(e.name))
        .map(e => [new URL(e.name).pathname, e.encodedBodySize || 0])""")
    await pg.close()
    initial = sum(n for u, n in scripts if u in html)  # referenced by the SSR document → on the critical path
    total = sum(n for _, n in scripts)
    return {"lcp": round(lcp), "cls": round(cls, 3), "js_kb": round(initial / 1024), "js_total_kb": round(total / 1024)}

async def main():
    res, bad = {}, []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await login_ctx(b, "arif", viewport={"width": 1440, "height": 900})
        for path in PAGES:
            if path == "/en/login": await ctx.clear_cookies()
            await measure(ctx, path)  # warm the server-side render (browser cache is cleared before the measured run)
            r = await measure(ctx, path)
            res[path] = r
            over = [k for k in BUDGET if r[k] > BUDGET[k]]
            print(f"{path:24} LCP {r['lcp']:>5} ms  CLS {r['cls']:<6} JS {r['js_kb']:>4} KB initial / {r['js_total_kb']:>4} KB total  {'OVER ' + ','.join(over) if over else 'ok'}")
            if over: bad.append((path, over))
        await b.close()
    json.dump(res, open("/tmp/perf.json", "w"), indent=1)
    if bad: raise SystemExit(f"perf budget exceeded: {bad}")
    print(f"perf: {len(res)} pages within budget (LCP < {BUDGET['lcp']} ms, CLS < {BUDGET['cls']}, initial JS < {BUDGET['js_kb']} KB, total < {BUDGET['js_total_kb']} KB)")

asyncio.run(main())
