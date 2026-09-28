"""Smoke test for the static GitHub Pages demo (no server: the mock API runs in the browser).

Serve the export under its base path, e.g.
    mkdir -p /tmp/pages && cp -r out /tmp/pages/rbs-vat-frontend && (cd /tmp/pages && python3 -m http.server 8080)
    PAGES_URL=http://localhost:8080/rbs-vat-frontend python3 scripts/pages_smoke.py
"""
import asyncio, os, re, sys
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

BASE = os.environ.get("PAGES_URL", "http://localhost:8080/rbs-vat-frontend").rstrip("/")
PREFIX = urlparse(BASE).path  # the Pages base path, e.g. /rbs-vat-frontend
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


async def api(page, method, path, body=None):
    return await page.evaluate(
        """async ([m, p, b]) => { const r = await fetch('/api/v1' + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
           let j = null; try { j = await r.json() } catch {} return { status: r.status, body: j } }""",
        [method, path, body],
    )


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US", accept_downloads=True)
        page = await ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"{page.url}: {str(e)[:160]}"))

        # 1. Root → locale → sign-in (no session yet)
        await page.goto(BASE + "/")
        await page.wait_for_url(re.compile(r"/en/login/"), timeout=15000)
        check("root redirects to /en/login/ when signed out", True, page.url)
        await expect(page.get_by_text("Static demo on GitHub Pages")).to_be_visible()
        check("static demo notice + reset button", await page.get_by_role("button", name="Reset demo data").is_visible())

        # 2. Wrong password → 401 with attempts left (handler running in the browser)
        await page.get_by_label("Username").fill("kamal")
        await page.locator("#password").fill("nope")
        await page.get_by_role("button", name="Sign in").click()
        await expect(page.locator("main p[role=alert]")).to_contain_text("attempt")
        check("bad password shows attempts left", True)

        # 3. Sign in → dashboard
        await page.get_by_label("Username").fill("arif")
        await page.locator("#password").fill("demo1234")
        await page.get_by_role("button", name="Sign in").click()
        await page.wait_for_url(re.compile(re.escape(PREFIX) + r"/en/$"), timeout=15000)
        await expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=15000)
        check("sign-in lands on the dashboard", True, page.url)

        # 4. Client-side navigation keeps the base path
        await page.locator(f'a[href="{PREFIX}/en/sales/"]').first.click()
        await page.wait_for_url(re.compile(r"/en/sales/"), timeout=15000)
        await expect(page.locator("table tbody tr").first).to_be_visible(timeout=15000)
        check("sales list renders rows", await page.locator("table tbody tr").count() > 5)

        # 5. Deep link (full load) to a seeded document
        await page.goto(BASE + "/en/sales/s1/")
        await expect(page.get_by_text(re.compile(r"S-\d{6}")).first).to_be_visible(timeout=15000)
        check("deep link /en/sales/s1/ renders", True)

        # 6. Create a draft → sequential id → its pre-rendered page and edit page exist
        s1 = (await api(page, "GET", "/sales/s1"))["body"]
        body = {k: s1[k] for k in ("customerId", "issueDate", "issueTime", "method", "issuedBy", "designation")}
        body.update(discount=0, paid=0, vds=False, process="Created", narration="Pages smoke test",
                    lines=[{"itemId": l["itemId"], "qty": 1, "price": l["price"], "sdRate": l["sdRate"], "vatRate": l["vatRate"]} for l in s1["lines"][:1]])
        r = await api(page, "POST", "/sales", body)
        new_id = (r["body"] or {}).get("id", "")
        new_no = (r["body"] or {}).get("invoiceNo", "")
        check("POST /sales creates a draft with a sequential id", r["status"] == 201 and re.fullmatch(r"s\d+", new_id), f"{r['status']} {new_id}")
        await page.goto(f"{BASE}/en/sales/{new_id}/")
        await expect(page.get_by_role("heading", name=new_no)).to_be_visible(timeout=15000)
        check("new document page is reachable", True)
        await page.goto(f"{BASE}/en/sales/{new_id}/edit/")
        await expect(page.get_by_role("button", name=re.compile("Save")).first).to_be_visible(timeout=15000)
        check("new document edit page is reachable", True)

        # 7. Data survives a reload (localStorage)
        await page.reload()
        r = await api(page, "GET", f"/sales/{new_id}")
        check("created draft persists across reloads", r["status"] == 200)

        # 8. Bengali + a placeholder route + master data pages
        await page.goto(BASE + "/bn/master/customers/")
        await expect(page.locator("table tbody tr").first).to_be_visible(timeout=15000)
        check("bn customers page renders", await page.locator("html").get_attribute("lang") == "bn")
        await page.goto(BASE + "/en/production/bom/")
        await expect(page.get_by_role("heading", level=1)).to_be_visible(timeout=15000)
        check("placeholder route renders", True)

        # 8b. Sprint 4 pages run on the in-browser API (static routes, no server)
        await page.goto(BASE + "/en/inventory/transfers/")
        await expect(page.locator("table tbody tr").first).to_be_visible(timeout=15000)
        check("stock transfers page renders", await page.locator("table tbody tr").count() > 3)
        await page.goto(BASE + "/en/master/units/")
        await expect(page.locator("table tbody tr").first).to_be_visible(timeout=15000)
        check("units page renders", await page.locator("table tbody tr").count() >= 7)
        r = await api(page, "GET", "/stock?size=5")
        check("stock-by-branch API answers in the browser", r["status"] == 200 and "branches" in (r["body"] or {}))

        # 9. CSV export link is served by the in-browser API
        await page.goto(BASE + "/en/vat/tariff/")
        await expect(page.locator("table tbody tr").first).to_be_visible(timeout=15000)
        async with page.expect_download(timeout=15000) as dl:
            await page.get_by_role("link", name=re.compile("Export CSV")).click()
        d = await dl.value
        check("CSV export downloads", d.suggested_filename.endswith(".csv"), d.suggested_filename)

        # 10. Sign out → sign-in page; protected page bounces with ?next=
        await page.goto(BASE + "/en/")
        await api(page, "POST", "/auth/logout")
        # Leave the signed-in page first: its own 401 handling would otherwise race us to /login?reason=expired&next=/
        await page.goto("about:blank")
        # The gate redirects with location.replace() as soon as it sees no session — often before `load` fires,
        # which Playwright reports as an aborted goto. Wait only for the response, then assert the redirect.
        await page.goto(BASE + "/en/purchases/", wait_until="commit")
        await page.wait_for_url(re.compile(r"/en/login/\?next="), timeout=15000)
        check("signed-out deep link bounces to login with next", True, page.url)

        # 11. Unknown page → 404
        r = await page.goto(BASE + "/en/does-not-exist/")
        check("unknown path returns 404", r is not None and r.status == 404)

        # Recoverable hydration mismatches (React #418/#419/#421/#422/#423: React re-renders that tree on the client)
        # appear intermittently on cold loads of the static demo's document pages. They are reported with the URL
        # but do not block the deploy; any other uncaught error does. Known issue — tracked for Sprint 5.
        hydration = [e for e in errors if re.search(r"Minified React error #4(18|19|21|22|23)\b", e)]
        other = [e for e in errors if e not in hydration]
        for e in hydration:
            print("WARN recoverable hydration mismatch — " + e)
        check("no uncaught page errors", not other, "; ".join(other[:3]))
        await browser.close()

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
