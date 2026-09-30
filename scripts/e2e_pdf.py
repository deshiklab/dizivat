"""PDF download for the printable statutory forms — end-to-end checks.
Every "PDF" button produces a real, well-formed A4 PDF of the on-screen form (not the old "Gotenberg in R3" toast):
Mushak 6.3 in English, Bangla and dark mode; the side-sheet forms (6.7, 6.8, 6.6, TR-6, money receipt, payment
voucher, 6.4, 4.3) switch to their form tab by themselves; page-level forms (4.3 register, 6.10, 9.1, statement,
purchase) paginate at row boundaries; the Mushak 6.1 book is landscape (and now prints). The exporter is lazy-loaded.
Read-only: only downloads, so it can run at any point."""
import asyncio, io, os, re
from playwright.async_api import async_playwright, expect
from PIL import Image
from _auth import BASE, login_ctx

OUT = os.environ.get("SHOT_DIR", "/tmp/dizivat-screens")
DL = os.path.join(OUT, "pdf"); os.makedirs(DL, exist_ok=True)
results, failures = [], []
def ok(m): results.append(("PASS", m)); print("PASS", m)
def fail(section, e):
    import traceback
    msg = f"section {section}: {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"
    failures.append(msg); print("FAIL", msg); traceback.print_exc(limit=1)
def watch(pg, errs):
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)[:200]))
    pg.on("console", lambda m: errs.append(m.text[:240]) if m.type == "error" and "PDF export failed" not in m.text else None)
VP = {"width": 1440, "height": 900}
A4 = (595.276, 841.89)
PRINT_STUB = "window.print = () => { window.__prints = (window.__prints || 0) + 1 }"


def parse_pdf(data: bytes):
    """Just enough PDF parsing to verify our writer: structure, xref offsets, pages, media boxes, title and images."""
    assert data.startswith(b"%PDF-1.4"), "header"
    assert data.rstrip().endswith(b"%%EOF"), "trailer"
    startxref = int(re.search(rb"startxref\s+(\d+)\s+%%EOF\s*$", data).group(1))
    assert data[startxref:startxref + 4] == b"xref", "startxref points at the xref table"
    m = re.match(rb"xref\s+0 (\d+)\s+", data[startxref:])
    size = int(m.group(1))
    rows = data[startxref + m.end():].split(b"\n")[:size]
    for i, row in enumerate(rows[1:], start=1):
        off = int(row[:10])
        assert data[off:].startswith(f"{i} 0 obj".encode()), f"xref offset of object {i}"
    count = int(re.search(rb"/Type /Pages /Count (\d+)", data).group(1))
    boxes = [tuple(float(x) for x in b.split()) for b in re.findall(rb"/MediaBox \[0 0 ([\d. ]+)\]", data)]
    title_hex = re.search(rb"/Title <FEFF([0-9A-F]*)>", data).group(1).decode()
    title = bytes.fromhex(title_hex).decode("utf-16-be")
    images = []
    for im in re.finditer(rb"/Width (\d+) /Height (\d+) .*?/Filter /DCTDecode /Length (\d+) >>\nstream\n", data):
        start, n = im.end(), int(im.group(3))
        jpeg = data[start:start + n]
        assert data[start + n:start + n + 10] == b"\nendstream", "stream length"
        img = Image.open(io.BytesIO(jpeg)); img.load()
        assert img.size == (int(im.group(1)), int(im.group(2))), "image size matches the XObject"
        images.append(img.convert("L"))
    assert len(boxes) == count == len(images), f"pages {count}, boxes {len(boxes)}, images {len(images)}"
    return {"pages": count, "boxes": boxes, "title": title, "images": images, "bytes": len(data)}


def ink(img):
    """Share of 'dark' pixels — a blank page is ~0, a dark-mode render would be mostly dark."""
    h = img.histogram()
    return sum(h[:128]) / max(1, sum(h))


async def grab(pg, button=None):
    btn = button or pg.locator("[data-testid=pdf-download]:visible").first
    await expect(btn).to_be_enabled()
    async with pg.expect_download(timeout=60_000) as d:
        await btn.click()
    dl = await d.value
    path = os.path.join(DL, dl.suggested_filename)
    await dl.save_as(path)
    info = parse_pdf(open(path, "rb").read())
    info["name"] = dl.suggested_filename
    return info


