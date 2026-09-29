"""API contract tests — one ENDPOINTS table drives auth (401/403), shape (Page<T>), content-type (problem+json)
and error-code checks. `python3 contract.py --doc` also writes docs/API.md from the same table, so the
reference Symfony implements (R1+) can never drift from what the frontend is tested against.
Non-destructive: only reads, and writes that are rejected (401/403/404/409/422)."""
import os, random, sys, requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000") + "/api/v1"
PW = "demo1234"
# Who lacks each permission (used for the 403 check)
LACKS = {"doc.create": "auditor", "doc.edit": "auditor", "doc.delete": "auditor", "doc.approve": "kamal", "doc.cancel": "kamal",
         "master.edit": "kamal", "users.manage": "arif", "settings.manage": "arif", "audit.view": "kamal", "export": None}
# Who has it (used for the success/shape checks)
HAS = {"users.manage": "admin", "settings.manage": "admin", "audit.view": "arif"}

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
    E("GET", "/search?q=bay", None, "Global search (invoices, parties, items)"),
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
    E("GET", "/items/{item}/ledger", None, "Stock ledger (opening, movements, balance); ?branch=b1 → one branch incl. transfers in/out"),
    E("GET", "/stock", None, "Stock by branch — Page<StockRow> (+ branches, branchValue); ?branch= holds stock there", page=True, csv=True),
    E("GET", "/transfers", None, "Stock transfers (Mushak 6.5) — Page<Transfer>; facets process/fromBranch/toBranch", page=True, csv=True),
    E("POST", "/transfers", "doc.create", "Create transfer {fromBranchId, toBranchId, date, vehicle?, note?, lines[{itemId, qty}], process} (422 sameBranch/unknownBranch; approve checks source stock)"),
    E("GET", "/transfers/{transfer}", None, "One transfer with history"),
    E("PUT", "/transfers/{transfer}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/transfers/{transfer}", None, "Approve (doc.approve; moves stock) or cancel {reason≥10} (doc.cancel; 409 if goods already used at destination)"),
    E("DELETE", "/transfers/{transfer}", "doc.delete", "Delete a draft (409 if not a draft)"),
    E("GET", "/damage", None, "Damage & wastage — Page<Damage>; facets process/branch/reason", page=True, csv=True),
    E("POST", "/damage", "doc.create", "Create damage entry {branchId, date, reason, note (≥10 when lost), lines, process}"),
    E("GET", "/damage/{damage}", None, "One damage entry with history"),
    E("PUT", "/damage/{damage}", "doc.edit", "Replace a draft"),
    E("PATCH", "/damage/{damage}", None, "Approve (writes stock off) / cancel (restores it)"),
    E("DELETE", "/damage/{damage}", "doc.delete", "Delete a draft"),
    E("GET", "/units", None, "Units of measure — Page<UnitRow> (inUse = items using it); ?active=1", page=True),
    E("POST", "/units", "master.edit", "Create unit {code, name, decimals 0–3, active} (422 duplicate)"),
    E("GET", "/units/un1", None, "One unit"),
    E("PUT", "/units/un1", "master.edit", "Update unit (422 unitInUse when re-coding a unit items use)"),
    E("DELETE", "/units/un7", "master.edit", "Delete unit (409 when items use it — deactivate instead)"),
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
    # R2 — purchase & inventory
    E("GET", "/purchases?category=service", None, "Service purchases (R2) — same Page<Purchase>; category=goods (default) | service | all", page=True, csv=True),
    E("GET", "/services", None, "NBR service codes for service purchases [{id, code, name, vatRate, vds, unit}]"),
    E("GET", "/purchases/{purchase}/returnable", None, "Lines still returnable on an approved purchase [{itemId, purchasedQty, returnedQty, remaining, …}]; ?exclude=<debitNoteId>"),
    E("GET", "/debit-notes", None, "Debit notes (Mushak 6.8) — Page<DebitNote>; facets process/reason/vendor/branch; ?purchase=<id>", page=True, csv=True),
    E("POST", "/debit-notes", "doc.create", "Create {purchaseId, issueDate, issueTime, reason, note?, issuedBy, designation, lines[{itemId, qty}], process} (422 notApproved/exceedsRemaining; approve returns stock)"),
    E("GET", "/debit-notes/{debit}", None, "One debit note with history"),
    E("PUT", "/debit-notes/{debit}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/debit-notes/{debit}", None, "Approve (doc.approve; stock out, credit reversed) / cancel {reason≥10} (doc.cancel; stock back)"),
    E("DELETE", "/debit-notes/{debit}", "doc.delete", "Delete a draft (409 if not a draft)"),
    E("GET", "/opening-stock", None, "Opening stock entries — Page<OpeningEntry>; facets process/branch/inputTax", page=True, csv=True),
    E("POST", "/opening-stock", "doc.create", "Create {itemId, branchId, date, inputTax, qty, price, vatPaid?, note?, process} (approve adds to item opening + branch stock)"),
    E("GET", "/opening-stock/{opening}", None, "One opening entry with history"),
    E("PUT", "/opening-stock/{opening}", "doc.edit", "Replace a draft"),
    E("PATCH", "/opening-stock/{opening}", None, "Approve / cancel (reverts the opening)"),
    E("DELETE", "/opening-stock/{opening}", "doc.delete", "Delete a draft"),
    E("GET", "/master-items", None, "Master items with tariff comparison — Page<MasterItemRow> (rates, tariff, overrides[], items); facets group/status/override", page=True, csv=True),
    E("POST", "/master-items", "master.edit", "Create {hsCode, name, group, category, unit, priceMethod, description?, rates{vat,sd,cd,rd,ait,at}, overrideReason (required when rates ≠ tariff), active}"),
    E("GET", "/master-items/m1", None, "One master item with linked SKUs"),
    E("PUT", "/master-items/m1", "master.edit", "Update (renames flow to linked SKUs; 422 overrideReason)"),
    E("GET", "/mushak/6.1?item=i6&from=2026-07-01&to=2026-09-25", None, "Mushak 6.1 purchase book for an input item {company, item, rows, totals, opening, closing}; from/to default to the fiscal year to date; format=csv", csv=True),
    E("GET", "/mushak/6.2?item=i17&from=2026-07-01&to=2026-09-25", None, "Mushak 6.2 sales book for a finished-goods item; other forms 404 until R4", csv=True),
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
    s = S("arif")
    sale = s.get(BASE + "/sales?process=Approved&size=1").json()["data"][0]["id"]
    purchase = s.get(BASE + "/purchases?process=Approved&size=1").json()["data"][0]["id"]
    transfer = s.get(BASE + "/transfers?process=Approved&size=1").json()["data"][0]["id"]
    damage = s.get(BASE + "/damage?process=Approved&size=1").json()["data"][0]["id"]
    debit = s.get(BASE + "/debit-notes?process=Approved&size=1").json()["data"][0]["id"]
    opening = s.get(BASE + "/opening-stock?process=Approved&size=1").json()["data"][0]["id"]
    draft = s.get(BASE + "/purchases?category=all&process=Created&size=1").json()["data"][0]["id"]
    line = s.get(BASE + f"/purchases/{purchase}").json()["lines"][0]["itemId"]
    return {"sale": sale, "purchase": purchase, "item": "i1", "transfer": transfer, "damage": damage, "debit": debit, "opening": opening, "draftPurchase": draft, "purchaseLine": line}

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
            r = S(HAS.get(e["perm"], "arif")).get(url)
            check(r.status_code == 200 and r.headers["content-type"].startswith("application/json"), f"GET {path} → {r.status_code}")
            if e["page"] and r.ok:
                d = r.json()
                check(all(k in d for k in ("data", "total", "page", "size", "facets")) and isinstance(d["data"], list), f"GET {path} is not a Page")
            if e["csv"]:
                sep = "&" if "?" in path else "?"
                r = S(HAS.get(e["perm"], "arif")).get(url + sep + "format=csv")
                check(r.ok and r.headers["content-type"].startswith("text/csv"), f"GET {path} CSV → {r.status_code} {r.headers.get('content-type')}")

    # Specific error contracts: (user, method, path, body, status, error-key or None)
    rnd = f"nobody{random.randint(1000, 9999)}"
    pbody = {"issueDate": "2026-09-20", "challanNo": "CT-1", "challanDate": "2026-09-20", "method": "Bank", "discount": 0, "paid": 0, "issuedBy": "Contract", "designation": "Tester", "process": "Created"}
    imp_line = {"itemId": "i6", "qty": 10, "usd": 100, "usdRate": 122, "cdRate": 10, "rdRate": 0, "sdRate": 0, "vatRate": 15, "aitRate": 5, "atRate": 5}
    dnbody = {"purchaseId": fx["purchase"], "issueDate": "2026-09-24", "issueTime": "10:00", "reason": "damaged", "issuedBy": "Contract", "designation": "Tester", "process": "Created", "lines": [{"itemId": fx["purchaseLine"], "qty": 1}]}
    cases = [
        (None, "POST", "/auth/login", {}, 422, "username"),
        (None, "POST", "/auth/login", {"username": rnd, "password": "x"}, 401, "_"),
        ("arif", "GET", "/sales/nope", None, 404, None),
        ("arif", "GET", "/purchases/nope", None, 404, None),
        ("arif", "GET", "/items/nope", None, 404, None),
        ("arif", "POST", "/sales", {}, 422, "customerId"),
        ("arif", "POST", "/purchases", {}, 422, "vendorId"),
        ("arif", "PUT", f"/sales/{fx['sale']}", {}, 409, None),
        ("arif", "DELETE", f"/sales/{fx['sale']}", None, 409, None),
        ("arif", "PATCH", f"/sales/{fx['sale']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "POST", "/items", {}, 422, "name"),
        ("arif", "POST", "/customers", {}, 422, "name"),
        ("arif", "DELETE", "/customers/c1", None, 409, None),
        ("arif", "GET", "/tariff?hs=99999999", None, 404, None),
        ("arif", "POST", "/notifications/read", {}, 422, None),
        ("arif", "PUT", "/me/password", {"current": "wrong-one", "next": "abcd12345", "confirm": "abcd12345"}, 422, "current"),
        ("arif", "PUT", "/me/password", {"current": PW, "next": "short", "confirm": "short"}, 422, "next"),
        ("admin", "GET", "/users/nope", None, 404, None),
        ("admin", "POST", "/users", {}, 422, "username"),
        ("admin", "POST", "/users", {"username": "arif", "name": "Dup User", "designation": "Tester", "email": "x@y.co", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "username"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@rupsha-flexipack.example", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "role"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@rupsha-flexipack.example", "mobile": "", "department": "", "role": "admin", "active": False}, 422, "active"),
        ("admin", "POST", "/users/u5/reset-password", None, 422, None),
        ("admin", "PUT", "/company", {}, 422, "name"),
        # Sprint 4 — branches, stock documents, units
        ("arif", "POST", "/sales", {"branchId": "b2"}, 422, None),
        ("arif", "GET", "/transfers/nope", None, 404, None),
        ("arif", "GET", "/damage/nope", None, 404, None),
        ("arif", "GET", "/units/nope", None, 404, None),
        ("arif", "POST", "/transfers", {}, 422, "fromBranchId"),
        ("arif", "POST", "/transfers", {"fromBranchId": "b1", "toBranchId": "b1", "date": "2026-09-20", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "toBranchId"),
        ("arif", "POST", "/transfers", {"fromBranchId": "b1", "toBranchId": "b2", "date": "2026-09-20", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "toBranchId"),
        ("arif", "PUT", f"/transfers/{fx['transfer']}", {}, 409, None),
        ("arif", "DELETE", f"/transfers/{fx['transfer']}", None, 409, None),
        ("arif", "PATCH", f"/transfers/{fx['transfer']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "POST", "/damage", {}, 422, "branchId"),
        ("arif", "POST", "/damage", {"branchId": "b1", "date": "2026-09-20", "reason": "lost", "note": "gone", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "note"),
        ("arif", "DELETE", f"/damage/{fx['damage']}", None, 409, None),
        ("arif", "POST", "/units", {}, 422, "code"),
        ("arif", "POST", "/units", {"code": "Kg", "name": "Kilogram again", "decimals": 2, "active": True}, 422, "code"),
        ("arif", "PUT", "/units/un1", {"code": "KGX", "name": "Kilogram", "decimals": 3, "active": True}, 422, "code"),
        ("arif", "DELETE", "/units/un1", None, 409, None),
        # R2 — imports, services, debit notes, opening stock, master items, Mushak books
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v1", "category": "service", "lines": [{"itemId": "sv1", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 10}]}, 422, "vendorId"),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v7", "category": "service", "lines": [{"itemId": "i1", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 15}]}, 422, None),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v2", "lines": [imp_line]}, 422, "boe"),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v2", "lines": [imp_line], "boe": {"lcNo": "LC-1", "lcDate": "2026-09-21", "customsHouse": "301", "origin": "China"}}, 422, "boe.lcDate"),
        ("arif", "GET", "/purchases/nope/returnable", None, 404, None),
        ("arif", "GET", "/debit-notes/nope", None, 404, None),
        ("arif", "POST", "/debit-notes", {}, 422, "purchaseId"),
        ("arif", "POST", "/debit-notes", {**dnbody, "purchaseId": fx["draftPurchase"]}, 422, "purchaseId"),
        ("arif", "POST", "/debit-notes", {**dnbody, "lines": [{"itemId": fx["purchaseLine"], "qty": 99999999}]}, 422, "lines.0.qty"),
        ("arif", "PUT", f"/debit-notes/{fx['debit']}", {}, 409, None),
        ("arif", "DELETE", f"/debit-notes/{fx['debit']}", None, 409, None),
        ("arif", "PATCH", f"/debit-notes/{fx['debit']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "GET", "/opening-stock/nope", None, 404, None),
        ("arif", "POST", "/opening-stock", {}, 422, "itemId"),
        ("arif", "DELETE", f"/opening-stock/{fx['opening']}", None, 409, None),
        ("arif", "GET", "/master-items/nope", None, 404, None),
        ("arif", "POST", "/master-items", {}, 422, "hsCode"),
        ("arif", "POST", "/master-items", {"hsCode": "76071110", "name": "Contract override", "group": "Raw Material", "category": "general", "unit": "Kg", "priceMethod": "average", "rates": {"vat": 10, "sd": 0, "cd": 5, "rd": 0, "ait": 5, "at": 5}, "active": True}, 422, "overrideReason"),
        ("arif", "GET", "/mushak/6.1?item=i17&from=2026-07-01&to=2026-09-25", None, 422, "item"),
        ("arif", "GET", "/mushak/6.2?item=i6&from=2026-07-01&to=2026-09-25", None, 422, "item"),
        ("arif", "GET", "/mushak/6.1?item=i6&from=2026-09-10&to=2026-09-01", None, 422, "to"),
        ("arif", "GET", "/mushak/6.1?item=i6&from=bad&to=2026-09-25", None, 422, "from"),
        ("arif", "GET", "/mushak/9.1?item=i6&from=2026-07-01&to=2026-09-25", None, 404, None),
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
