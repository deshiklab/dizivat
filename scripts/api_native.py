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
ok = fail = skip = 0
TAG = uuid.uuid4().hex[:6]


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
    check(cust.status_code == 201, f"compat: customer created ({cust.status_code})")
    cid = cust.json().get("id")
    unit = arif.post(f"{BASE}/units", json={"code": f"R5{TAG[:3]}", "name": "R5 test unit", "decimals": 1, "active": True})
    check(unit.status_code == 201 and unit.json()["id"].startswith("un"), "native: unit created")
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
        check(psql(f"select count(*) from compat_state where data::text ilike '%R5 Persist Test {TAG}%'") == "1", "compat documents are saved in compat_state")
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

    # re-baseline: the R6.2 block above adds audit events for this run's tag (officer, access log, backups)
    before_ids = sorted(e["id"] for e in arif.get(f"{BASE}/audit", params={"q": TAG, "size": 50}).json()["data"])
    if RESTART:
        print("restart: everything survives")
        secs = restart()
        check(True, f"API restarted ({secs:.1f} s)")
        check(arif.get(f"{BASE}/me").status_code == 200, "sessions survive a restart (no re-login)")
        check(a.get(f"{BASE}/me").status_code == 200 and b.get(f"{BASE}/me").status_code == 401, "revocations survive a restart")
        check(arif.get(f"{BASE}/customers/{cid}").status_code == 200, "compat: customer still there")
        check(any(x["code"] == f"R5{TAG[:3]}" for x in arif.get(f"{BASE}/units").json()["data"]), "native: unit still there")
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
        check(arif.get(f"{BASE}/vat/bond").json().get("totals") == bond.get("totals"), "R6.4: bond register unchanged after a restart")
        bl = admin.get(f"{BASE}/backups").json()
        check(any(x["id"] == bid for x in bl.get("rows", [])), "R6.2: backups survive a restart")
        v2 = arif.get(f"{BASE}/audit/verify").json()
        check(v2.get("ok") is True and v2.get("count", 0) > v.json().get("count", 0), "R6: the chain continues across a restart")
    else:
        skipped("restart checks (API_RESTART_CMD not set)")

    print(f"\n{ok} passed, {fail} failed, {skip} skipped")
    return fail == 0


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