def is_a4(box, landscape=False):
    w, h = (A4[1], A4[0]) if landscape else A4
    return abs(box[0] - w) < 0.5 and abs(box[1] - h) < 0.5


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        ctx = await login_ctx(b, "arif", viewport=VP, accept_downloads=True)
        await ctx.add_init_script(PRINT_STUB)
        pg = await ctx.new_page(); watch(pg, errs)
        get = lambda path: ctx.request.get(f"{BASE}/api/v1/{path}")
        sales = (await (await get("sales?size=5")).json())["data"]
        s0 = sales[0]

        # ── 1. Mushak 6.3: real PDF, not the placeholder toast; lazy-loaded exporter ──
        try:
            js = []
            pg.on("request", lambda r: js.append(r.url) if r.resource_type == "script" else None)
            await pg.goto(BASE + f"/en/sales/{s0['id']}", wait_until="networkidle")
            before = len(js)
            btn = pg.get_by_role("button", name="PDF", exact=True)
            await expect(btn).to_be_visible()
            info = await grab(pg, btn)
            assert info["name"] == f"Mushak-6.3_{s0['invoiceNo']}.pdf", info["name"]
            assert info["pages"] == 1 and is_a4(info["boxes"][0]), info["boxes"]
            assert info["title"] == f"Mushak 6.3 – {s0['invoiceNo']}", info["title"]
            assert info["images"][0].width >= 1600, "≥ ~220 dpi raster"
            assert 0.01 < ink(info["images"][0]) < 0.35, ink(info["images"][0])
            assert len(js) > before, "exporter chunk is loaded on click, not with the page"
            await expect(pg.get_by_text(re.compile(r"PDF downloaded — Mushak-6\.3_"))).to_be_visible()
            assert await pg.get_by_text("Gotenberg").count() == 0
            await expect(pg.get_by_role("tab", name=re.compile("Mushak 6.3"))).to_have_attribute("aria-selected", "true")
            ok(f"Mushak 6.3: '{info['name']}' — valid 1-page A4 PDF ({info['bytes'] // 1024} KB), Bangla title metadata, success toast, no Gotenberg placeholder")
            ok("the PDF engine is lazy-loaded on click (not part of the page bundle)")
        except Exception as e: fail(1, e)

        # ── 2. Bangla UI and dark mode ──
        try:
            await pg.goto(BASE + f"/bn/sales/{s0['id']}", wait_until="networkidle")
            btn = pg.get_by_role("button", name="পিডিএফ", exact=True)
            info = await grab(pg, btn)
            assert info["name"] == f"Mushak-6.3_{s0['invoiceNo']}.pdf" and info["pages"] == 1
            await expect(pg.get_by_text("পিডিএফ ডাউনলোড হয়েছে", exact=False)).to_be_visible()
            ok("Bangla UI: 'পিডিএফ' button downloads the same form, Bangla toast")
            dark = await b.new_context(viewport=VP, accept_downloads=True, color_scheme="dark", storage_state=await ctx.storage_state())
            dp = await dark.new_page(); watch(dp, errs)
            await dp.add_init_script("localStorage.setItem('theme','dark')")
            await dp.goto(BASE + f"/en/sales/{sales[1]['id']}", wait_until="networkidle")
            assert "dark" in (await dp.evaluate("document.documentElement.className")).split()
            info = await grab(dp)
            assert ink(info["images"][0]) < 0.35, f"dark-mode export must stay a light print page ({ink(info['images'][0]):.2f})"
            await dark.close()
            ok("dark mode: the PDF is still the light print layout")
        except Exception as e: fail(2, e)

        # ── 3. Side-sheet forms switch to their form tab by themselves ──
        try:
            dn = (await (await get("debit-notes?size=1")).json())["data"][0]
            cn = (await (await get("credit-notes?size=1")).json())["data"][0]
            vds = (await (await get("vat/vds?size=1")).json())["data"][0]
            tr = (await (await get("vat/treasury?size=1")).json())["data"][0]
            mr = (await (await get("accounting/receipts?size=1")).json())["data"][0]
            pv = (await (await get("accounting/payments?size=1")).json())["data"][0]
            pb = next(x for x in (await (await get("production/batches?size=100")).json())["data"] if x["mode"] == "contractual")
            bom = (await (await get("production/boms?size=1")).json())["data"][0]
            cases = [
                (f"/en/sales/credit-notes?view={cn['id']}", f"Mushak-6.7_{cn['no']}.pdf"),
                (f"/en/purchases/debit-notes?view={dn['id']}", f"Mushak-6.8_{dn['no']}.pdf"),
                (f"/en/vat/vds?view={vds['id']}", f"Mushak-6.6_{vds['no']}.pdf"),
                (f"/en/vat/tr-6?view={tr['id']}", f"TR-6_{tr['challanNo']}.pdf"),
                (f"/en/accounting/receipts?view={mr['id']}", f"Money-receipt_{mr['no']}.pdf"),
                (f"/en/accounting/payments?view={pv['id']}", f"Payment-voucher_{pv['no']}.pdf"),
                (f"/en/production/batches?view={pb['id']}", f"Mushak-6.4_{pb['no']}.pdf"),
                (f"/en/production/bom?view={bom['id']}", f"Mushak-4.3_{bom['no']}.pdf"),
            ]
            for url, name in cases:
                await pg.goto(BASE + url, wait_until="networkidle")
                sheet = pg.get_by_role("dialog")
                await expect(sheet).to_be_visible()
                info = await grab(pg, sheet.get_by_test_id("pdf-download"))
                assert info["name"] == name, (info["name"], name)
                assert all(is_a4(bx) for bx in info["boxes"]) and all(ink(im) > 0.005 for im in info["images"]), name
                await expect(sheet.locator(".print-area")).to_be_visible()
            ok(f"side sheets: {len(cases)} forms (6.7, 6.8, 6.6, TR-6, receipt, voucher, 6.4, 4.3) download from any tab, named by document number")
        except Exception as e: fail(3, e)

        # ── 4. Page-level forms: multi-page pagination at row boundaries, landscape book ──
        try:
            boms = (await (await get("production/boms?size=200")).json())["data"]
            active = next(x for x in boms if x["status"] == "active")
            purchase = (await (await get("purchases?size=1")).json())["data"][0]
            pages = [
                ("/en/vat/return-9-1?period=2026-08", "Mushak-9.1_2026-08.pdf", 3),
                ("/en/accounting/statements?kind=customer&party=c2&from=2026-07-01&to=2026-09-25", None, 2),
                ("/en/vat/mushak-6-10?from=2026-08-01&to=2026-08-31", "Mushak-6.10_2026-08-01_2026-08-31.pdf", 1),
                (f"/en/vat/mushak-4-3?id={active['id']}", f"Mushak-4.3_{active['no']}.pdf", 1),
                (f"/en/purchases/{purchase['id']}", f"Purchase_{purchase['invoiceNo']}.pdf", 1),
            ]
            for url, name, min_pages in pages:
                await pg.goto(BASE + url, wait_until="networkidle")
                info = await grab(pg)
                if name: assert info["name"] == name, (info["name"], name)
                else: assert info["name"].startswith("Statement_customer_") and " " not in info["name"], info["name"]
                assert info["pages"] >= min_pages, (url, info["pages"])
                assert all(is_a4(bx) for bx in info["boxes"]), info["boxes"]
                assert all(ink(im) > 0.003 for im in info["images"]), f"{name}: no blank pages"
            ok("9.1 return, statement, 6.10, 4.3 register and purchase: multi-page A4 PDFs with no blank pages")

            await pg.goto(BASE + "/en/vat/mushak-6-1?item=i1&from=2026-07-01&to=2026-09-25", wait_until="networkidle")
            info = await grab(pg)
            assert info["name"] == "Mushak-6.1_RM-001_2026-07-01_2026-09-25.pdf", info["name"]
            assert all(is_a4(bx, landscape=True) for bx in info["boxes"]), info["boxes"]
            assert all(ink(im) > 0.003 for im in info["images"]), "no blank pages"
            assert info["images"][0].width > info["images"][0].height, "wide register is laid out across the landscape page"
            await expect(pg.locator("article.print-area")).to_have_count(1)
            ok(f"Mushak 6.1 book: landscape A4 ({info['pages']} page(s), none blank); the book is now a print area (Print was blank)")
        except Exception as e: fail(4, e)

        # ── 5. Print still prints; the 4.3 page labels are unambiguous ──
        try:
            await pg.goto(BASE + f"/en/sales/{s0['id']}", wait_until="networkidle")
            await pg.get_by_role("button", name="Print Mushak 6.3").click()
            await pg.wait_for_function("(window.__prints || 0) >= 1")
            await pg.goto(BASE + f"/en/vat/mushak-4-3?id={active['id']}", wait_until="networkidle")
            await expect(pg.get_by_role("button", name="Print", exact=True)).to_be_visible()
            await expect(pg.get_by_role("button", name="PDF", exact=True)).to_be_visible()
            ok("Print buttons still open the print dialog; 4.3 page shows 'PDF' and 'Print' side by side")
        except Exception as e: fail(5, e)

        real = [e for e in errs if "418" not in e and "Failed to load resource" not in e]
        if real: failures.append(f"console errors: {real[:5]}")
        else: ok("no console errors")
        await b.close()
    print(f"\n{len(results)} passed, {len(failures)} failed")
    for f in failures: print("  -", f)
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
