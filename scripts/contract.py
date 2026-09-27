"""API contract tests — one ENDPOINTS table drives auth (401/403), shape (Page<T>), content-type (problem+json)
and error-code checks. `python3 contract.py --doc` also writes docs/API.md from the same table, so the
reference Symfony implements (R1+) can never drift from what the frontend is tested against.
Non-destructive: only reads, and writes that are rejected (401/403/404/409/422)."""
import os, random, sys, requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000") + "/api/v1"
PW = "demo1234"
# Who lacks each permission (used for the 403 check)
LACKS = {"doc.create": "auditor", "doc.edit": "auditor", "doc.delete": "auditor", "doc.approve": "rafiqul", "doc.cancel": "rafiqul",
         "master.edit": "rafiqul", "users.manage": "chanchal", "settings.manage": "chanchal", "audit.view": "rafiqul", "export": None}
# Who has it (used for the success/shape checks)
HAS = {"users.manage": "admin", "settings.manage": "admin", "audit.view": "chanchal"}

E = lambda m, p, perm, desc, page=False, csv=False, public=False: dict(m=m, p=p, perm=perm, desc=desc, page=page, csv=csv, public=public)
ENDPOINTS = [
    E("POST", "/auth/login", None, "Sign in {username, password, remember} → Me + httpOnly cookie. 401 attempts left, 403 disabled, 429 locked", public=True),
    E("POST", "/auth/logout", None, "Sign out (clears cookie)", public=True),
    E("GET", "/me", None, "Current user, permissions, preferences, company summary"),
    E("PUT", "/me/preferences", None, "Save UI preferences (theme, density, text size, accent)"),
    E("GET", "/me/views?table=sales", None, "Saved list views for a table"),
    E("POST", "/me/views", None, "Save a list view {table, name, query}"),
    E("DELETE", "/me/views?table=sales&name=x", None, "Delete a saved view"),
    E("PUT", "/me/password", None, "Change own password {current, next, confirm}; other sessions revoked"),
    E("GET", "/dashboard", None, "KPIs, charts, deadlines, low stock for the current VAT period"),
    E("GET", "/search?q=pul", None, "Global search (invoices, parties, items)"),
    E("GET", "/notifications", None, "Notifications for the current user {items, unread}"),
    E("POST", "/notifications/read", None, "Mark read {ids} | {all: true}"),
    E("GET", "/sales", None, "Sales invoices — Page<Sale> with facets/totals", page=True, csv=True),
    E("POST", "/sales", "doc.create", "Create invoice (process=Approved also needs doc.approve; stock checked)"),
    E("GET", "/sales/{sale}", None, "One invoice with history"),
    E("PUT", "/sales/{sale}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/sales/{sale}", None, "Approve {process:Approved} (doc.approve) or cancel {process:Cancelled, reason≥10} (doc.cancel)"),
    E("DELETE", "/sales/{sale}", "doc.delete", "Delete a draft → trash (409 if not a draft)"),
    E("POST", "/sales/{sale}/restore", "doc.delete", "Restore from trash"),
    E("POST", "/sales/bulk", "doc.approve", "Bulk approve {ids, action:approve} → {done, skipped}"),
    E("GET", "/purchases", None, "Purchases — Page<Purchase>", page=True, csv=True),
    E("POST", "/purchases", "doc.create", "Create purchase"),
    E("GET", "/purchases/{purchase}", None, "One purchase with history"),
    E("PUT", "/purchases/{purchase}", "doc.edit", "Replace a draft"),
    E("PATCH", "/purchases/{purchase}", None, "Approve / cancel (reverses stock; 409 if consumed)"),
    E("DELETE", "/purchases/{purchase}", "doc.delete", "Delete a draft → trash"),
    E("POST", "/purchases/{purchase}/restore", "doc.delete", "Restore from trash"),
    E("POST", "/purchases/bulk", "doc.approve", "Bulk approve"),
    E("GET", "/items", None, "Items with stock — Page<ItemWithStock>", page=True, csv=True),
    E("POST", "/items", "master.edit", "Create item (SKU unique)"),
    E("GET", "/items/{item}", None, "One item with stock"),
    E("PUT", "/items/{item}", "master.edit", "Update item"),
    E("GET", "/items/{item}/ledger", None, "Stock ledger (opening, movements, balance)"),
    E("GET", "/customers?view=table", None, "Customers — Page<PartyRow>", page=True, csv=True),
    E("POST", "/customers", "master.edit", "Create customer (422 duplicate/customerMode)"),
    E("GET", "/customers/c1", None, "One customer with aggregates"),
    E("PUT", "/customers/c1", "master.edit", "Update customer (422 modeLocked when it has documents)"),
    E("DELETE", "/customers/c1", "master.edit", "Delete → trash (409 in-use:N when it has documents)"),
    E("POST", "/customers/c1/restore", "master.edit", "Restore from trash"),
    E("GET", "/vendors?view=table", None, "Vendors — Page<PartyRow>", page=True, csv=True),
    E("POST", "/vendors", "master.edit", "Create vendor"),
    E("GET", "/vendors/v1", None, "One vendor"),
    E("PUT", "/vendors/v1", "master.edit", "Update vendor"),
    E("DELETE", "/vendors/v1", "master.edit", "Delete → trash (409 when in use)"),
    E("POST", "/vendors/v1/restore", "master.edit", "Restore from trash"),
    E("GET", "/users", "users.manage", "Users — Page<User>, facets role/status", page=True, csv=True),
    E("POST", "/users", "users.manage", "Invite {username,…,role} → {user, tempPassword} (shown once)"),
    E("GET", "/users/u3", "users.manage", "One user"),
    E("PUT", "/users/u3", "users.manage", "Update profile/role/active (422 self, lastAdmin; deactivation revokes sessions)"),
    E("POST", "/users/u3/reset-password", "users.manage", "New one-time password; forces change; revokes sessions"),
    E("GET", "/company", None, "Company profile"),
    E("PUT", "/company", "settings.manage", "Update company profile (BIN/TIN/NID validated)"),
    E("GET", "/tariff?view=table", None, "NBR tariff — Page<TariffLine>; ?hs=12345678 → one line or 404", page=True, csv=True),
    E("GET", "/audit", "audit.view", "Audit trail — Page<AuditEvent>; filters q/from/to/entity/action/actor/entityId", page=True, csv=True),
]

