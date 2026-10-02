"""Knowledge base end-to-end checks: help centre (topics, search in English and Bangla, digit-insensitive), article pages
(TOC anchors, related, screens covered, prev/next, in-app and cross-article links), print (standalone frame, no app
chrome), PDF, share (copy link), downloads (article and full manual as HTML + Markdown, both languages), the top-bar
help menu with "Help for this page", the sidebar link and command palette, every article in both languages, 404 for
unknown articles and access for every role. Read-only: creates no documents, so it can run at any point."""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
os.makedirs(OUT, exist_ok=True)
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
N_ARTICLES = 46
# window.print is replaced in every frame (the print frame is a srcdoc iframe): count calls on the top window.
PRINT_STUB = "window.print = () => { try { window.top.__kbPrints = (window.top.__kbPrints || 0) + 1 } catch (e) {} }"

async def settle(pg):
    await pg.wait_for_timeout(60)
    await pg.evaluate("Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))")
    await pg.wait_for_timeout(100)

async def download(pg, open_menu, item):
    await open_menu()
    async with pg.expect_download() as d:
        await pg.get_by_role("menuitem", name=item).click()
    dl = await d.value
    path = os.path.join(DL, dl.suggested_filename)
    await dl.save_as(path)
    with open(path, encoding="utf-8") as f:
        return dl.suggested_filename, f.read()

