# Backup and restore — procedure and drill (R6.3)

General Order 16/Mushak/2019 asks enlisted VAT software for **at least two backups of transaction data a day**. A
backup only counts once it has been restored, so DiziVAT ships a restore tool and runs a **restore drill** on every CI
build. This page is the runbook for IT.

## 1. Targets

| | Target | How |
|---|---|---|
| RPO (data that may be lost) | ≤ 12 hours | scheduled backups at 02:00 and 14:00 Asia/Dhaka, plus *Back up now* before risky work; Neon point-in-time recovery narrows this further |
| RTO (time to be back) | ≤ 1 hour | restore into a fresh database (a demo-sized database restores in seconds), point the service at it, admin resets passwords |
| Retention | last 30 backups (15 days) in the database | download copies (`.json.gz`) for off-site storage; keep tax records 5 years |
| Proof | a passed drill at least monthly, and after every schema change | *Master data › Backups › Last restore drill* |

## 2. What a backup contains

`dizivat-backup/1`: gzip JSON of every table — documents, masters, settings, users **without password hashes**, and the
audit trail with its hash chain. Sessions and lockouts are left out. Each backup's SHA-256 is stored with it; a
download carries it in `X-Backup-SHA256`.

## 3. Restore

```bash
cd api && npm ci && npm run build            # builds dist/main.js and dist/restore.js
# from a backup stored in the live database (newest, or --id bkN):
node dist/restore.js --source "$DATABASE_URL" --id bk42 \
  --target "postgresql://user:pw@host:5432/dizivat_restored" --create \
  --admin-password 'a-new-strong-password' --boot --report restore.json
# from a downloaded file:
node dist/restore.js --source dizivat-backup-bk42.json.gz --sha256 <X-Backup-SHA256> \
  --target "postgresql://user:pw@host:5432/dizivat_restored" --create --admin-password '…' --boot
```

| Option | Meaning |
|---|---|
| `--source` | the database whose `backups` table holds the snapshot, or a downloaded `.json.gz` |
| `--id bkN` | which stored backup (default: the newest) |
| `--sha256` | expected checksum for a file source |
| `--target` | the database to restore into — **must be empty**; the tool refuses a non-empty one |
| `--create` | create the target database first (needs the CREATEDB right) |
| `--admin-user` / `--admin-password` | the admin account that gets a new password (default: the first active admin) |
| `--boot` | start the API on the restored copy, check health, sign in as that admin and list the sales invoices |
| `--drop-after` | drop the target at the end (drills) |
| `--record` | store the result in the source database (shown on *Backups*) |
| `--report FILE` | write the result as JSON |

Exit code 0 = every check passed, 1 = a check failed, 2 = bad arguments.

### Checks the tool runs

1. SHA-256 of the snapshot matches the stored / given value.
2. Schema migrations run on the target; every table loads in **one transaction** (all or nothing).
3. Row count of every table equals the snapshot; every document collection (sales, purchases, adjustments, UDs …)
   has the same number of records.
4. The **audit chain** verifies end to end on the restored rows.
5. With `--boot`: the API starts on the copy, `/health` answers, the admin signs in, `/sales` lists every invoice.

### After a real restore

1. Point the service at the restored database (`DATABASE_URL`) and restart it.
2. Sign in as the admin with `--admin-password`; **reset every other account** (*Master data › Users › Reset
   password*) — their old passwords are not in the backup and they are asked to change the temporary one.
3. Re-enter anything recorded after the backup's time from the paper or ERP records; the period lock still applies.
4. Take a new backup and note the incident (time, backup used, records re-entered).

## 4. The drill

```bash
node dist/restore.js --source "$DATABASE_URL" --target "postgresql://…/dizivat_drill" \
  --create --admin-password "drill-$(date +%s)" --boot --drop-after --record
```

The drill restores the newest backup into a throw-away database, runs every check above, drops it and records the
result. *Master data › Backups* then shows **Last restore drill** — passed / failed, when, which backup, tables, rows,
documents, audit chain, app start and time taken (`GET /api/v1/backups` → `drill`).

- **CI:** `scripts/api_native.py` takes a backup and runs a full drill (`--create --admin-password --boot --drop-after
  --record`) against PostgreSQL on every push; the deploy is blocked if it fails. It also checks the tool refuses a
  non-empty target.
- **Live:** run the drill monthly from a machine that can reach the database (Render shell or a laptop with the Neon
  URL). Use a separate Neon branch as the target when the main role may not create databases.

## 5. Checklist

- [ ] Two scheduled backups yesterday (*Backups* list), newest verified.
- [ ] A download of the newest backup stored off-site this week.
- [ ] Last restore drill passed within 30 days.
- [ ] After a schema change (new migration): drill passed on the new version.