sessions = {}
def S(user):
    if user is None: return requests.Session()
    if user not in sessions:
        s = requests.Session(); r = s.post(BASE + "/auth/login", json={"username": user, "password": PW})
        assert r.ok, f"login {user}: {r.status_code}"; sessions[user] = s
    return sessions[user]

fails, passes = [], 0
def check(cond, msg):
    global passes
    if cond: passes += 1
    else: fails.append(msg); print("FAIL", msg)
def is_problem(r): return r.headers.get("content-type", "").startswith("application/problem+json") and "title" in r.json()

def fixtures():
    s = S("chanchal")
    sale = s.get(BASE + "/sales?process=Approved&size=1").json()["data"][0]["id"]
    purchase = s.get(BASE + "/purchases?process=Approved&size=1").json()["data"][0]["id"]
    return {"sale": sale, "purchase": purchase, "item": "i1"}

def run():
    fx = fixtures()
    for e in ENDPOINTS:
        path = e["p"].format(**fx); url = BASE + path; m = e["m"]
        # 401 for anonymous
        if not e["public"]:
            r = requests.request(m, url, json={})
            check(r.status_code == 401 and is_problem(r), f"{m} {path} anonymous → {r.status_code} (want 401 problem+json)")
        # 403 for a role without the permission
        if e["perm"] and LACKS.get(e["perm"]):
            r = S(LACKS[e["perm"]]).request(m, url, json={})
            check(r.status_code == 403 and is_problem(r) and e["perm"] in r.json()["title"], f"{m} {path} as {LACKS[e['perm']]} → {r.status_code} (want 403 naming {e['perm']})")
        # shape for readable endpoints
        if m == "GET":
            r = S(HAS.get(e["perm"], "chanchal")).get(url)
            check(r.status_code == 200 and r.headers["content-type"].startswith("application/json"), f"GET {path} → {r.status_code}")
            if e["page"] and r.ok:
                d = r.json()
                check(all(k in d for k in ("data", "total", "page", "size", "facets")) and isinstance(d["data"], list), f"GET {path} is not a Page")
            if e["csv"]:
                sep = "&" if "?" in path else "?"
                r = S(HAS.get(e["perm"], "chanchal")).get(url + sep + "format=csv")
                check(r.ok and r.headers["content-type"].startswith("text/csv"), f"GET {path} CSV → {r.status_code} {r.headers.get('content-type')}")

    # Specific error contracts: (user, method, path, body, status, error-key or None)
    rnd = f"nobody{random.randint(1000, 9999)}"
    cases = [
        (None, "POST", "/auth/login", {}, 422, "username"),
        (None, "POST", "/auth/login", {"username": rnd, "password": "x"}, 401, "_"),
        ("chanchal", "GET", "/sales/nope", None, 404, None),
        ("chanchal", "GET", "/purchases/nope", None, 404, None),
        ("chanchal", "GET", "/items/nope", None, 404, None),
        ("chanchal", "POST", "/sales", {}, 422, "customerId"),
        ("chanchal", "POST", "/purchases", {}, 422, "vendorId"),
        ("chanchal", "PUT", f"/sales/{fx['sale']}", {}, 409, None),
        ("chanchal", "DELETE", f"/sales/{fx['sale']}", None, 409, None),
        ("chanchal", "PATCH", f"/sales/{fx['sale']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("chanchal", "POST", "/items", {}, 422, "name"),
        ("chanchal", "POST", "/customers", {}, 422, "name"),
        ("chanchal", "DELETE", "/customers/c1", None, 409, None),
        ("chanchal", "GET", "/tariff?hs=99999999", None, 404, None),
        ("chanchal", "POST", "/notifications/read", {}, 422, None),
        ("chanchal", "PUT", "/me/password", {"current": "wrong-one", "next": "abcd12345", "confirm": "abcd12345"}, 422, "current"),
        ("chanchal", "PUT", "/me/password", {"current": PW, "next": "short", "confirm": "short"}, 422, "next"),
        ("admin", "GET", "/users/nope", None, 404, None),
        ("admin", "POST", "/users", {}, 422, "username"),
        ("admin", "POST", "/users", {"username": "chanchal", "name": "Dup User", "designation": "Tester", "email": "x@y.co", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "username"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@pulindustries.com.bd", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "role"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@pulindustries.com.bd", "mobile": "", "department": "", "role": "admin", "active": False}, 422, "active"),
        ("admin", "POST", "/users/u5/reset-password", None, 422, None),
        ("admin", "PUT", "/company", {}, 422, "name"),
    ]
    for user, m, path, body, status, key in cases:
        r = S(user).request(m, BASE + path, json=body)
        good = r.status_code == status and is_problem(r) and (key is None or key in (r.json().get("errors") or {}))
        check(good, f"{m} {path} as {user} → {r.status_code} {r.text[:120]} (want {status}{' errors.' + key if key else ''})")

def write_doc():
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "API.md"); os.makedirs(os.path.dirname(out), exist_ok=True)
    lines = ["# RBS VAT — API contract (v1)", "",
             "Generated by `scripts/contract.py --doc` from the table the contract tests run against. Base path `/api/v1`.", "",
             "**Conventions** — JSON bodies; session cookie `rbs_session` (httpOnly). Errors are RFC 9457 `application/problem+json` "
             "`{type, title, status, errors?: {field: [code]}}`. 401 = no/expired session, 403 = role lacks the permission (title names it), "
             "404 unknown id, 409 state conflict, 422 validation (field → codes), 429 sign-in locked. "
             "Lists accept `page, size, sort=field.asc|desc, q, from, to` and facet params (comma-separated) and return "
             "`Page<T> = {data, total, page, size, totals, facets}`; add `format=csv` for an export.", "",
             "| Method | Path | Permission | Description |", "|---|---|---|---|"]
    for e in ENDPOINTS:
        perm = "public" if e["public"] else (f"`{e['perm']}`" if e["perm"] else "signed in")
        extra = " · CSV" if e["csv"] else ""
        desc = e['desc'].replace('|', chr(92) + '|')  # escape pipes inside table cells
        lines.append(f"| {e['m']} | `{e['p'].replace('{', ':').replace('}', '')}` | {perm} | {desc}{extra} |")
    lines += ["", "## Roles", "", "| Permission | admin | approver | operator | viewer |", "|---|---|---|---|---|"]
    roles = {"admin": set(LACKS), "approver": set(LACKS) - {"users.manage", "settings.manage"},
             "operator": {"doc.create", "doc.edit", "doc.delete", "export"}, "viewer": {"audit.view", "export"}}
    for p_ in LACKS: lines.append(f"| `{p_}` | " + " | ".join("✓" if p_ in roles[r] else "—" for r in roles) + " |")
    open(out, "w").write("\n".join(lines) + "\n"); print("wrote", os.path.normpath(out))

if __name__ == "__main__":
    run()
    if "--doc" in sys.argv: write_doc()
    print(f"\ncontract: {passes} checks passed, {len(fails)} failed over {len(ENDPOINTS)} endpoints")
    if fails: sys.exit(1)