async def printed(pg, title, before):
    await pg.wait_for_function("([t, n]) => document.documentElement.dataset.kbPrinted === t && (window.__kbPrints || 0) > n", arg=[title, before], timeout=15000)
    return await pg.evaluate("document.getElementById('kb-print-frame').srcdoc")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        appr = await login_ctx(b, "arif", viewport=VP, accept_downloads=True)
        await appr.grant_permissions(["clipboard-read", "clipboard-write"], origin=re.match(r"https?://[^/]+", BASE).group(0))
        await appr.add_init_script(PRINT_STUB)
        pg = await appr.new_page(); watch(pg, errs)

        # ── 1. Help centre ────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="Knowledge base", exact=True)).to_be_visible()
            await expect(pg.get_by_role("heading", name="Start here")).to_be_visible()
            main_ = pg.locator("main")
            for cat in ("Getting started", "Sales", "Purchase", "Inventory", "Production", "Accounting", "NBR VAT", "Master data & admin", "Reference"):
                await expect(main_.get_by_role("heading", name=re.compile("^" + re.escape(cat) + " ·"))).to_be_visible()
            hrefs = set(await main_.locator("a[href*='/help/']").evaluate_all("els => els.map(e => e.getAttribute('href'))"))
            assert len(hrefs) == N_ARTICLES, len(hrefs)
            await settle(pg); await pg.screenshot(path=f"{OUT}/110_help_home.png")
            ok(f"help centre lists {N_ARTICLES} articles in 9 topics with a Start here panel")
            await pg.get_by_role("group", name="Filter by topic").get_by_role("button", name="NBR VAT", exact=True).click()
            await expect(pg.get_by_role("group", name="Filter by topic").get_by_role("button", name="NBR VAT", exact=True)).to_have_attribute("aria-pressed", "true")
            await expect(pg).to_have_url(re.compile(r"topic=nbrVat"))
            assert await main_.locator("ul a[href*='/help/']").count() == 15
            await expect(pg.get_by_role("heading", name="Start here")).to_have_count(0)
            ok("topic filter narrows to NBR VAT (15 articles) and is kept in the URL")
        except Exception as e: fail(1, e)

        # ── 2. Search ─────────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help", wait_until="networkidle")
            box = pg.get_by_role("searchbox", name="Search the knowledge base")
            await box.fill("vds certificate")
            await expect(pg).to_have_url(re.compile(r"q=vds"))
            status = pg.get_by_role("status").filter(has_text=re.compile(r"articles?$"))
            await expect(status).to_be_visible()
            first = pg.locator("main ul a[href*='/help/']").first
            await expect(first).to_have_attribute("href", re.compile(r"/help/vds-certificates$"))
            ok("search ranks the VDS article first for 'vds certificate' and keeps q in the URL")
            await pg.goto(BASE + "/en/help?q=zzqx", wait_until="networkidle")
            await expect(pg.get_by_text("No articles match “zzqx”.")).to_be_visible()
            await pg.get_by_role("button", name="Clear").click()
            await expect(pg.get_by_role("heading", name="Start here")).to_be_visible()
            ok("no-results state and Clear")
            await pg.goto(BASE + "/en/help?q=tr-6", wait_until="networkidle")
            await expect(pg.locator("main ul a[href*='/help/']").first).to_have_attribute("href", re.compile(r"/help/treasury-tr6$"))
            await pg.goto(BASE + "/bn/help?q=" + "ভিডিএস", wait_until="networkidle")
            await expect(pg.get_by_role("heading", name="নলেজ বেস", exact=True)).to_be_visible()
            assert await pg.locator("main ul a[href*='/help/vds-certificates']").count() == 1
            # Bangla digits match Latin digits and vice versa
            await pg.goto(BASE + "/bn/help?q=9.1", wait_until="networkidle")
            await expect(pg.locator("main ul a[href*='/help/vat-return-9-1']")).to_have_count(1)
            await pg.goto(BASE + "/en/help?q=" + "৬.৩", wait_until="networkidle")
            await expect(pg.locator("main ul a[href*='/help/sales-invoices']")).to_have_count(1)
            await settle(pg); await pg.screenshot(path=f"{OUT}/111_help_search.png")
            ok("Bangla search and script-insensitive digits (9.1 ↔ ৯.১, ৬.৩ ↔ 6.3)")
        except Exception as e: fail(2, e)

        # ── 3. Article page ───────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help/sales-invoices", wait_until="networkidle")
            await expect(pg.get_by_role("heading", level=1, name="Sales invoices and Mushak 6.3")).to_be_visible()
            art = pg.locator("article[data-kb-article='sales-invoices']")
            await expect(art).to_be_visible()
            toc = pg.get_by_role("navigation", name="On this page")
            n = await toc.get_by_role("link").count()
            assert n == await art.locator("h2[id^='sec-']").count() and n >= 5, n
            await toc.get_by_role("link", name="Correcting an invoice").click()
            await expect(pg).to_have_url(re.compile(r"#sec-\d+$"))
            await expect(art.get_by_role("heading", name="Correcting an invoice")).to_be_in_viewport()
            ok(f"article renders with a {n}-entry table of contents and working anchors")
            await expect(pg.get_by_role("region", name="Related articles").get_by_role("link", name="Credit notes (Mushak 6.7)")).to_be_visible()
            await expect(pg.locator("section[aria-labelledby='kb-screens']").get_by_role("link", name="Sales invoices")).to_have_attribute("href", re.compile(r"/en/sales$"))
            await expect(art.get_by_role("link", name="credit note").first).to_have_attribute("href", re.compile(r"/en/help/credit-notes$"))
            await expect(art.get_by_role("link", name="Customers").first).to_have_attribute("href", re.compile(r"/en/master/customers$"))
            assert await art.locator("kbd").count() >= 2
            assert "help:" not in await art.inner_html() and "*" not in await art.inner_text() and "{{" not in await art.inner_text()
            ok("related, screens covered, cross-article (help:) and in-app links resolve; inline markup rendered (no raw ** / {{ }})")
            await art.get_by_role("link", name="credit note").first.click()
            await expect(pg).to_have_url(re.compile(r"/en/help/credit-notes$"))
            await expect(pg.get_by_role("heading", level=1, name="Credit notes (Mushak 6.7)")).to_be_visible()
            await pg.get_by_role("link", name=re.compile("Previous")).click()
            await expect(pg).to_have_url(re.compile(r"/en/help/exports$"))
            await pg.get_by_role("navigation", name="Breadcrumb").get_by_role("link", name="Sales", exact=True).click()
            await expect(pg).to_have_url(re.compile(r"/en/help\?topic=sales$"))
            ok("help links navigate; prev/next and the topic breadcrumb work")
            await pg.goto(BASE + "/en/help/sales-invoices", wait_until="networkidle")
            await settle(pg); await pg.screenshot(path=f"{OUT}/112_help_article.png", full_page=True)
        except Exception as e: fail(3, e)

        # ── 4. Print / PDF ────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help/vat-return-9-1", wait_until="networkidle")
            before = await pg.evaluate("window.__kbPrints || 0")
            await pg.get_by_role("button", name="Print", exact=True).click()
            doc = await printed(pg, "Preparing and submitting the Mushak 9.1 return", before)
            assert "<h1" in doc and "Preparing and submitting the Mushak 9.1 return" in doc and "@page" in doc, doc[:300]
            assert "sidebar" not in doc.lower() and "help:" not in doc
            ok("Print opens the browser print dialog for a standalone A4 document (no app chrome)")
            before = await pg.evaluate("window.__kbPrints || 0")
            await pg.get_by_role("button", name="PDF", exact=True).click()
            await printed(pg, "Preparing and submitting the Mushak 9.1 return", before)
            await expect(pg.get_by_text("Save as PDF").first).to_be_visible()
            ok("PDF uses the same print document with a 'Save as PDF' hint")
        except Exception as e: fail(4, e)

        # ── 5. Share ──────────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help/vds-certificates", wait_until="networkidle")
            await pg.get_by_role("button", name="Share").click()
            await expect(pg.get_by_role("menuitem", name="Email")).to_be_visible()
            await expect(pg.get_by_role("menuitem", name="WhatsApp")).to_be_visible()
            await pg.get_by_role("menuitem", name="Copy link").click()
            await expect(pg.get_by_text("Link copied to clipboard")).to_be_visible()
            clip = await pg.evaluate("navigator.clipboard.readText()")
            assert clip == BASE + "/en/help/vds-certificates", clip
            ok("Share → Copy link puts the article's absolute URL on the clipboard (email and WhatsApp offered)")
        except Exception as e: fail(5, e)

        # ── 6. Downloads — one article ────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help/sales-invoices", wait_until="networkidle")
            menu = lambda: pg.get_by_role("button", name="Download").click()
            name, html = await download(pg, menu, "Web page (.html)")
            assert name == "DiziVAT-sales-invoices-en.html", name
            assert html.lstrip().lower().startswith("<!doctype html") and 'lang="en"' in html and "<title>Sales invoices and Mushak 6.3 · DiziVAT</title>" in html
            assert f'href="{BASE}/en/help/credit-notes"' in html and f'href="{BASE}/en/sales"' in html, "absolute links"
            assert "help:" not in html and "{{" not in html and "<script" not in html.lower()
            ok("HTML download: standalone, titled, absolute links back to the app, no scripts")
            name, md = await download(pg, menu, "Markdown (.md)")
            assert name == "DiziVAT-sales-invoices-en.md", name
            assert md.startswith("# Sales invoices and Mushak 6.3"), md[:80]
            assert "## Create an invoice" in md and "1. " in md and "| Figure | Formula |" in md
            assert f"]({BASE}/en/help/credit-notes)" in md and "help:" not in md and "{{" not in md
            ok("Markdown download: headings, numbered steps, tables and absolute links")
        except Exception as e: fail(6, e)

        # ── 7. Full manual ────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/en/help", wait_until="networkidle")
            menu = lambda: pg.get_by_role("button", name="Full manual", exact=True).click()
            name, md = await download(pg, menu, "Full manual (.md)")
            assert name == "DiziVAT-User-Guide-en.md", name
            assert md.startswith("# DiziVAT user guide"), md[:60]
            assert md.count("\n## ") >= N_ARTICLES, md.count("\n## ")
            for t in ("Welcome to DiziVAT", "Sales invoices and Mushak 6.3", "Preparing and submitting the Mushak 9.1 return", "Frequently asked questions"):
                assert t in md, t
            name, html = await download(pg, menu, "Full manual (.html)")
            assert name == "DiziVAT-User-Guide-en.html", name
            for s in ("sales-invoices", "vat-return-9-1", "faq"):
                assert f'id="{s}"' in html, s
            assert 'href="#credit-notes"' in html, "in-document links"
            ok(f"full manual downloads as Markdown ({len(md)//1024} KB) and HTML with contents and in-document links")
            before = await pg.evaluate("window.__kbPrints || 0")
            await pg.get_by_role("button", name="Print full manual").click()
            doc = await printed(pg, "DiziVAT user guide", before)
            assert all(f'id="{s}"' in doc for s in ("welcome", "sales-invoices", "faq")), "all articles in the print document"
            ok("Print full manual prints all articles in one document")
        except Exception as e: fail(7, e)

        # ── 8. Help menu, sidebar, palette, shortcuts ─────────────────
        try:
            await pg.goto(BASE + "/en/vat/tr-6", wait_until="networkidle")
            await pg.get_by_role("button", name="Help", exact=True).click()
            await expect(pg.get_by_role("menuitem", name="Knowledge base")).to_be_visible()
            await settle(pg); await pg.screenshot(path=f"{OUT}/113_help_menu.png")
            await pg.get_by_role("menuitem", name="Help for this page").click()
            await expect(pg).to_have_url(re.compile(r"/en/help/treasury-tr6$"))
            await expect(pg.get_by_role("heading", level=1, name="Treasury deposits (TR-6)")).to_be_visible()
            ok("top-bar Help → Help for this page opens the article for the current screen")
            await pg.goto(BASE + "/en/sales/credit-notes", wait_until="networkidle")
            await pg.get_by_role("button", name="Help", exact=True).click()
            await pg.get_by_role("menuitem", name="Help for this page").click()
            await expect(pg).to_have_url(re.compile(r"/en/help/credit-notes$"))
            await pg.get_by_role("button", name="Help", exact=True).click()
            await pg.get_by_role("menuitem", name="Keyboard shortcuts").click()
            await expect(pg.get_by_role("dialog", name="Keyboard shortcuts")).to_be_visible()
            await pg.keyboard.press("Escape")
            ok("longest-route match (/sales/credit-notes → credit notes) and Keyboard shortcuts from the menu")
            await pg.goto(BASE + "/en", wait_until="networkidle")
            await pg.get_by_role("link", name="Help & documentation").click()
            await expect(pg).to_have_url(re.compile(r"/en/help$"))
            await pg.goto(BASE + "/en/purchases", wait_until="networkidle")
            await pg.keyboard.press("Control+k")
            await pg.get_by_role("combobox").fill("knowledge")
            await pg.keyboard.press("Enter")
            await expect(pg).to_have_url(re.compile(r"/en/help$"))
            ok("sidebar Help link and command palette entry open the help centre")
        except Exception as e: fail(8, e)

        # ── 9. Bangla ─────────────────────────────────────────────────
        try:
            await pg.goto(BASE + "/bn/help/vat-return-9-1", wait_until="networkidle")
            await expect(pg.get_by_role("heading", level=1, name="মূসক ৯.১ রিটার্ন প্রস্তুত ও দাখিল")).to_be_visible()
            await expect(pg.get_by_role("navigation", name="এই পাতায়")).to_be_visible()
            body = await pg.locator("article").inner_text()
            assert "রিটার্ন শুরু করুন" in body and "How the return is built" not in body
            assert await pg.evaluate("document.documentElement.lang") == "bn"
            await settle(pg); await pg.screenshot(path=f"{OUT}/114_help_article_bn.png")
            ok("Bangla article with Bangla UI labels and TOC")
            menu = lambda: pg.get_by_role("button", name="ডাউনলোড").click()
            name, md = await download(pg, menu, "মার্কডাউন (.md)")
            assert name == "DiziVAT-vat-return-9-1-bn.md", name
            assert md.startswith("# মূসক ৯.১ রিটার্ন প্রস্তুত ও দাখিল") and f"{BASE}/bn/help/" in md
            before = await pg.evaluate("window.__kbPrints || 0")
            await pg.get_by_role("button", name="প্রিন্ট", exact=True).click()
            doc = await printed(pg, "মূসক ৯.১ রিটার্ন প্রস্তুত ও দাখিল", before)
            assert 'lang="bn"' in doc and "Noto Sans Bengali" in doc
            await pg.goto(BASE + "/bn/help", wait_until="networkidle")
            name, html = await download(pg, lambda: pg.get_by_role("button", name="সম্পূর্ণ ম্যানুয়াল", exact=True).click(), "সম্পূর্ণ ম্যানুয়াল (.html)")
            assert name == "DiziVAT-User-Guide-bn.html" and "DiziVAT ব্যবহার নির্দেশিকা" in html
            ok("Bangla downloads (article .md, manual .html) and print with a Bengali font stack")
        except Exception as e: fail(9, e)

        # ── 10. Every article, both languages; 404; roles ─────────────
        try:
            slugs = sorted({h.rsplit("/", 1)[1] for h in hrefs})
            assert len(slugs) == N_ARTICLES
            for loc in ("en", "bn"):
                for s in slugs:
                    r = await appr.request.get(f"{BASE}/{loc}/help/{s}")
                    t = await r.text()
                    assert r.status == 200 and f'data-kb-article="{s}"' in t, (loc, s, r.status)
            ok(f"all {N_ARTICLES} articles render in English and Bangla ({2 * N_ARTICLES} pages)")
            r = await appr.request.get(BASE + "/en/help/no-such-article")
            assert r.status == 404, r.status
            ok("unknown article → 404")
            for u in ("kamal", "auditor"):
                ctx = await login_ctx(b, u, viewport=VP)
                vp = await ctx.new_page(); watch(vp, errs)
                await vp.goto(BASE + "/en/help/users-and-roles", wait_until="networkidle")
                await expect(vp.get_by_role("heading", level=1, name="Managing users (administrators)")).to_be_visible()
                await expect(vp.get_by_role("button", name="Download")).to_be_enabled()
                await ctx.close()
            ok("operators and viewers can read and download every article")
        except Exception as e: fail(10, e)

        real = [e for e in errs if "418" not in e and "Failed to load resource" not in e]
        if real: failures.append(f"console errors: {real[:5]}")
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
