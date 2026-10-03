"""
R5 backend checks (NestJS + PostgreSQL, branch r5-nestjs) — what the stateless mock could not do.

Runs through the Next.js frontend (BASE_URL, default http://localhost:3000), which proxies /api/v1 to the API.
  API_RESTART_CMD  shell command that restarts the API and returns once it is healthy (enables the restart checks)
  DATABASE_URL     enables the direct database checks (needs `psql`)
  SESSION_SECRET   enables the forged-token check (must equal the API's secret)
Run on a freshly seeded database (`node api/dist/main.js --reset`); it creates its own users and records.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, uuid
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000") + "/api/v1"
PW = "demo1234"
RESTART = os.environ.get("API_RESTART_CMD")
DB_URL = os.environ.get("DATABASE_URL")
SECRET = os.environ.get("SESSION_SECRET")
API_LOG = os.environ.get("API_LOG")
ok = fail = skip = 0
TAG = uuid.uuid4().hex[:6]

# ── R5.2 upgrade drill ─────────────────────────────────────────────────────────────────────────────────────────
# A database written before R5.2 holds its master data inside compat_state (deleted parties in the undo buffer) and
# has no parties/items/master_items rows. These statements rebuild exactly that shape from the live tables — the
# stored row as the compat world had it: camelCase fields, optional ones absent rather than null, timestamps in the
# ISO-8601 the snapshot carries — so the first boot on this code has to adopt it, and the drill can prove nothing was
# lost. Nothing here ships: it is the inverse of `adoptCompatRows()` in api/src/boot.ts, for the test only.
_NO_NULLS = "(select jsonb_object_agg(key, value) from jsonb_each({}) where value <> 'null'::jsonb)"
_ISO = """to_char({} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')"""
PARTY_DOC = _NO_NULLS.format("""jsonb_build_object(
    'id', id, 'name', name, 'bin', bin, 'mode', mode, 'mobile', mobile, 'address', address, 'kind', kind,
    'country', country, 'email', email, 'contactPerson', contact_person, 'active', active, 'creditLimit', credit_limit,
    'vdsWithholder', vds_withholder, 'exporterType', exporter_type, 'bondLicenseNo', bond_license_no,
    'bondLicenseExpiry', bond_license_expiry, 'associationNo', association_no)""")
ITEM_DOC = _NO_NULLS.format("""jsonb_build_object(
    'id', id, 'hsCode', hs_code, 'group', "group", 'masterItem', master_item, 'brand', brand, 'name', name, 'unit', unit,
    'sku', sku, 'purchasePrice', purchase_price, 'costPrice', cost_price, 'salePrice', sale_price, 'vatRate', vat_rate,
    'sdRate', sd_rate, 'opening', opening, 'purchased', purchased, 'prodReceive', prod_receive, 'prodIssue', prod_issue,
    'sold', sold, 'damage', damage, 'reorderLevel', reorder_level, 'active', active)""")
MASTER_DOC = _NO_NULLS.format("""jsonb_build_object(
    'id', id, 'name', name, 'hsCode', hs_code, 'group', "group", 'category', category, 'unit', unit,
    'priceMethod', price_method, 'description', description,
    'rates', jsonb_build_object('vat', vat, 'sd', sd, 'cd', cd, 'rd', rd, 'ait', ait, 'at', at),
    'overrideReason', override_reason, 'active', active, 'createdAt', """ + _ISO.format("created_at") + """,
    'updatedAt', """ + _ISO.format("updated_at") + """, 'history', history)""")
PARTY_AGG = lambda kind: (f"(select coalesce(jsonb_agg(doc order by ord), '[]'::jsonb) "
                          f"from (select ord, {PARTY_DOC} as doc from parties "
                          f"where kind = '{kind}' and deleted_at is null) {kind[0]})")
# the four collections back inside the snapshot
PRE_R52_COLLECTIONS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'customers', {PARTY_AGG('customer')},
  'vendors', {PARTY_AGG('vendor')},
  'items', (select coalesce(jsonb_agg({ITEM_DOC} order by ord), '[]'::jsonb) from items),
  'masterItems', (select coalesce(jsonb_agg({MASTER_DOC} order by ord), '[]'::jsonb) from master_items)
)) where key = 'main'"""
# … and the deleted parties back into the undo buffer, keeping the documents already in it
PRE_R52_TRASH = f"""update compat_state set data = jsonb_set(data, '{{db,trash}}',
  coalesce(data->'db'->'trash', '[]'::jsonb) || (
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'doc', doc, 'at', {_ISO.format('deleted_at')})
                              order by deleted_at), '[]'::jsonb)
    from (select kind, deleted_at, {PARTY_DOC} as doc from parties where deleted_at is not null) t),
  true) where key = 'main'"""
PARTY_TRASH_LEFT = """select count(*) from compat_state where jsonb_typeof(data->'db'->'trash') = 'array'
  and exists (select 1 from jsonb_array_elements(data->'db'->'trash') t where t->>'kind' in ('customer', 'vendor'))"""


def check(cond, msg):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ok   {msg}")
    else:
        fail += 1
        print(f"  FAIL {msg}")


def skipped(msg):
    global skip
    skip += 1
    print(f"  skip {msg}")


def session(user, pw=PW, remember=False):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": user, "password": pw, "remember": remember})
    assert r.status_code == 200, f"login {user}: {r.status_code} {r.text[:200]}"
    return s


def token_of(s):
    return s.cookies.get("dizivat_session")


def with_token(tok):
    s = requests.Session()
    s.cookies.set("dizivat_session", tok)
    return s


def restart():
    t = time.time()
    subprocess.run(RESTART, shell=True, check=True)
    for _ in range(60):
        try:
            if requests.get(f"{BASE}/health", timeout=2).ok:
                return time.time() - t
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise RuntimeError("API did not come back")


def psql(q):
    return subprocess.run(["psql", DB_URL, "-At", "-c", q], capture_output=True, text=True, check=True).stdout.strip()


def invite(admin, username, role="operator"):
    r = admin.post(f"{BASE}/users", json={"username": username, "name": f"Test {username.title()}", "designation": "Tester",
                                           "email": f"{username}@example.com", "mobile": "", "department": "", "role": role, "active": True})
    assert r.status_code == 201, r.text
    return r.json()


def run():
    print(f"R5 backend checks against {BASE}")

    print("health")
    h = requests.get(f"{BASE}/health").json()
    check(h.get("ok") and h["db"]["ok"], f"health: API up, database reachable ({h['db']['ms']} ms)")
    check(h["modules"]["native"] >= 7 and h["modules"]["compatRoutes"] > 0, f"health: {h['modules']['native']} native modules, {h['modules']['compatRoutes']} compat routes")

    print("sign-out is real (server-side sessions)")
    s = session("kamal")
    tok = token_of(s)
    check(s.get(f"{BASE}/me").status_code == 200, "cookie works while signed in")
    s.post(f"{BASE}/auth/logout")
    check(with_token(tok).get(f"{BASE}/me").status_code == 401, "a copied cookie stops working after sign-out")
    check(with_token(tok).get(f"{BASE}/sales?size=1").status_code == 401, "…on compat routes too")

    admin = session("admin")
    print("admin reset and deactivation revoke sessions")
    u = invite(admin, f"r5a{TAG}")
    uid, temp = u["user"]["id"], u["tempPassword"]
    check(u["user"].get("mustChangePassword") is True, "invited user must change the temporary password")
    li = requests.get(f"{BASE}/auth/login-info").json()
    check(all(d["username"] != u["user"]["username"] for d in li["demo"]), "invited user is not listed as a demo account")
    x = session(u["user"]["username"], temp)
    check(x.get(f"{BASE}/me").status_code == 200, "invited user signs in with the temporary password")
    r = admin.post(f"{BASE}/users/{uid}/reset-password")
    temp2 = r.json()["tempPassword"]
    check(r.status_code == 200 and temp2 != temp, "admin reset issues a new one-time password")
    check(x.get(f"{BASE}/me").status_code == 401, "reset signs the user out immediately")
    check(requests.post(f"{BASE}/auth/login", json={"username": u["user"]["username"], "password": temp}).status_code == 401, "old temporary password no longer works")
    x = session(u["user"]["username"], temp2)
    body = admin.get(f"{BASE}/users/{uid}").json()
    body.update(active=False)
    for k in ("id", "username", "initials", "createdAt", "lastSignInAt", "mustChangePassword"):
        body.pop(k, None)
    r = admin.put(f"{BASE}/users/{uid}", json=body)
    check(r.status_code == 200 and r.json()["active"] is False, "admin deactivates the user")
    check(x.get(f"{BASE}/me").status_code == 401, "deactivation signs the user out immediately")
    check(requests.post(f"{BASE}/auth/login", json={"username": u["user"]["username"], "password": temp2}).status_code == 403, "deactivated user cannot sign in (403)")

    print("password change keeps this browser, revokes the others")
    v = invite(admin, f"r5b{TAG}")
    name, temp = v["user"]["username"], v["tempPassword"]
    a, b = session(name, temp, remember=True), session(name, temp)
    new_pw = f"Fresh{TAG}9x"
    r = a.put(f"{BASE}/me/password", json={"current": temp, "next": new_pw, "confirm": new_pw})
    check(r.status_code == 200 and not r.json()["user"].get("mustChangePassword"), "password changed; forced change cleared")
    check(a.get(f"{BASE}/me").status_code == 200, "this browser stays signed in (fresh cookie)")
    check(b.get(f"{BASE}/me").status_code == 401, "the other browser is signed out")

    print("brute-force lockout")
    w = invite(admin, f"r5c{TAG}")
    wname = w["user"]["username"]
    codes = [requests.post(f"{BASE}/auth/login", json={"username": wname, "password": "wrong-pass"}).status_code for _ in range(5)]
    r = requests.post(f"{BASE}/auth/login", json={"username": wname, "password": w["tempPassword"]})
    check(codes == [401] * 5 and r.status_code == 429, "5 wrong passwords → locked (429) even with the right one")

    if SECRET:
        print("forged / legacy tokens")
        def sign(p):
            body = base64.urlsafe_b64encode(json.dumps(p).encode()).rstrip(b"=").decode()
            sig = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
            return f"{body}.{sig}"
        now = int(time.time())
        check(with_token(sign({"uid": "u5", "exp": now + 3600, "iat": now})).get(f"{BASE}/me").status_code == 401, "validly signed token without a session id is rejected")
        check(with_token(sign({"uid": "u5", "sid": "made-up", "exp": now + 3600, "iat": now})).get(f"{BASE}/me").status_code == 401, "validly signed token for an unknown session is rejected")
    else:
        skipped("forged-token checks (SESSION_SECRET not set)")

    print("writes land in PostgreSQL")
    arif = session("arif")
    cust = arif.post(f"{BASE}/customers", json={"name": f"R5 Persist Test {TAG}", "mode": "Foreign", "country": "Japan", "address": "1-2-3 Marunouchi, Tokyo"})
    check(cust.status_code == 201, f"native (R5.2): customer created ({cust.status_code})")
    cid = cust.json().get("id")
    # a second customer is deleted and restored below: since R5.2 a delete is a `deleted_at` stamp, so the record
    # stays in PostgreSQL (and stays deleted across a restart) instead of living in the in-memory undo buffer
    gone = arif.post(f"{BASE}/vendors", json={"name": f"R5 Deleted Vendor {TAG}", "mode": "Foreign", "country": "China", "address": "Shenzhen, China"})
    gid = gone.json().get("id")
    ud_body = {"kind": "UD", "no": f"BKMEA/UD/2026/R5{TAG}".upper(), "date": "2026-09-20", "customerId": "c10",
               "masterLcNo": f"EXP-LC-R5-{TAG}", "buyer": "E2E BUYER", "expiry": "2027-03-31", "lines": [{"itemId": "i21", "qty": 1000}]}
    ud = arif.post(f"{BASE}/vat/uds", json=ud_body)
    check(ud.status_code == 201, f"compat: UD created for the snapshot check ({ud.status_code})")
    unit = arif.post(f"{BASE}/units", json={"code": f"R5{TAG[:3]}", "name": "R5 test unit", "decimals": 1, "active": True})
    check(unit.status_code == 201 and unit.json()["id"].startswith("un"), "native: unit created")
    # R5.2: SKUs and master items are native too. A master item's rename carries its SKUs along (they quote its name),
    # a compat document moves an item's counters, and the R6.2 bulk import creates SKUs — all three must reach the table.
    m0 = arif.get(f"{BASE}/master-items", params={"size": 1}).json()["data"][0]
    HS, UNIT, RATES = m0["hsCode"], m0["unit"], m0["rates"]
    master_body = {"hsCode": HS, "name": f"R5 Master {TAG}", "group": "Raw Material", "category": "general", "unit": UNIT,
                   "priceMethod": "average", "description": "", "rates": RATES, "overrideReason": "", "active": True}
    mi = arif.post(f"{BASE}/master-items", json=master_body)
    check(mi.status_code == 201 and mi.json()["id"].startswith("m"), f"native (R5.2): master item created ({mi.status_code})")
    mid = mi.json().get("id")
    item_body = {"name": f"R5 Item {TAG}", "hsCode": HS, "group": "Raw Material", "unit": UNIT, "sku": f"R5-{TAG}",
                 "purchasePrice": 100, "salePrice": 150, "vatRate": 15, "sdRate": 0, "reorderLevel": 10, "active": True,
                 "masterItemId": mid}
    it = arif.post(f"{BASE}/items", json=item_body)
    check(it.status_code == 201 and it.json()["costPrice"] == 112 and it.json()["remain"] == 0,
          f"native (R5.2): SKU created, cost price derived ({it.status_code})")
    iid = it.json().get("id")
    check(arif.post(f"{BASE}/items", json={**item_body, "name": "Same SKU again"}).status_code == 422, "a duplicate SKU is refused (422)")
    check(arif.post(f"{BASE}/items", json={**item_body, "sku": f"R5B-{TAG}", "masterItemId": "m99999"}).status_code == 422,
          "an unknown master item is refused (422)")
    rn = arif.put(f"{BASE}/master-items/{mid}", json={**master_body, "name": f"R5 Master Renamed {TAG}"})
    check(rn.status_code == 200 and arif.get(f"{BASE}/items/{iid}").json()["masterItem"] == f"R5 Master Renamed {TAG}",
          "R5.2: renaming a master item carries its SKUs along")
    check(any(x["id"] == iid for x in arif.get(f"{BASE}/master-items/{mid}").json()["skus"]), "R5.2: …and it still lists them")
    branch = arif.get(f"{BASE}/stock").json()["branches"][0]["id"]
    op = arif.post(f"{BASE}/opening-stock", json={"itemId": iid, "branchId": branch, "date": "2026-09-22", "inputTax": "standard",
                                                  "qty": 40, "price": 100, "process": "Approved"})
    check(op.status_code == 201 and arif.get(f"{BASE}/items/{iid}").json()["remain"] == 40,
          f"compat: an approved opening entry moves the SKU's stock ({op.status_code})")
    imp = arif.post(f"{BASE}/import", json={"entity": "items", "dryRun": False, "rows": [
        {"name": f"R5 Imported {TAG}", "hsCode": HS, "group": "Consumable", "unit": UNIT, "sku": f"R5IMP-{TAG}",
         "purchasePrice": "12.5", "salePrice": "20", "vatRate": "15", "sdRate": "0", "reorderLevel": "0", "active": "yes"}]})
    check(imp.status_code == 201 and imp.json()["created"] == 1, f"compat (R6.2): the bulk import created a SKU ({imp.status_code})")
    arif.put(f"{BASE}/me/preferences", json={"density": "compact", "accent": "violet"})
    arif.post(f"{BASE}/me/views", json={"table": "sales", "name": f"R5 view {TAG}", "query": "status=approved"})
    audit = arif.get(f"{BASE}/audit", params={"q": TAG, "size": 50}).json()
    check(audit["total"] >= 2, f"audit trail has the new events ({audit['total']})")
    before_ids = sorted(e["id"] for e in audit["data"])

    if DB_URL:
        hashes = psql("select password_hash from users").splitlines()
        check(hashes and all(h.startswith("scrypt$") for h in hashes), f"all {len(hashes)} passwords are scrypt hashes")
        check(PW not in psql("select string_agg(password_hash, '') from users"), "no password stored in clear")
        check(psql(f"select count(*) from audit_events where ref like '%{TAG}%'") != "0", "audit events are rows in audit_events")
        check(int(psql("select count(*) from sessions where revoked_at is not null")) >= 3, "revoked sessions are kept for review")
        check(psql(f"select count(*) from parties where name ilike '%R5 Persist Test {TAG}%'") == "1", "R5.2: customers are rows in the parties table")
        check(psql(f"select count(*) from compat_state where data::text ilike '%R5 Persist Test {TAG}%'") == "0", "R5.2: …and no longer inside the compat snapshot")
        check(psql("select count(*) from compat_state where data->'db' ? 'customers' or data->'db' ? 'vendors'") == "0", "R5.2: the snapshot carries no party collection at all")
        check(psql(f"select count(*) from compat_state where data::text ilike '%R5{TAG}%'") == "1", "compat documents are still saved in compat_state")
        check(int(psql("select count(*) from parties where kind = 'customer'")) >= 10 and int(psql("select count(*) from parties where kind = 'vendor'")) >= 14,
              "R5.2: the demo customers and vendors were seeded into the table")
        dup = subprocess.run(["psql", DB_URL, "-At", "-c", "insert into parties (id, ord, kind, name, bin, mode, mobile, address) "
                              f"select 'dup{TAG}', 999999, kind, name, bin, mode, mobile, address from parties where kind = 'customer' and deleted_at is null limit 1"],
                             capture_output=True, text=True)
        check(dup.returncode != 0, "R5.2: the database refuses a duplicate party name (unique index), not just the API")
        check(psql(f"select count(*) from items where id = '{iid}'") == "1", "R5.2: SKUs are rows in the items table")
        check(psql(f"select count(*) from master_items where id = '{mid}' and name = 'R5 Master Renamed {TAG}'") == "1",
              "R5.2: …and master items in master_items")
        check(psql(f"select count(*) from items where master_item = 'R5 Master Renamed {TAG}'") == "1", "R5.2: the rename carried the SKU along in the table")
        check(psql(f"select opening = 40 from items where id = '{iid}'") == "t", "R5.2: a compat document that moved a counter reached the table")
        # the R6.2 importer uppercases every SKU it reads (`str(r.sku).toUpperCase()`), so the row carries the tag in capitals
        check(psql(f"select count(*) from items where sku = 'R5IMP-{TAG.upper()}'") == "1", "R5.2: …and the compat bulk import was adopted into it")
        check(psql("select count(*) from compat_state where data->'db' ? 'items' or data->'db' ? 'masterItems'") == "0",
              "R5.2: the snapshot carries no item collection at all")
        check(int(psql("select count(*) from items")) >= 22 and int(psql("select count(*) from master_items")) >= 19,
              "R5.2: the demo SKUs and master items were seeded into their tables")
        icols = ('id, ord, hs_code, "group", master_item, brand, name, unit, sku, purchase_price, cost_price, sale_price, vat_rate, '
                 'sd_rate, opening, purchased, prod_receive, prod_issue, sold, damage, reorder_level, active')
        dupsku = subprocess.run(["psql", DB_URL, "-At", "-c",
                                 f"insert into items ({icols}) select 'dups{TAG}', 999999, hs_code, \"group\", master_item, brand, name, unit, sku, "
                                 "purchase_price, cost_price, sale_price, vat_rate, sd_rate, 0, 0, 0, 0, 0, 0, 0, true from items limit 1"],
                                capture_output=True, text=True)
        check(dupsku.returncode != 0, "R5.2: the database refuses a duplicate SKU (unique index), not just the API")
        # R6: tamper-evident, append-only audit trail (NBR enlistment — protection against tampering)
        check(psql("select count(*) from audit_events where hash is null or prev_hash is null") == "0", "R6: every audit event is sealed (prev_hash + hash)")
        def refused(q):
            r = subprocess.run(["psql", DB_URL, "-At", "-c", q], capture_output=True, text=True)
            return r.returncode != 0 and "append-only" in r.stderr
        check(refused("update audit_events set note = 'x' where id = 1"), "R6: the database refuses UPDATE on audit_events")
        check(refused("delete from audit_events where id = 1"), "R6: the database refuses DELETE on audit_events")
        check(refused("truncate audit_events"), "R6: the database refuses TRUNCATE on audit_events")
    else:
        skipped("database checks (DATABASE_URL not set)")

    print("R5.2: deleting a party is a deleted_at stamp, undo restores it")
    d = arif.delete(f"{BASE}/vendors/{gid}")
    check(d.status_code == 200 and d.json().get("ok") is True, "an unused vendor is deleted (undo offered)")
    check(arif.get(f"{BASE}/vendors/{gid}").status_code == 404, "…and is gone from the API")
    check(not any(v["id"] == gid for v in arif.get(f"{BASE}/vendors").json()), "…and from the picker")
    if DB_URL:
        check(psql(f"select count(*) from parties where id = '{gid}' and deleted_at is not null") == "1", "R5.2: the row is kept with deleted_at (master data never leaves the table)")
    r = arif.post(f"{BASE}/vendors/{gid}/restore")
    check(r.status_code == 200 and r.json().get("id") == gid, "restore puts it back (undo)")
    check(arif.post(f"{BASE}/vendors/{gid}/restore").status_code == 404, "restoring something not in the trash is a 404")
    d2 = arif.delete(f"{BASE}/vendors/{gid}")
    check(d2.status_code == 200, "deleted again — left deleted for the restart check")
    # the unique indexes ignore the trash, so a deleted party's name is free again — and an undo that then collides
    # answers with the form's 422 (the driver error unwrapped), not a 500, leaving the record deleted
    ca = arif.post(f"{BASE}/vendors", json={"name": f"R5 CLASH {TAG}", "mode": "Foreign", "country": "China", "address": "Shenzhen, China"}).json()
    arif.delete(f"{BASE}/vendors/{ca['id']}")
    cb = arif.post(f"{BASE}/vendors", json={"name": f"r5 clash {TAG}", "mode": "Foreign", "country": "China", "address": "Chittagong"})
    check(cb.status_code == 201, f"R5.2: a deleted party's name is free again ({cb.status_code})")
    cc = arif.post(f"{BASE}/vendors/{ca['id']}/restore")
    check(cc.status_code == 422 and cc.json().get("errors", {}).get("name") == ["duplicate"],
          f"R5.2: an undo whose name was taken again is a 422, not a 500 ({cc.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from parties where id = '{ca['id']}' and deleted_at is not null") == "1",
              "R5.2: …and the refused undo leaves the record in the trash")
    check(arif.delete(f"{BASE}/customers/c1").status_code == 409, "a customer with invoices cannot be deleted (409 in-use:N)")
    check(arif.post(f"{BASE}/customers", json={"name": "SUNRISE FASHION RETAIL LTD", "mode": "Local", "bin": "004817362-0105", "address": "Dhaka, Bangladesh"}).status_code == 422,
          "a duplicate name/BIN is refused (422) — the rules the mock handlers use")

    # R6: chain verification endpoint
    v = arif.get(f"{BASE}/audit/verify")
    check(v.status_code == 200 and v.json().get("ok") is True and v.json().get("algorithm") == "SHA-256", f"R6: audit chain verifies ({v.json().get('count') if v.ok else v.status_code} events)")
    check(len(v.json().get("head", "")) == 64 if v.ok else False, "R6: chain head is a SHA-256 hex digest")
    check(session("kamal").get(f"{BASE}/audit/verify").status_code == 403, "R6: operators cannot run the verification (audit.view)")

    # R6.2: VAT officer — time-boxed, read-only, every read logged
    print("R6.2: VAT officer + backups")
    import datetime
    admin = session("admin")
    dhaka = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=6)).date()
    oname = f"nbr{TAG}"
    obody = {"username": oname, "name": f"Officer {TAG}", "designation": "Revenue Officer", "email": f"{oname}@nbr.example", "mobile": "", "department": "NBR",
             "role": "vatOfficer", "active": True, "accessUntil": str(dhaka + datetime.timedelta(days=200))}
    r = admin.post(f"{BASE}/users", json=obody)
    check(r.status_code == 422 and r.json()["errors"].get("accessUntil") == ["accessTooLong"], "R6.2: officer access longer than 90 days → 422")
    r = admin.post(f"{BASE}/users", json={**obody, "accessUntil": str(dhaka + datetime.timedelta(days=7))})
    check(r.status_code == 201 and r.json()["user"].get("accessUntil") == str(dhaka + datetime.timedelta(days=7)), "R6.2: officer created with access-until date")
    off = r.json()
    o = session(oname, off["tempPassword"])
    check(o.get(f"{BASE}/vat/exports").status_code == 200 and o.get(f"{BASE}/audit", params={"size": 2}).status_code == 200, "R6.2: officer can read (compat + native)")
    check(o.post(f"{BASE}/units", json={"code": "ZZ", "name": "x", "decimals": 0}).status_code == 403, "R6.2: officer cannot write")
    acc = admin.get(f"{BASE}/audit", params={"entity": "access", "size": 50}).json()["data"]
    refs = {e["ref"] for e in acc if e.get("actorId") == off["user"]["id"]}
    check({"/vat/exports", "/audit"} <= refs, f"R6.2: officer reads are in the audit trail ({sorted(refs)})")
    if DB_URL:
        check(psql(f"select access_until from users where username = '{oname}'") == str(dhaka + datetime.timedelta(days=7)), "R6.2: users.access_until stored")
        psql(f"update users set access_until = '{dhaka - datetime.timedelta(days=1)}' where username = '{oname}'")
        u = admin.get(f"{BASE}/users/{off['user']['id']}").json()
        admin.put(f"{BASE}/users/{off['user']['id']}", json={**u, "designation": "Revenue Officer (expired)"})  # refreshes the server's copy
        check(o.get(f"{BASE}/me").status_code == 401, "R6.2: an expired officer's session stops working")
        r = requests.post(f"{BASE}/auth/login", json={"username": oname, "password": off["tempPassword"]})
        check(r.status_code == 403 and r.json().get("title") == "expired", "R6.2: expired officer cannot sign in (403 expired)")
        check(subprocess.run(["psql", DB_URL, "-At", "-c", f"update users set access_until = null where username = '{oname}'"], capture_output=True, text=True).returncode != 0, "R6.2: the database requires an access date for officers")
    else:
        skipped("officer expiry (DATABASE_URL not set)")

    # R6.2: backups in PostgreSQL
    st = admin.get(f"{BASE}/backups").json()
    check(st.get("storage") == "postgres" and st.get("schedule") == ["02:00", "14:00"] and any(x["kind"] == "scheduled" for x in st.get("rows", [])), "R6.2: backups stored in PostgreSQL; the current slot's scheduled backup exists")
    bk = admin.post(f"{BASE}/backups")
    check(bk.status_code == 201 and len(bk.json().get("sha256", "")) == 64, f"R6.2: manual backup ({round(bk.json().get('size', 0) / 1024)} KB)")
    bid = bk.json()["id"]
    check(admin.post(f"{BASE}/backups/{bid}/verify").json().get("ok") is True, "R6.2: backup checksum verifies")
    d = admin.get(f"{BASE}/backups/{bid}")
    import gzip as _gz
    snap = json.loads(_gz.decompress(d.content)) if d.ok else {}
    check(d.ok and snap.get("format") == "dizivat-backup/1" and "audit_events" in snap.get("tables", {}) and "compat_state" in snap.get("tables", {}), "R6.2: download is a gzip JSON snapshot of the tables")
    check(not any("password_hash" in u for u in snap.get("tables", {}).get("users", [])), "R6.2: password hashes are not in backups")
    check(session("arif").get(f"{BASE}/backups").status_code == 403, "R6.2: backups need settings.manage")
    if DB_URL:
        check(int(psql("select count(*) from backups")) >= 2 and psql(f"select sha256 from backups where id = {bid[2:]}") == bk.json()["sha256"], "R6.2: backups are rows in the backups table")
        dup = subprocess.run(["psql", DB_URL, "-At", "-c", f"insert into backups (kind, slot, by, size, sha256, tables, data) select 'scheduled', slot, 'x', 1, 'x', '{{}}', '\\x00' from backups where kind = 'scheduled' limit 1"], capture_output=True, text=True)
        check(dup.returncode != 0, "R6.2: only one scheduled backup per slot (unique index)")

    # R6.3: RMG demo company, SD on exported inputs + penalty (compat), restore drill into a fresh database
    print("R6.3: RMG company, note 40, penalty, restore drill")
    co = arif.get(f"{BASE}/company").json()
    check("KANCHANJHARA" in co.get("name", "").upper() and co.get("bin") == "004937518-0102", f"R6.3: demo company is {co.get('name')}")
    sde = arif.get(f"{BASE}/vat/sd-eligible").json()
    check(any(r["purchaseId"] == "p95" and r["state"] == "lapsed" for r in sde.get("rows", [])) and sde.get("totals", {}).get("claimable", 0) > 0, "R6.3: SD six-month register served from PostgreSQL")
    q = arif.get(f"{BASE}/vat/penalty", params={"period": "2026-08", "vat": 100000, "sd": 0, "paidOn": "2026-11-20", "filedOn": "2026-11-20"}).json()
    check(q.get("result", {}).get("total") == 13000, "R6.3: penalty quote (3 months × 1 % + Tk 10,000)")
    if DB_URL:
        restore_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "dist", "restore.js")
        target = DB_URL.split("?")[0].rsplit("/", 1)[0] + f"/dizivat_drill_{TAG}"
        t0 = time.time()
        rp = subprocess.run(["node", restore_js, "--source", DB_URL, "--id", bid, "--target", target, "--create", "--admin-password", f"Drill-{TAG}-pw", "--boot", "--drop-after", "--record", "--report", f"/tmp/drill_{TAG}.json"],
                            capture_output=True, text=True, timeout=600, env={**os.environ, "DRILL_BY": "api_native"})
        rep = json.load(open(f"/tmp/drill_{TAG}.json")) if os.path.exists(f"/tmp/drill_{TAG}.json") else {}
        check(rp.returncode == 0 and rep.get("ok") is True, f"R6.3: restore drill of {bid} passed in {time.time() - t0:.1f} s ({rep.get('tables')} tables, {rep.get('rows')} rows){'' if rp.returncode == 0 else ' — ' + (rp.stderr or rp.stdout)[-300:]}")
        check(rep.get("auditChain") == "ok" and rep.get("boot") == "ok" and not rep.get("mismatches"), "R6.3: drill verified counts, audit chain and a sign-in on the restored copy")
        check(psql(f"select count(*) from pg_database where datname = 'dizivat_drill_{TAG}'") == "0", "R6.3: --drop-after removed the drill database")
        dr = admin.get(f"{BASE}/backups").json().get("drill") or {}
        check(dr.get("ok") is True and dr.get("backupId") == bid and dr.get("by") == "api_native", "R6.3: GET /backups shows the recorded drill")
        t2 = DB_URL.split("?")[0].rsplit("/", 1)[0] + f"/dizivat_twice_{TAG}"
        first = subprocess.run(["node", restore_js, "--source", DB_URL, "--target", t2, "--create"], capture_output=True, text=True, timeout=300)
        again = subprocess.run(["node", restore_js, "--source", DB_URL, "--target", t2], capture_output=True, text=True, timeout=300)
        same = subprocess.run(["node", restore_js, "--source", DB_URL, "--target", DB_URL], capture_output=True, text=True, timeout=120)
        psql(f"drop database if exists dizivat_twice_{TAG}")
        check(first.returncode == 0 and again.returncode == 1 and "not empty" in again.stderr + again.stdout and same.returncode == 1,
              "R6.3: restore refuses a database that already holds data (and the source itself)")
    else:
        skipped("restore drill (DATABASE_URL not set)")

    # R6.4: bond consumption register + drawback (compat), bonded import fields persisted in PostgreSQL
    print("R6.4: bond register, BoE ageing, drawback")
    bond = arif.get(f"{BASE}/vat/bond").json()
    lots = {(l["boeNo"], l["itemId"]): l for l in bond.get("lots", [])}
    check(lots.get(("C-0988415", "i4"), {}).get("state") == "expiring" and lots.get(("C-0979032", "i11"), {}).get("state") == "extension",
          "R6.4: go-live BoEs expiring / in extension (bond register served from PostgreSQL)")
    check(bond.get("totals", {}).get("dutyAtRisk", 0) > 0 and bond.get("drawback", {}).get("totals", {}).get("claimable", 0) > 0, "R6.4: shortfall duty at risk and claimable drawback")
    bp = arif.get(f"{BASE}/purchases/{lots.get(('C-1012264', 'i5'), {}).get('docId', 'p98')}").json()
    check(bp.get("boe", {}).get("bonded") is True and bp.get("vat") == 0 and (bp.get("lines") or [{}])[0].get("duty", {}).get("foregone", {}).get("total", 0) > 0,
          "R6.4: bonded import keeps duty foregone with nothing payable")
    check(arif.get(f"{BASE}/vat/bond", params={"to": "2030-01-01"}).status_code == 422, "R6.4: range validation (422)")

    # R6.5: own UD settlement + drawback claims (compat), persisted in PostgreSQL
    print("R6.5: UD settlement, drawback claims")
    bu = {u["id"]: u for u in arif.get(f"{BASE}/vat/bond-uds").json().get("rows", [])}
    b1, b5 = bu.get("bu1", {}), bu.get("bu5", {})
    check(b1.get("state") == "settled" and abs((b1.get("settlement") or {}).get("lines", [{}])[0].get("dutyPaidQty", 0) - 974.24) < 0.001
          and any(l.get("broughtForward") == 2000 for l in b5.get("lines", [])), "R6.5: seeded settlement + brought forward served from PostgreSQL")
    ud_no = f"BKMEA/UD/2026/N{TAG}".upper()
    r = arif.post(f"{BASE}/vat/bond-uds", json={"kind": "UD", "issuer": "BKMEA", "no": ud_no, "date": "2026-08-01", "expiry": "2026-09-01", "masterLcNo": f"EXP-LC-N-{TAG}",
                                               "inputs": [{"itemId": "i9", "qty": 100}], "garments": [{"itemId": "i18", "qty": 300}]})
    ud_id = r.json().get("id") if r.status_code == 201 else None
    st = arif.post(f"{BASE}/vat/bond-uds/{ud_id}/settle", json={"date": "2026-09-20", "bondRef": f"CBC/N/{TAG}"}) if ud_id else None
    check(ud_id is not None and st is not None and st.status_code == 200 and st.json().get("state") == "settled", "R6.5: an expired UD settles (nothing left over)")
    check(arif.post(f"{BASE}/vat/bond-uds/{ud_id}/settle", json={"date": "2026-09-20", "bondRef": f"CBC/N/{TAG}"}).status_code == 409, "R6.5: a settled UD cannot be settled again (409)")
    drafts = arif.get(f"{BASE}/vat/drawback-claims", params={"status": "draft"}).json().get("rows", [])
    claim_id = drafts[0]["id"] if drafts else None
    fr = arif.post(f"{BASE}/vat/drawback-claims/{claim_id}/action", json={"action": "file", "date": "2026-09-25", "ref": f"DEDO/N/{TAG}"}) if claim_id else None
    check(fr is not None and fr.status_code == 200 and fr.json().get("status") == "filed", "R6.5: a draft drawback claim is filed with DEDO")

    # R6.6: bank PRC file batches + Mushak 9.3 / 9.4 applications (compat), persisted in PostgreSQL
    print("R6.6: PRC batches, return applications")
    pv = arif.get(f"{BASE}/vat/proceeds").json()
    check(pv.get("outstanding", {}).get("count", 0) >= 1 and any(b.get("no") == "PB-09260004" and b.get("status") == "reversed" for b in pv.get("batches", [])), "R6.6: proceeds overview + seeded batches served from PostgreSQL")
    target = next((o for o in pv.get("open", []) if o.get("outstandingFc", 0) >= 2), None)
    prc_no = f"PRC/N/{TAG}".upper()
    pb = arif.post(f"{BASE}/vat/proceeds/batches", json={"fileName": f"native-{TAG}.csv", "rows": [{"line": 2, "date": "2026-09-25", "prcNo": prc_no, "currency": target["currency"], "fcAmount": 1, "rate": target["rate"],
                                                         "allocations": [{"saleId": target["saleId"], "fcAmount": 1, "basis": "manual"}]}]}) if target else None
    pb_id = pb.json().get("id") if pb is not None and pb.status_code == 201 else None
    check(pb_id is not None, f"R6.6: a bank-file batch posts (HTTP {pb.status_code if pb is not None else '-'})")
    check(arif.post(f"{BASE}/vat/proceeds/match", json={"rows": [{"line": 2, "date": "2026-09-25", "prcNo": prc_no, "currency": "USD", "fcAmount": 1, "rate": 122}]}).json().get("rows", [{}])[0].get("state") == "duplicate", "R6.6: the posted PRC is a duplicate on re-import")
    lfs = arif.get(f"{BASE}/vat/late-filings").json()
    check({"lf1", "lf2"} <= {r["id"] for r in lfs.get("rows", [])}, "R6.6: seeded Mushak 9.3 applications served")
    am_id = None
    for per in ("2026-06", "2026-05", "2026-04", "2026-02", "2026-01"):
        r = arif.post(f"{BASE}/vat/return-amendments", json={"period": per, "reasonKind": "clerical", "description": f"Native check {TAG} — transposed digits", "noAudit": True,
                                                            "corrections": [{"note": 1, "field": "value", "to": 1234.56, "explanation": "Transposed digits"}]})
        if r.status_code == 201: am_id = r.json()["id"]; break
    fr = arif.post(f"{BASE}/vat/return-amendments/{am_id}/action", json={"action": "file", "date": "2026-09-25", "ref": f"NBR/N/{TAG}"}) if am_id else None
    check(fr is not None and fr.status_code == 200 and fr.json().get("status") == "filed", "R6.6: a Mushak 9.4 application is created and filed")

    # re-baseline: the R6.2 block above adds audit events for this run's tag (officer, access log, backups)
    before_ids = sorted(e["id"] for e in arif.get(f"{BASE}/audit", params={"q": TAG, "size": 50}).json()["data"])
    if RESTART:
        print("restart: everything survives")
        secs = restart()
        check(True, f"API restarted ({secs:.1f} s)")
        check(arif.get(f"{BASE}/me").status_code == 200, "sessions survive a restart (no re-login)")
        check(a.get(f"{BASE}/me").status_code == 200 and b.get(f"{BASE}/me").status_code == 401, "revocations survive a restart")
        check(arif.get(f"{BASE}/customers/{cid}").status_code == 200, "R5.2: customer still there (read from the parties table)")
        check(arif.get(f"{BASE}/vendors/{gid}").status_code == 404, "R5.2: a deleted party stays deleted across a restart")
        check(any(u["no"] == ud_body["no"] for u in arif.get(f"{BASE}/vat/uds").json().get("rows", [])), "compat: the UD still there")
        check(any(x["code"] == f"R5{TAG[:3]}" for x in arif.get(f"{BASE}/units").json()["data"]), "native: unit still there")
        check(arif.get(f"{BASE}/items/{iid}").json().get("remain") == 40, "R5.2: the SKU's stock survives a restart (counters are columns, not memory)")
        check(arif.get(f"{BASE}/master-items/{mid}").json().get("name") == f"R5 Master Renamed {TAG}", "R5.2: …and the master item kept its rename")
        me = arif.get(f"{BASE}/me").json()
        check(me["preferences"].get("density") == "compact" and me["preferences"].get("accent") == "violet", "preferences still there")
        check(any(x["name"] == f"R5 view {TAG}" for x in arif.get(f"{BASE}/me/views", params={"table": "sales"}).json()), "saved view still there")
        after = arif.get(f"{BASE}/audit", params={"q": TAG, "size": 50}).json()
        check(sorted(e["id"] for e in after["data"]) == before_ids, "audit events unchanged (same ids)")
        r = requests.post(f"{BASE}/auth/login", json={"username": wname, "password": w["tempPassword"]})
        check(r.status_code == 429, "lockout survives a restart")
        check(requests.post(f"{BASE}/auth/login", json={"username": name, "password": new_pw}).status_code == 200, "changed password survives a restart")
        n = arif.post(f"{BASE}/customers", json={"name": f"R5 After Restart {TAG}", "mode": "Foreign", "country": "Japan", "address": "4-5-6 Shibuya, Tokyo"})
        check(n.status_code == 201 and n.json()["id"] != cid, "new records after a restart get fresh ids")
        if DB_URL:
            check(psql(f"select count(*) from parties where id = '{gid}' and deleted_at is not null") == "1", "R5.2: the trash is rebuilt from the table, not from the snapshot")
        check(arif.get(f"{BASE}/vat/bond").json().get("totals") == bond.get("totals"), "R6.4: bond register unchanged after a restart")
        u_after = arif.get(f"{BASE}/vat/bond-uds/{ud_id}").json() if ud_id else {}
        c_after = arif.get(f"{BASE}/vat/drawback-claims/{claim_id}").json() if claim_id else {}
        check((u_after.get("settlement") or {}).get("bondRef") == f"CBC/N/{TAG}" and c_after.get("status") == "filed" and c_after.get("dedoRef") == f"DEDO/N/{TAG}",
              "R6.5: UD settlement and filed claim survive a restart")
        b_after = arif.get(f"{BASE}/vat/proceeds/batches/{pb_id}").json() if pb_id else {}
        a_after = arif.get(f"{BASE}/vat/return-amendments/{am_id}").json() if am_id else {}
        check(b_after.get("status") == "posted" and b_after.get("lines", [{}])[0].get("prcNo") == prc_no and a_after.get("status") == "filed" and a_after.get("filedRef") == f"NBR/N/{TAG}",
              "R6.6: PRC batch and filed 9.4 application survive a restart")
        rv = arif.post(f"{BASE}/vat/proceeds/batches/{pb_id}/reverse", json={"date": "2026-09-25", "reason": f"Native reversal {TAG}"}) if pb_id else None
        check(rv is not None and rv.status_code == 200 and rv.json().get("status") == "reversed", "R6.6: the batch reverses after a restart")
        bl = admin.get(f"{BASE}/backups").json()
        check(any(x["id"] == bid for x in bl.get("rows", [])), "R6.2: backups survive a restart")
        v2 = arif.get(f"{BASE}/audit/verify").json()
        check(v2.get("ok") is True and v2.get("count", 0) > v.json().get("count", 0), "R6: the chain continues across a restart")

        # R6.4.1: Render overlaps the old and the new instance during a deploy. When the new one re-seeds, the old
        # one must refuse to write (its in-memory state is stale) instead of chaining audit events to a replaced head
        # or upserting its snapshot over the fresh demo data.
        print("\nR6.4.1: deploy overlap — the database is re-seeded under a running instance")
        epoch = psql("select value from meta where key = 'seeded_at'")
        events_before = psql("select count(*) from audit_events")
        psql("update meta set value = '2099-01-01T00:00:00.000Z' where key = 'seeded_at'")
        try:
            w = arif.post(f"{BASE}/customers", json={"name": f"R6 Stale Write {TAG}", "mode": "Foreign", "country": "Japan", "address": "1-2-3 Ginza, Tokyo"})
            check(w.status_code == 503, f"stale instance refuses a native party write after a re-seed elsewhere (HTTP {w.status_code})")
            check(psql(f"select count(*) from parties where name like '%R6 Stale Write {TAG}%'") == "0", "R5.2: the refused party never reached the parties table")
            wi = arif.post(f"{BASE}/items", json={**item_body, "name": f"R6 Stale Item {TAG}", "sku": f"R6-SW-{TAG}"})
            check(wi.status_code == 503, f"R5.2: stale instance refuses a native SKU write (HTTP {wi.status_code})")
            check(psql(f"select count(*) from items where sku = 'R6-SW-{TAG}'") == "0", "R5.2: the refused SKU never reached the items table")
            wu = arif.post(f"{BASE}/vat/uds", json={**ud_body, "no": f"BKMEA/UD/2026/SW{TAG}".upper(), "masterLcNo": f"EXP-LC-SW-{TAG}"})
            check(wu.status_code == 503, f"stale instance refuses a compat write after a re-seed elsewhere (HTTP {wu.status_code})")
            check(psql(f"select count(*) from compat_state where data::text like '%R6 Stale Write {TAG}%'") == "0", "stale snapshot not written over the re-seeded data")
            r = requests.post(f"{BASE}/auth/login", json={"username": "farzana", "password": PW})
            check(r.status_code == 503, f"stale instance refuses to append to the audit chain (HTTP {r.status_code})")
            check(psql("select count(*) from audit_events") == events_before, "no audit event chained to a replaced head")
        finally:
            psql(f"update meta set value = '{epoch}' where key = 'seeded_at'")
        restart()  # drop the diverged in-memory state
        v3 = arif.get(f"{BASE}/audit/verify").json()
        cl = arif.get(f"{BASE}/customers", params={"q": f"R6 Stale Write {TAG}"}).json()
        cl = cl.get("data", []) if isinstance(cl, dict) else cl
        uds_after = arif.get(f"{BASE}/vat/uds").json().get("rows", [])
        stale_items = arif.get(f"{BASE}/items", params={"q": f"R6 Stale Item {TAG}"}).json()
        check(v3.get("ok") is True and not any(f"R6 Stale Write {TAG}" in (c.get("name") or "") for c in cl)
              and not any(f"SW{TAG}".upper() in (u.get("no") or "") for u in uds_after) and stale_items.get("total", 0) == 0,
              "after a restart: chain intact, all three refused writes absent")

        # R5.2: the upgrade a customer installation takes — a database written before the migration still carries its
        # master data inside compat_state, and the first boot on this code has to move it into the tables without
        # losing a record (no re-seed: SEED_VERSION is unchanged, so the data on disk is all there is).
        print("\nR5.2: upgrading a pre-R5.2 database moves the master data into their tables")
        counts = lambda: (psql("select count(*) from parties"), psql("select count(*) from parties where deleted_at is not null"),
                          psql("select count(*) from items"), psql("select count(*) from master_items"))
        registers = lambda: {k: arif.get(f"{BASE}/{k}", params=q).json() for k, q in
                             (("customers", {"view": "table", "size": 200}), ("vendors", {"view": "table", "size": 200}),
                              ("items", {"size": 500}), ("master-items", {"size": 500}))}
        def upgraded_boots():
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as f:
                return sum(1 for line in f if "R5.2 upgrade:" in line)
        had, before, boots = counts(), registers(), upgraded_boots()
        psql(PRE_R52_COLLECTIONS)
        psql(PRE_R52_TRASH)
        psql("delete from parties")
        psql("delete from items")
        psql("delete from master_items")
        check(counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'customers' and data->'db' ? 'vendors' "
                       "and data->'db' ? 'items' and data->'db' ? 'masterItems'") == "1",
              f"the database is back in the pre-R5.2 shape ({had[0]} parties, {had[2]} SKUs, {had[3]} master items inside the snapshot)")
        restart()
        check(counts() == had, f"the first boot moved every record into the tables (parties {had[0]} incl. {had[1]} deleted, items {had[2]}, master items {had[3]})")
        check(psql("select count(*) from compat_state where data->'db' ? 'customers' or data->'db' ? 'vendors' "
                   "or data->'db' ? 'items' or data->'db' ? 'masterItems'") == "0",
              "…and rewrote the snapshot without them")
        check(psql(PARTY_TRASH_LEFT) == "0", "…and took the deleted parties out of the undo buffer, keeping its documents")
        check(registers() == before, "…and serves the same four registers, row for row")
        check(psql(f"select count(*) from parties where id = '{gid}' and deleted_at is not null") == "1"
              and arif.get(f"{BASE}/vendors/{gid}").status_code == 404, "a party deleted before the upgrade is still in the trash")
        check(arif.post(f"{BASE}/vendors/{gid}/restore").status_code == 200, "…and its undo still works afterwards")
        boots_after, now = upgraded_boots(), counts()
        restart()
        check(counts() == now and (boots is None or boots_after == boots + 1) and (boots is None or upgraded_boots() == boots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        w = arif.post(f"{BASE}/customers", json={"name": f"R5 Upgraded {TAG}", "mode": "Foreign", "country": "Japan", "address": "1-2-3 Ginza, Tokyo"})
        check(w.status_code == 201 and psql(f"select count(*) from parties where id = '{w.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({w.status_code})")
    else:
        skipped("restart checks (API_RESTART_CMD not set)")

    print(f"\n{ok} passed, {fail} failed, {skip} skipped")
    return fail == 0


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
