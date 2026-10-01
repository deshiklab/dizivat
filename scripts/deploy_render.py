#!/usr/bin/env python3
"""DiziVAT continuous deployment to Render (standard library only).

Used by the `deploy` job of .github/workflows/backend.yml after every green push to the deploy branch:

  wait-ci  --sha SHA [--workflow CI]            wait until the other workflow(s) for SHA finished; fail unless success
  trigger                                       call the Render deploy hook (RENDER_DEPLOY_HOOK_URL); prints the deploy id
  verify   --base URL --sha SHA [--version V]   wait until the live /api/v1/health reports SHA, then smoke-test the site
           [--since EPOCH] [--timeout S]
  smoke    --base URL                           smoke tests only (no waiting), e.g. against a local or the live server

Optional: RENDER_API_KEY lets `verify` follow the Render deploy itself and fail fast on build_failed / update_failed.
Smoke login: SMOKE_USER / SMOKE_PASSWORD (default: the demo approver arif / demo1234).
Results are appended to $GITHUB_STEP_SUMMARY when it is set.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "dizivat-deploy/1.0"}


def summary(md: str) -> None:
    print(md)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(md + "\n")


def annotate(level: str, msg: str) -> None:
    """GitHub Actions annotation (level: notice | warning | error)."""
    print(f"::{level}::{msg}" if os.environ.get("GITHUB_ACTIONS") else f"[{level}] {msg}")


def request(url: str, method: str = "GET", body: dict | None = None, headers: dict | None = None,
            opener: urllib.request.OpenerDirector | None = None, timeout: int = 60):
    """Returns (status, parsed JSON or text, final URL). Network errors → status 0."""
    data = json.dumps(body).encode() if body is not None else None
    h = {**UA, **(headers or {})}
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with (opener or urllib.request.build_opener()).open(req, timeout=timeout) as r:
            raw, status, final = r.read(), r.status, r.geturl()
    except urllib.error.HTTPError as e:
        raw, status, final = e.read(), e.code, url
    except Exception as e:  # noqa: BLE001 — DNS, reset, timeout while the service restarts
        return 0, str(e), url
    text = raw.decode("utf-8", "replace")
    try:
        return status, json.loads(text), final
    except ValueError:
        return status, text, final


# ── wait-ci ──────────────────────────────────────────────────────────────────────────────────────────────────────
def wait_ci(sha: str, workflows: list[str], timeout: int) -> int:
    repo, token = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"]
    hdr = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    url = f"https://api.github.com/repos/{repo}/actions/runs?head_sha={sha}&per_page=50"
    deadline, last = time.time() + timeout, ""
    while time.time() < deadline:
        status, data, _ = request(url, headers=hdr)
        runs = data.get("workflow_runs", []) if status == 200 and isinstance(data, dict) else []
        state = {}
        for name in workflows:
            # newest run of that workflow for this commit (re-runs replace earlier attempts)
            mine = sorted((r for r in runs if r["name"] == name and r["event"] in ("push", "workflow_dispatch")),
                          key=lambda r: r["run_number"] * 1000 + r.get("run_attempt", 1), reverse=True)
            state[name] = (mine[0]["status"], mine[0]["conclusion"], mine[0]["html_url"]) if mine else ("missing", None, "")
        line = ", ".join(f"{n}: {s}/{c}" for n, (s, c, _) in state.items())
        if line != last:
            print(time.strftime("%H:%M:%S"), line, flush=True)
            last = line
        failed = [(n, c, u) for n, (s, c, u) in state.items() if s == "completed" and c != "success"]
        if failed:
            for n, c, u in failed:
                annotate("error", f"{n} finished with '{c}' for {sha[:7]} — not deploying. {u}")
            return 1
        if all(s == "completed" for s, _, _ in state.values()):
            summary(f"- Required workflows green for `{sha[:7]}`: " + ", ".join(f"[{n}]({u})" for n, (_, _, u) in state.items()))
            return 0
        time.sleep(30)
    annotate("error", f"Timed out after {timeout}s waiting for {', '.join(workflows)} on {sha[:7]}")
    return 1


# ── trigger ──────────────────────────────────────────────────────────────────────────────────────────────────────
def trigger() -> int:
    hook = os.environ.get("RENDER_DEPLOY_HOOK_URL", "").strip()
    if not hook:
        annotate("error", "RENDER_DEPLOY_HOOK_URL is not set (repository secret).")
        return 1
    for attempt in range(1, 4):
        status, data, _ = request(hook, method="POST")
        if 200 <= status < 300:
            dep = (data.get("deploy") or {}).get("id", "") if isinstance(data, dict) else ""
            summary(f"- Render deploy triggered{f' (`{dep}`)' if dep else ''} at {time.strftime('%H:%M:%S UTC', time.gmtime())}")
            out = os.environ.get("GITHUB_OUTPUT")
            if out:
                with open(out, "a") as f:
                    f.write(f"deploy_id={dep}\nsince={int(time.time())}\n")
            return 0
        annotate("warning", f"deploy hook answered {status} (attempt {attempt}/3)")
        time.sleep(10 * attempt)
    annotate("error", "Render deploy hook failed 3 times — check the secret (Render → service → Settings → Deploy Hook).")
    return 1


def render_deploy_status(deploy_id: str) -> str | None:
    """Status of a Render deploy via the REST API (needs RENDER_API_KEY); None when unavailable."""
    key, hook = os.environ.get("RENDER_API_KEY", "").strip(), os.environ.get("RENDER_DEPLOY_HOOK_URL", "")
    m = re.search(r"/deploy/(srv-[a-z0-9]+)", hook)
    if not (key and deploy_id and m):
        return None
    status, data, _ = request(f"https://api.render.com/v1/services/{m.group(1)}/deploys/{deploy_id}",
                              headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    return data.get("status") if status == 200 and isinstance(data, dict) else None


# ── verify / smoke ───────────────────────────────────────────────────────────────────────────────────────────────
def wait_live(base: str, sha: str, version: str | None, since: int, timeout: int, deploy_id: str) -> int:
    """Waits until the running build is the one just deployed: health.commit == sha, or (when the platform does not
    expose the commit) the expected version on a process started after the deploy was triggered."""
    deadline, last, t0 = time.time() + timeout, "", time.time()
    while time.time() < deadline:
        st = render_deploy_status(deploy_id)
        if st in ("build_failed", "update_failed", "canceled", "pre_deploy_failed", "deactivated"):
            annotate("error", f"Render deploy {deploy_id} ended with status '{st}' — see the Render dashboard logs.")
            return 1
        status, h, _ = request(f"{base}/api/v1/health", timeout=90)
        if status == 200 and isinstance(h, dict):
            live_commit, up = h.get("commit"), h.get("uptime", 10**9)
            fresh = up <= time.time() - since + 5
            ok = (live_commit == sha) if live_commit else (fresh and (version is None or h.get("version") == version))
            line = f"live: version {h.get('version')}, commit {(live_commit or '—')[:7]}, uptime {up}s" + (f", render {st}" if st else "")
            if line != last:
                print(time.strftime("%H:%M:%S"), line, flush=True)
                last = line
            if ok:
                summary(f"- Live after {int(time.time() - t0)} s: version **{h.get('version')}**, commit `{(live_commit or sha)[:7]}`"
                        + ("" if live_commit else " (matched by version + restart time; the platform did not report the commit)"))
                return 0
        else:
            line = f"health → {status or 'no answer'} (service restarting or waking up)"
            if line != last:
                print(time.strftime("%H:%M:%S"), line, flush=True)
                last = line
        time.sleep(20)
    annotate("error", f"Timed out after {timeout}s: {base} is not serving {sha[:7]}. Last: {last}")
    return 1


def smoke(base: str) -> int:
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    user, pw = os.environ.get("SMOKE_USER", "arif"), os.environ.get("SMOKE_PASSWORD", "demo1234")
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> bool:
        results.append((name, ok, detail))
        print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)
        return ok

    s, h, _ = request(f"{base}/api/v1/health", opener=op, timeout=90)
    check("health: ok + database", s == 200 and isinstance(h, dict) and h.get("ok") and (h.get("db") or {}).get("ok"),
          f"HTTP {s}" + (f", version {h.get('version')}, {h.get('modules')}" if isinstance(h, dict) else ""))
    s, body, _ = request(f"{base}/en/login", opener=op)
    check("login page renders", s == 200 and isinstance(body, str) and "DiziVAT" in body, f"HTTP {s}")
    s, body, _ = request(f"{base}/api/v1/auth/login", "POST", {"username": user, "password": pw}, opener=op)
    if check(f"sign in as {user}", s == 200, f"HTTP {s}"):
        s, me, _ = request(f"{base}/api/v1/me", opener=op)
        check("session: /me", s == 200 and isinstance(me, dict), f"HTTP {s}")
        # the web server must accept the API's session (same SESSION_SECRET) — otherwise every page bounces to /login
        s, body, final = request(f"{base}/en", opener=op)
        check("dashboard opens with the session", s == 200 and "/login" not in final, f"HTTP {s}, {final.replace(base, '')}")
        s, v, _ = request(f"{base}/api/v1/audit/verify", opener=op, timeout=120)
        check("audit hash chain verifies", s == 200 and isinstance(v, dict) and v.get("ok") is True,
              f"HTTP {s}" + (f", {v.get('count')} events" if isinstance(v, dict) and "count" in v else (f", {v}" if isinstance(v, dict) else "")))
        s, ex, _ = request(f"{base}/api/v1/vat/exports", opener=op)
        check("export & deemed-export register", s == 200 and isinstance(ex, dict) and "totals" in ex, f"HTTP {s}")
        s, _, _ = request(f"{base}/api/v1/vat/compliance", opener=op)
        check("compliance centre", s == 200, f"HTTP {s}")
        s, _, _ = request(f"{base}/api/v1/auth/logout", "POST", {}, opener=op)
        check("sign out", s == 200, f"HTTP {s}")

    passed = sum(ok for _, ok, _ in results)
    summary(f"\n**Smoke tests on {base}: {passed}/{len(results)} passed**\n\n| Check | Result | Detail |\n|---|---|---|\n"
            + "\n".join(f"| {n} | {'✅' if ok else '❌'} | {d} |" for n, ok, d in results))
    return 0 if passed == len(results) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("wait-ci")
    w.add_argument("--sha", required=True)
    w.add_argument("--workflow", action="append", default=None)
    w.add_argument("--timeout", type=int, default=3600)
    sub.add_parser("trigger")
    v = sub.add_parser("verify")
    v.add_argument("--base", required=True)
    v.add_argument("--sha", required=True)
    v.add_argument("--version")
    v.add_argument("--since", type=int, default=int(time.time()))
    v.add_argument("--deploy-id", default="")
    v.add_argument("--timeout", type=int, default=1800)
    s = sub.add_parser("smoke")
    s.add_argument("--base", required=True)
    a = ap.parse_args()

    if a.cmd == "wait-ci":
        return wait_ci(a.sha, a.workflow or ["CI"], a.timeout)
    if a.cmd == "trigger":
        return trigger()
    if a.cmd == "verify":
        base = a.base.rstrip("/")
        return wait_live(base, a.sha, a.version, a.since, a.timeout, a.deploy_id) or smoke(base)
    return smoke(a.base.rstrip("/"))


if __name__ == "__main__":
    sys.exit(main())
