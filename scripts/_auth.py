"""Shared Playwright helper: a browser context already signed in as a demo user (via the API, sets the httpOnly cookie)."""
BASE = __import__("os").environ.get("BASE_URL", "http://localhost:3000")
PASSWORD = "demo1234"

async def login_ctx(browser, user="arif", **ctx_kwargs):
    ctx = await browser.new_context(**ctx_kwargs)
    r = await ctx.request.post(f"{BASE}/api/v1/auth/login", data={"username": user, "password": PASSWORD, "remember": True})
    assert r.ok, f"login {user} failed: {r.status}"
    return ctx
