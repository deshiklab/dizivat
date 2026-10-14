"""
R5 backend checks (NestJS + PostgreSQL, branch r5-nestjs) — what the stateless mock could not do.

Runs through the Next.js frontend (BASE_URL, default http://localhost:3000), which proxies /api/v1 to the API.
  API_RESTART_CMD  shell command that restarts the API and returns once it is healthy (enables the restart checks)
  DATABASE_URL     enables the direct database checks (needs `psql`)
  SESSION_SECRET   enables the forged-token check (must equal the API's secret)
Run on a freshly seeded database (`node api/dist/main.js --reset`); it creates its own users and records.
"""
import base64, datetime, hashlib, hmac, json, math, os, subprocess, sys, time, uuid
import re
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000") + "/api/v1"
PW = "demo1234"
RESTART = os.environ.get("API_RESTART_CMD")
DB_URL = os.environ.get("DATABASE_URL")
SECRET = os.environ.get("SESSION_SECRET")
API_LOG = os.environ.get("API_LOG")
ok = fail = skip = 0
TAG = uuid.uuid4().hex[:6]


def natkey(s: str):
    """The order the API serves SKUs in: the natural (numeric-aware) collation — 'A2' before 'A10' —
    so the oracle is a numeric-aware key, not the codepoint order (random tags diverge on that one)."""
    return [(1, int(t)) if t.isdigit() else (0, t) for t in re.split(r"(\d+)", s)]

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

# ── R5.3 upgrade drill ─────────────────────────────────────────────────────────────────────────────────────────
# The same, one release later: a database written before R5.3 holds its stock documents (transfers and damage
# entries, lines included) inside compat_state and has no stock_documents rows. These statements rebuild that shape
# from the live tables, so the first boot on this code has to adopt it. Nothing here ships either: it is the inverse
# of the stock-document half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
STOCK_LINES_DOC = """(select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'sku', l.sku, 'uom', l.uom, 'qty', l.qty, 'cost', l.cost, 'value', l.value)
      order by l.ord), '[]'::jsonb) from stock_document_lines l where l.doc_id = d.id)"""
STOCK_DOC = _NO_NULLS.format("""jsonb_build_object(
    'kind', kind, 'id', id, 'no', no, 'date', date, 'process', process, 'lines', """ + STOCK_LINES_DOC + """,
    'totalQty', total_qty, 'totalValue', total_value, 'note', note,
    'fromBranchId', case when kind = 'transfer' then from_branch_id end,
    'fromBranch', case when kind = 'transfer' then from_branch end,
    'toBranchId', to_branch_id, 'toBranch', to_branch, 'vehicle', vehicle,
    'branchId', case when kind = 'damage' then from_branch_id end,
    'branch', case when kind = 'damage' then from_branch end, 'reason', reason,
    'issuedBy', issued_by, 'createdAt', """ + _ISO.format("created_at") + """,
    'updatedAt', """ + _ISO.format("updated_at") + """, 'cancelReason', cancel_reason, 'history', history)""")
STOCK_AGG = lambda kind: (f"(select coalesce(jsonb_agg({STOCK_DOC} order by ord), '[]'::jsonb) "
                          f"from stock_documents d where kind = '{kind}')")
# both collections back inside the snapshot
PRE_R53_COLLECTIONS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'transfers', {STOCK_AGG('transfer')},
  'damages', {STOCK_AGG('damage')}
)) where key = 'main'"""

# ── R5.3 upgrade drill: the sales invoices ────────────────────────────────────────────────────────────────────
# A database written before the invoices had tables holds them inside compat_state — lines and proceeds entries
# included, a deleted draft in the undo buffer. These statements rebuild that shape from the live tables, so the
# first boot on this code has to adopt it. Nothing here ships either: it is the inverse of the sales half of
# `adoptCompatRows()` in api/src/boot.ts, for the test only.
SALE_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'hsCode', l.hs_code, 'uom', l.uom, 'qty', l.qty, 'price', l.price,
      'sdRate', l.sd_rate, 'vatRate', l.vat_rate, 'subtotal', l.subtotal, 'sd', l.sd, 'vat', l.vat, 'total', l.total,
      'batchId', l.batch_id, 'batchNo', l.batch_no)""")
    + """ order by l.ord), '[]'::jsonb) from sale_lines l where l.sale_id = s.id)""")
SALE_REALS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'id', r.id, 'date', r.date, 'bank', r.bank, 'prcNo', r.prc_no, 'fcAmount', r.fc_amount, 'rate', r.rate,
      'bdt', r.bdt, 'note', r.note, 'by', r.by, 'at', """ + _ISO.format("r.at") + """, 'batchId', r.batch_id)""")
    + """ order by r.ord), '[]'::jsonb) from sale_realisations r where r.sale_id = s.id)""")
# the shipping documents are columns of the invoice; `export_deemed` is the block's presence marker
SALE_EXPORT_DOC = ("""(case when s.export_deemed is null then null else """
    + _NO_NULLS.format("""jsonb_build_object(
      'deemed', s.export_deemed, 'lcNo', s.export_lc_no, 'lcDate', s.export_lc_date,
      'customsHouse', s.export_customs_house, 'country', s.export_country, 'billNo', s.export_bill_no,
      'billDate', s.export_bill_date, 'shippingAddress', s.export_shipping_address, 'cnfFirm', s.export_cnf_firm,
      'udNo', s.export_ud_no, 'udDate', s.export_ud_date, 'expNo', s.export_exp_no, 'currency', s.export_currency,
      'fcValue', s.export_fc_value, 'exchangeRate', s.export_exchange_rate, 'exporterBond', s.export_exporter_bond,
      'ownUdNo', s.export_own_ud_no,
      'realisations', case when s.export_realisations then """ + SALE_REALS_DOC + """ else null end)""")
    + " end)")
SALE_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', s.id, 'invoiceNo', s.invoice_no, 'challanNo', s.challan_no, 'issueDate', s.issue_date,
    'issueTime', s.issue_time, 'process', s.process, 'category', s.category, 'branchId', s.branch_id,
    'branchName', s.branch_name, 'customerId', s.customer_id, 'customerName', s.customer_name,
    'customerBin', s.customer_bin, 'customerAddress', s.customer_address, 'deliveryAddress', s.delivery_address,
    'vehicle', s.vehicle, 'mode', s.mode, 'method', s.method, 'vds', s.vds, 'subtotal', s.subtotal, 'sd', s.sd,
    'vat', s.vat, 'discount', s.discount, 'netTotal', s.net_total, 'paid', s.paid, 'due', s.due,
    'lines', """ + SALE_LINES_DOC + """, 'issuedBy', s.issued_by, 'designation', s.designation,
    'narration', s.narration, 'createdAt', """ + _ISO.format("s.created_at") + """,
    'updatedAt', """ + _ISO.format("s.updated_at") + """, 'cancelReason', s.cancel_reason, 'history', s.history,
    'export', """ + SALE_EXPORT_DOC + """)""") + ")")
SALE_AGG = f"(select coalesce(jsonb_agg({SALE_DOC} order by s.ord), '[]'::jsonb) from sales s where s.deleted_at is null)"
# the invoices back inside the snapshot …
PRE_R53_SALES = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'sales', {SALE_AGG}
)) where key = 'main'"""
# … and the deleted drafts back into the undo buffer, keeping the documents already in it
PRE_R53_SALE_TRASH = f"""update compat_state set data = jsonb_set(data, '{{db,trash}}',
  coalesce(data->'db'->'trash', '[]'::jsonb) || (
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'sale', 'doc', doc, 'at', {_ISO.format('deleted_at')})
                              order by deleted_at), '[]'::jsonb)
    from (select s.deleted_at, {SALE_DOC} as doc from sales s where s.deleted_at is not null) t),
  true) where key = 'main'"""
SALE_TRASH_LEFT = """select count(*) from compat_state where jsonb_typeof(data->'db'->'trash') = 'array'
  and exists (select 1 from jsonb_array_elements(data->'db'->'trash') t where t->>'kind' = 'sale')"""

# ── R5.3 upgrade drill: the purchases ────────────────────────────────────────────────────────────────────────
# A database written before the purchases had tables holds them inside compat_state — lines, Bills of Entry and the
# duty breakdown of every import line included, a deleted draft in the undo buffer. These statements rebuild that
# shape from the live tables, so the first boot on this code has to adopt it. Nothing here ships either: it is the
# inverse of the purchase half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
PURCHASE_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'hsCode', l.hs_code, 'uom', l.uom, 'qty', l.qty, 'price', l.price,
      'sdRate', l.sd_rate, 'vatRate', l.vat_rate, 'subtotal', l.subtotal, 'sd', l.sd, 'vat', l.vat, 'total', l.total,
      'rebateable', l.rebateable, 'vds', l.vds, 'tti', l.tti,
      'duty', case when l.duty_av is null then null else """ + _NO_NULLS.format("""jsonb_build_object(
        'usd', l.duty_usd, 'usdRate', l.duty_usd_rate, 'av', l.duty_av, 'cdRate', l.duty_cd_rate, 'cd', l.duty_cd,
        'rdRate', l.duty_rd_rate, 'rd', l.duty_rd, 'aitRate', l.duty_ait_rate, 'ait', l.duty_ait,
        'atRate', l.duty_at_rate, 'at', l.duty_at,
        'foregone', case when l.foregone_total is null then null else jsonb_build_object(
          'cd', l.foregone_cd, 'rd', l.foregone_rd, 'sd', l.foregone_sd, 'vat', l.foregone_vat,
          'ait', l.foregone_ait, 'at', l.foregone_at, 'total', l.foregone_total) end)""") + """ end)""")
    + """ order by l.ord), '[]'::jsonb) from purchase_lines l where l.purchase_id = p.id)""")
# the Bill of Entry is a block of its own columns; `boe_no` is its presence marker
PURCHASE_BOE_DOC = ("""(case when p.boe_no is null then null else """ + _NO_NULLS.format("""jsonb_build_object(
      'no', p.boe_no, 'date', p.boe_date, 'lcNo', p.boe_lc_no, 'lcDate', p.boe_lc_date,
      'customsHouse', p.boe_customs_house, 'origin', p.boe_origin, 'cnfFirm', p.boe_cnf_firm,
      'receiveAddress', p.boe_receive_address, 'bonded', p.boe_bonded, 'udNo', p.boe_ud_no)""") + """ end)""")
PURCHASE_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', p.id, 'invoiceNo', p.invoice_no, 'challanNo', p.challan_no, 'challanDate', p.challan_date,
    'issueDate', p.issue_date, 'process', p.process, 'category', p.category, 'branchId', p.branch_id,
    'branchName', p.branch_name, 'vendorId', p.vendor_id, 'vendorName', p.vendor_name, 'vendorBin', p.vendor_bin,
    'vendorAddress', p.vendor_address, 'mode', p.mode, 'method', p.method, 'subtotal', p.subtotal, 'sd', p.sd,
    'vat', p.vat, 'discount', p.discount, 'netTotal', p.net_total, 'paid', p.paid, 'due', p.due, 'tti', p.tti,
    'rebate', p.rebate, 'lines', """ + PURCHASE_LINES_DOC + """, 'issuedBy', p.issued_by,
    'designation', p.designation, 'narration', p.narration, 'createdAt', """ + _ISO.format("p.created_at") + """,
    'updatedAt', """ + _ISO.format("p.updated_at") + """, 'cancelReason', p.cancel_reason, 'history', p.history,
    'boe', """ + PURCHASE_BOE_DOC + """)""") + ")")
PURCHASE_AGG = (f"(select coalesce(jsonb_agg({PURCHASE_DOC} order by p.ord), '[]'::jsonb) "
                f"from purchases p where p.deleted_at is null)")
# the purchases back inside the snapshot …
PRE_R53_PURCHASES = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'purchases', {PURCHASE_AGG}
)) where key = 'main'"""
# … and the deleted drafts back into the undo buffer, keeping the documents already in it
PRE_R53_PURCHASE_TRASH = f"""update compat_state set data = jsonb_set(data, '{{db,trash}}',
  coalesce(data->'db'->'trash', '[]'::jsonb) || (
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'purchase', 'doc', doc, 'at', {_ISO.format('deleted_at')})
                              order by deleted_at), '[]'::jsonb)
    from (select p.deleted_at, {PURCHASE_DOC} as doc from purchases p where p.deleted_at is not null) t),
  true) where key = 'main'"""
PURCHASE_TRASH_LEFT = """select count(*) from compat_state where jsonb_typeof(data->'db'->'trash') = 'array'
  and exists (select 1 from jsonb_array_elements(data->'db'->'trash') t where t->>'kind' = 'purchase')"""

# ── R5.4 upgrade drill: the opening stock entries ────────────────────────────────────────────────────────────
# A database written before the entries had a table holds them inside compat_state, the R6.4 bond block of a go-live
# entry included. These statements rebuild that shape from the live table, so the first boot on this code has to
# adopt it. Nothing here ships either: it is the inverse of the opening-stock half of `adoptCompatRows()` in
# api/src/boot.ts, for the test only.
OPENING_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', o.id, 'no', o.no, 'itemId', o.item_id, 'name', o.name, 'hsCode', o.hs_code, 'sku', o.sku, 'uom', o.uom,
    'branchId', o.branch_id, 'branchName', o.branch_name, 'date', o.date, 'inputTax', o.input_tax, 'qty', o.qty,
    'price', o.price, 'value', o.value, 'vatPaid', o.vat_paid, 'note', o.note,
    'bond', case when o.bond_boe_no is null then null else jsonb_build_object(
      'boeNo', o.bond_boe_no, 'boeDate', o.bond_boe_date, 'qty', o.bond_qty,
      'dutyForegone', o.bond_duty_foregone) end,
    'process', o.process, 'issuedBy', o.issued_by, 'createdAt', """ + _ISO.format("o.created_at") + """,
    'updatedAt', """ + _ISO.format("o.updated_at") + """, 'cancelReason', o.cancel_reason,
    'history', o.history)""") + ")")
OPENING_AGG = (f"(select coalesce(jsonb_agg({OPENING_DOC} order by o.ord), '[]'::jsonb) "
               f"from opening_entries o where o.deleted_at is null)")
# the entries back inside the snapshot (a deleted draft has no place there: the mock removed it for good)
PRE_R54_OPENINGS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'openings', {OPENING_AGG}
)) where key = 'main'"""

# ── R5.4 upgrade drill: the production batches ───────────────────────────────────────────────────────────────
# A database written before the batches had tables holds them inside compat_state, each with the finished goods it
# produced and the inputs it consumed. These statements rebuild that shape from the live tables, so the first boot
# on this code has to adopt it. Nothing here ships either: it is the inverse of the production half of
# `adoptCompatRows()` in api/src/boot.ts, for the test only.
BATCH_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'sku', l.sku, 'uom', l.uom, 'workOrderId', l.work_order_id,
      'workOrderNo', l.work_order_no, 'issueQty', l.issue_qty, 'receiveQty', l.receive_qty,
      'damageQty', l.damage_qty, 'bomId', l.bom_id, 'bomVersion', l.bom_version, 'unitCost', l.unit_cost,
      'value', l.value)""") + """ order by l.ord), '[]'::jsonb) from batch_lines l where l.batch_id = b.id)""")
BATCH_USE_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', c.item_id, 'name', c.name, 'sku', c.sku, 'uom', c.uom, 'qty', c.qty, 'price', c.price,
      'value', c.value)""") + """ order by c.ord), '[]'::jsonb) from batch_consumption c where c.batch_id = b.id)""")
BATCH_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', b.id, 'no', b.no, 'mode', b.mode, 'issueDate', b.issue_date, 'receiveDate', b.receive_date,
    'vendorId', b.vendor_id, 'vendorName', b.vendor_name, 'vendorBin', b.vendor_bin,
    'vendorAddress', b.vendor_address, 'address', b.address, 'jobProcess', b.job_process, 'remark', b.remark,
    'issuedBy', b.issued_by, 'designation', b.designation, 'issueTime', b.issue_time,
    'lines', """ + BATCH_LINES_DOC + """, 'consumption', """ + BATCH_USE_DOC + """,
    'totalIssue', b.total_issue, 'totalReceive', b.total_receive, 'totalDamage', b.total_damage,
    'materialValue', b.material_value, 'value', b.value, 'process', b.process,
    'receivedAt', """ + _ISO.format("b.received_at") + """, 'branchId', b.branch_id, 'branchName', b.branch_name,
    'createdAt', """ + _ISO.format("b.created_at") + """, 'updatedAt', """ + _ISO.format("b.updated_at") + """,
    'cancelReason', b.cancel_reason, 'history', b.history)""") + ")")
BATCH_AGG = (f"(select coalesce(jsonb_agg({BATCH_DOC} order by b.ord), '[]'::jsonb) "
             f"from batches b where b.deleted_at is null)")
# the batches back inside the snapshot (a deleted draft has no place there: the mock removed it for good)
PRE_R54_BATCHES = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'batches', {BATCH_AGG}
)) where key = 'main'"""

# ── R5.5 upgrade drill: the price declarations and the production configuration ──────────────────────────────
# A database written before the declarations had tables holds them inside compat_state — each with its inputs and
# its cost heads — and the production configuration as one object beside them. These statements rebuild that shape
# from the live tables, so the first boot on this code has to adopt it. Nothing here ships either: it is the inverse
# of the production half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
BOM_INPUTS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', i.item_id, 'name', i.name, 'sku', i.sku, 'uom', i.uom, 'qty', i.qty, 'wastagePct', i.wastage_pct,
      'wastageQty', i.wastage_qty, 'grossQty', i.gross_qty, 'price', i.price, 'value', i.value,
      'wastageValue', i.wastage_value)""") + """ order by i.ord), '[]'::jsonb)
     from bom_inputs i where i.bom_id = b.id)""")
BOM_COSTS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'head', c.head, 'amount', c.amount)""") + """ order by c.ord), '[]'::jsonb)
     from bom_costs c where c.bom_id = b.id)""")
BOM_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', b.id, 'no', b.no, 'itemId', b.item_id, 'itemName', b.item_name, 'sku', b.sku, 'hsCode', b.hs_code,
    'uom', b.uom, 'version', b.version, 'licenseDate', b.license_date, 'effectiveDate', b.effective_date,
    'amendmentReason', b.amendment_reason, 'note', b.note, 'inputs', """ + BOM_INPUTS_DOC + """,
    'costs', """ + BOM_COSTS_DOC + """, 'materialValue', b.material_value, 'wastageValue', b.wastage_value,
    'valueAdded', b.value_added, 'price', b.price, 'unitCost', b.unit_cost, 'process', b.process,
    'supersededAt', """ + _ISO.format("b.superseded_at") + """, 'createdAt', """ + _ISO.format("b.created_at") + """,
    'updatedAt', """ + _ISO.format("b.updated_at") + """, 'cancelReason', b.cancel_reason,
    'history', b.history)""") + ")")
BOM_AGG = (f"(select coalesce(jsonb_agg({BOM_DOC} order by b.ord), '[]'::jsonb) "
           f"from boms b where b.deleted_at is null)")
# the configuration: one object, its two settings and whoever changed them last
CONFIG_DOC = ("(select " + _NO_NULLS.format("""jsonb_build_object('procedure', procedure, 'consumption', consumption,
    'updatedAt', """ + _ISO.format("updated_at") + """, 'updatedBy', updated_by)""")
              + " from production_config where id = 1)")
# the declarations and the configuration back inside the snapshot (a deleted draft has no place there: the mock
# removed it for good, so only the id counter the snapshot keeps retires its id)
PRE_R55_BOMS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'boms', {BOM_AGG}, 'productionConfig', {CONFIG_DOC}
)) where key = 'main'"""

# ── R5.5 upgrade drill: the work orders ──────────────────────────────────────────────────────────────────────
# A database written before the work orders had tables holds them inside compat_state, each with the goods it asks
# for and the progress the batches had made. These statements rebuild that shape from the live tables, so the first
# boot on this code has to adopt it. Nothing here ships either: it is the inverse of the work-order half of
# `adoptCompatRows()` in api/src/boot.ts, for the test only.
WORK_ORDER_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'sku', l.sku, 'uom', l.uom, 'qty', l.qty, 'issued', l.issued,
      'received', l.received, 'damaged', l.damaged, 'remaining', l.remaining)""") + """ order by l.ord), '[]'::jsonb)
     from work_order_lines l where l.work_order_id = w.id)""")
WORK_ORDER_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', w.id, 'no', w.no, 'requisitionNo', w.requisition_no, 'issueDate', w.issue_date, 'dueDate', w.due_date,
    'remark', w.remark, 'lines', """ + WORK_ORDER_LINES_DOC + """, 'process', w.process, 'status', w.status,
    'issuedBy', w.issued_by, 'createdAt', """ + _ISO.format("w.created_at") + """, 'updatedAt', """
                                          + _ISO.format("w.updated_at") + """, 'cancelReason', w.cancel_reason,
    'history', w.history)""") + ")")
WORK_ORDER_AGG = (f"(select coalesce(jsonb_agg({WORK_ORDER_DOC} order by w.ord), '[]'::jsonb) "
                  f"from work_orders w where w.deleted_at is null)")
# the work orders back inside the snapshot (a deleted draft has no place there: the mock removed it for good)
PRE_R55_WORK_ORDERS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'workOrders', {WORK_ORDER_AGG}
)) where key = 'main'"""

# ── R5.6 upgrade drill: the accounting ───────────────────────────────────────────────────────────────────────
# A database written before accounting had tables holds the accounts, the receipts and the payments with their
# allocations and the configuration inside compat_state. These statements rebuild that shape from the live tables, so
# the first boot on this code has to adopt it. Nothing here ships either: it is the inverse of the accounting half of
# `adoptCompatRows()` in api/src/boot.ts, for the test only.
MONEY_ALLOCATIONS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'docId', a.invoice_id, 'docNo', a.invoice_no, 'docDate', a.invoice_date, 'docTotal', a.invoice_total,
      'amount', a.amount)""") + """ order by a.ord), '[]'::jsonb)
     from money_allocations a where a.doc_id = m.id)""")
MONEY_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', m.id, 'no', m.no, 'kind', m.kind, 'date', m.date, 'partyId', m.party_id, 'partyName', m.party_name,
    'partyBin', m.party_bin, 'method', m.method, 'accountId', m.account_id, 'accountName', m.account_name,
    'chequeNo', m.cheque_no, 'chequeDate', m.cheque_date, 'chequeBank', m.cheque_bank, 'reference', m.reference,
    'amount', m.amount, 'charge', m.charge, 'allocations', """ + MONEY_ALLOCATIONS_DOC + """,
    'allocated', m.allocated, 'unallocated', m.unallocated, 'note', m.note, 'process', m.process,
    'issuedBy', m.issued_by, 'createdAt', """ + _ISO.format("m.created_at") + """, 'updatedAt', """
                                            + _ISO.format("m.updated_at") + """,
    'cancelReason', m.cancel_reason, 'history', m.history)""") + ")")
MONEY_AGG = (f"(select coalesce(jsonb_agg({MONEY_DOC} order by m.ord), '[]'::jsonb) "
             f"from money_docs m where m.deleted_at is null)")
ACCOUNT_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'provider', a.provider, 'accountNo', a.account_no, 'owner', a.owner,
    'branch', a.branch, 'address', a.address, 'bankType', a.bank_type, 'walletType', a.wallet_type,
    'authorised', a.authorised, 'serviceCharge', a.service_charge, 'openingBalance', a.opening_balance,
    'openingDate', a.opening_date, 'active', a.active, 'createdAt', """ + _ISO.format("a.created_at") + """,
    'updatedAt', """ + _ISO.format("a.updated_at") + """, 'history', a.history)""") + ")")
ACCOUNT_AGG = f"(select coalesce(jsonb_agg({ACCOUNT_DOC} order by a.ord), '[]'::jsonb) from money_accounts a)"
# the accounts, the money documents and the configuration back inside the snapshot (a deleted draft has no place
# there: the mock removed it for good)
PRE_R56_ACCOUNTING = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'moneyAccounts', {ACCOUNT_AGG}, 'moneyDocs', {MONEY_AGG}, 'accountingConfig', (
    select jsonb_build_object('closedUpTo', closed_up_to, 'allowAdvance', allow_advance,
                              'autoAllocate', auto_allocate, 'updatedAt', {_ISO.format("updated_at")},
                              'updatedBy', updated_by)
    from accounting_config where id = 1)
)) where key = 'main'"""

# ── R5.6 upgrade drill: the NBR VAT documents ─────────────────────────────────────────────────────────────────
# A database written before these had tables holds the treasury deposits, the VDS certificates and the VAT
# adjustments inside compat_state. These statements rebuild that shape from the live tables — the stored row as the
# compat world had it: camelCase fields, optional ones absent rather than null, timestamps in the ISO-8601 the
# snapshot carries — so the first boot on this code has to adopt them. Nothing here ships: it is the inverse of the
# VAT half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
TREASURY_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', t.id, 'no', t.no, 'head', t.head, 'code', t.code, 'taxPeriod', t.tax_period, 'challanNo', t.challan_no,
    'challanDate', to_char(t.challan_date, 'YYYY-MM-DD'), 'mode', t.mode, 'bank', t.bank, 'bankBranch', t.bank_branch,
    'district', t.district, 'bankAddress', t.bank_address, 'accountId', t.account_id, 'amount', t.amount,
    'depositor', t.depositor, 'designation', t.designation, 'address', t.address, 'description', t.description,
    'process', t.process, 'createdAt', """ + _ISO.format("t.created_at") + """, 'updatedAt', """
                                                        + _ISO.format("t.updated_at") + """,
    'cancelReason', t.cancel_reason, 'history', t.history)""") + ")")
TREASURY_AGG = (f"(select coalesce(jsonb_agg({TREASURY_DOC} order by t.ord), '[]'::jsonb) "
                f"from treasury_deposits t where t.deleted_at is null)")
VDS_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', v.id, 'no', v.no, 'mode', v.mode, 'docId', v.doc_id, 'docNo', v.doc_no, 'challanNo', v.challan_no,
    'docDate', to_char(v.doc_date, 'YYYY-MM-DD'), 'partyId', v.party_id, 'partyName', v.party_name,
    'partyBin', v.party_bin, 'partyAddress', v.party_address, 'docValue', v.doc_value, 'docVat', v.doc_vat,
    'amount', v.amount, 'certificateNo', v.certificate_no,
    'certificateDate', to_char(v.certificate_date, 'YYYY-MM-DD'), 'taxPeriod', v.tax_period,
    'treasuryId', v.treasury_id, 'treasuryChallan', v.treasury_challan, 'remark', v.remark, 'settled', v.settled,
    'process', v.process, 'issuedBy', v.issued_by, 'createdAt', """ + _ISO.format("v.created_at") + """,
    'updatedAt', """ + _ISO.format("v.updated_at") + """, 'cancelReason', v.cancel_reason, 'history', v.history)""") + ")")
VDS_AGG = f"(select coalesce(jsonb_agg({VDS_DOC} order by v.ord), '[]'::jsonb) from vds_entries v where v.deleted_at is null)"
ADJUSTMENT_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', a.id, 'no', a.no, 'kind', a.kind, 'note', a.note,
    'issueDate', to_char(a.issue_date, 'YYYY-MM-DD'), 'taxPeriod', a.tax_period, 'amount', a.amount,
    'description', a.description, 'reference', a.reference, 'sdExport', a.sd_export, 'process', a.process,
    'issuedBy', a.issued_by, 'createdAt', """ + _ISO.format("a.created_at") + """, 'updatedAt', """
                                          + _ISO.format("a.updated_at") + """,
    'cancelReason', a.cancel_reason, 'history', a.history)""") + ")")
ADJUSTMENT_AGG = (f"(select coalesce(jsonb_agg({ADJUSTMENT_DOC} order by a.ord), '[]'::jsonb) "
                  f"from vat_adjustments a where a.deleted_at is null)")
# the three collections back inside the snapshot (a deleted draft has no place there: the mock removed it for good)
PRE_R56_VAT = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'treasury', {TREASURY_AGG}, 'vds', {VDS_AGG}, 'adjustments', {ADJUSTMENT_AGG}
)) where key = 'main'"""

# ── R5.6 upgrade drill: the Mushak 9.1 returns and the NBR settings ─────────────────────────────────────────
# The same for the return: a database written before this slice holds one return per tax period inside
# compat_state (`returns`, the period being its id) with the NBR settings beside it (`vatSettings`, an object),
# and no row in either table. Rebuilt from the live tables below — the return carrying the computation it was
# filed with, optional fields absent rather than null, timestamps in the ISO-8601 the snapshot carries — so the
# first boot on this code has to adopt them. Nothing here ships either.
RETURN_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', r.id, 'period', r.period, 'type', r.type, 'amendReason', r.amend_reason, 'activities', r.activities,
    'status', r.status, 'submissionDate', to_char(r.submission_date, 'YYYY-MM-DD'), 'manual', r.manual,
    'snapshot', r.snapshot, 'ackNo', r.ack_no, 'submittedBy', r.submitted_by, 'submittedAt', """
                                  + _ISO.format("r.submitted_at") + """, 'createdAt', """
                                  + _ISO.format("r.created_at") + """, 'updatedAt', """
                                  + _ISO.format("r.updated_at") + """, 'history', r.history)""") + ")")
RETURN_AGG = f"(select coalesce(jsonb_agg({RETURN_DOC} order by r.ord), '[]'::jsonb) from vat_returns r)"
SETTINGS_DOC = ("(select " + _NO_NULLS.format("""jsonb_build_object('zoneCode', zone_code, 'profile', profile,
  'updatedAt', """ + _ISO.format("updated_at") + """, 'updatedBy', updated_by)""") + " from vat_settings where id = 1)")
PRE_R56_RETURNS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'returns', {RETURN_AGG}, 'vatSettings', {SETTINGS_DOC}
)) where key = 'main'"""

# ── R6.2 upgrade drill: the exporters' Utilization Declarations ─────────────────────────────────────────────
# The first of the R6 registers to get a table: a database written before this slice holds every declaration
# inside compat_state — the head with its inputs (`lines`) and its amendment certificates, optional fields absent
# rather than null, dates as the strings the mock carried — and no row in `uds` / `ud_lines`. These statements
# rebuild that shape from the live tables, so the first boot on this code has to adopt them. Nothing here ships:
# it is the inverse of the UD half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
UD_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'hsCode', l.hs_code, 'uom', l.uom, 'qty', l.qty, 'value', l.value)""")
    + """ order by l.ord), '[]'::jsonb) from ud_lines l where l.ud_id = u.id)""")
UD_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', u.id, 'no', u.no, 'date', to_char(u.date, 'YYYY-MM-DD'), 'kind', u.kind, 'customerId', u.customer_id,
    'customerName', u.customer_name, 'customerBin', u.customer_bin, 'masterLcNo', u.master_lc_no, 'buyer', u.buyer,
    'expiry', to_char(u.expiry, 'YYYY-MM-DD'), 'status', u.status, 'note', u.note, 'masterLcValue', u.master_lc_value,
    'currency', u.currency, 'amendments', u.amendments, 'lines', """ + UD_LINES_DOC + """, 'createdBy', u.created_by,
    'createdAt', """ + _ISO.format("u.created_at") + """, 'updatedAt', """ + _ISO.format("u.updated_at") + """,
    'history', u.history)""") + ")")
UD_AGG = f"(select coalesce(jsonb_agg({UD_DOC} order by u.ord), '[]'::jsonb) from uds u where u.deleted_at is null)"
# the collection back inside the snapshot (a deleted declaration has no place there: the mock removed it for good)
PRE_R62_UDS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'uds', {UD_AGG}
)) where key = 'main'"""

# ── R6.5 upgrade drill: our own UDs / UP ────────────────────────────────────────────────────────────────────
# A database written before this slice holds the own UDs inside compat_state — the head with its inputs and its
# garments as arrays and the settlement travelling with it, optional fields absent rather than null, timestamps in
# the ISO-8601 the snapshot carries — and no row in `bond_uds` / `bond_ud_inputs` / `bond_ud_garments`. These
# statements rebuild that shape from the live tables, so the first boot on this code has to adopt them. Nothing
# here ships: it is the inverse of the own-UD half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
BOND_INPUTS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'hsCode', l.hs_code, 'uom', l.uom, 'qty', l.qty)""")
    + """ order by l.ord), '[]'::jsonb) from bond_ud_inputs l where l.ud_id = u.id)""")
BOND_GARMENTS_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', g.item_id, 'name', g.name, 'uom', g.uom, 'qty', g.qty)""")
    + """ order by g.ord), '[]'::jsonb) from bond_ud_garments g where g.ud_id = u.id)""")
BOND_UD_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', u.id, 'no', u.no, 'kind', u.kind, 'issuer', u.issuer, 'date', to_char(u.date, 'YYYY-MM-DD'),
    'expiry', to_char(u.expiry, 'YYYY-MM-DD'), 'masterLcNo', u.master_lc_no, 'masterLcValue', u.master_lc_value,
    'currency', u.currency, 'buyer', u.buyer, 'note', u.note, 'settlement', u.settlement, 'inputs', """ + BOND_INPUTS_DOC + """,
    'garments', """ + BOND_GARMENTS_DOC + """, 'createdBy', u.created_by, 'createdAt', """ + _ISO.format("u.created_at") + """,
    'updatedAt', """ + _ISO.format("u.updated_at") + """, 'history', u.history)""") + ")")
BOND_UD_AGG = f"(select coalesce(jsonb_agg({BOND_UD_DOC} order by u.ord), '[]'::jsonb) from bond_uds u where u.deleted_at is null)"
PRE_R65_BOND_UDS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'bondUds', {BOND_UD_AGG}
)) where key = 'main'"""

# ── R6.6 upgrade drill: the Mushak 9.3 / 9.4 applications ───────────────────────────────────────────────────
# A database written before this slice holds both families inside compat_state — the corrections and the amended
# return travelling with the application, optional fields absent rather than null, timestamps in the ISO-8601 the
# snapshot carries — and no row in `late_filings` / `return_amendments`. These statements rebuild that shape from
# the live tables, so the first boot on this code has to adopt them. Nothing here ships: it is the inverse of the
# applications half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
LATE_FILING_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', l.id, 'no', l.no, 'period', l.period, 'reasonKind', l.reason_kind, 'reason', l.reason,
    'requestedDate', to_char(l.requested_date, 'YYYY-MM-DD'), 'status', l.status,
    'filedOn', to_char(l.filed_on, 'YYYY-MM-DD'), 'filedRef', l.filed_ref,
    'decidedOn', to_char(l.decided_on, 'YYYY-MM-DD'), 'commissionerRef', l.commissioner_ref,
    'grantedDate', to_char(l.granted_date, 'YYYY-MM-DD'), 'rejectReason', l.reject_reason, 'createdBy', l.created_by,
    'createdAt', """ + _ISO.format("l.created_at") + """, 'updatedAt', """ + _ISO.format("l.updated_at") + """, 'history', l.history)""") + ")")
LATE_FILING_AGG = (f"(select coalesce(jsonb_agg({LATE_FILING_DOC} order by l.ord), '[]'::jsonb)"
                   " from late_filings l where l.deleted_at is null)")
AMENDMENT_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', r.id, 'no', r.no, 'period', r.period, 'reasonKind', r.reason_kind, 'description', r.description,
    'corrections', r.corrections, 'noAudit', r.no_audit, 'revision', r.revision, 'status', r.status,
    'filedOn', to_char(r.filed_on, 'YYYY-MM-DD'), 'filedRef', r.filed_ref,
    'decidedOn', to_char(r.decided_on, 'YYYY-MM-DD'), 'commissionerRef', r.commissioner_ref,
    'rejectReason', r.reject_reason, 'adjustPeriod', r.adjust_period, 'amended', r.amended, 'createdBy', r.created_by,
    'createdAt', """ + _ISO.format("r.created_at") + """, 'updatedAt', """ + _ISO.format("r.updated_at") + """, 'history', r.history)""") + ")")
AMENDMENT_AGG = (f"(select coalesce(jsonb_agg({AMENDMENT_DOC} order by r.ord), '[]'::jsonb)"
                 " from return_amendments r where r.deleted_at is null)")
# the drill also injects one synthetic DRAFT application, so the ported write paths run against a draft the
# old code could have left behind: edit it, try to file it, then delete it (a period whose return is already
# submitted — the mock would have refused to create it, but adoption moves rows, and the index only keeps one
# live application per period; lf1 is rejected, so 2025-12 is free)
DRILL_LF_ID = "lfdrill1"
DRILL_LF = f"""'{{"id":"{DRILL_LF_ID}","no":"LF-01269999","period":"2025-12","reasonKind":"other","reason":"A draft the upgrade drill injected, to be edited and deleted once the tables own the family.","requestedDate":"2026-01-20","status":"draft","createdBy":"A. Rahman","createdAt":"2026-01-10T09:00:00.000Z","history":[{{"at":"2026-01-10T09:00:00.000Z","by":"A. Rahman","action":"created"}}]}}'::jsonb"""
PRE_R66_RETURN_APPS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'lateFilings', {LATE_FILING_AGG} || jsonb_build_array({DRILL_LF}),
  'returnAmendments', {AMENDMENT_AGG}
)) where key = 'main'"""

# ── R6.6 upgrade drill: the bank PRC batches ─────────────────────────────────────────────────────────────────
# The same story for the proceeds register: a database written before the port holds the batches inside
# compat_state — realisations travelling on the sales, timestamps in the ISO-8601 the snapshot carries — and no
# row in `prc_batches`. (The realisations are already rows in `sale_realisations` by then: the compat write-back
# had been syncing them since R6.6's first half, so the drill only moves the batches themselves.) Nothing here
# ships either: it is the inverse of the batches half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
PRC_BATCH_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', p.id, 'no', p.no, 'fileName', p.file_name, 'status', p.status, 'lines', p.lines, 'skipped', p.skipped,
    'invoices', p.invoices, 'fcTotals', p.fc_totals, 'bdt', p.bdt, 'reversedOn', p.reversed_on,
    'reverseReason', p.reverse_reason, 'createdBy', p.created_by,
    'createdAt', """ + _ISO.format("p.created_at") + """, 'updatedAt', """ + _ISO.format("p.updated_at") + """, 'history', p.history)""") + ")")
PRC_BATCH_AGG = (f"(select coalesce(jsonb_agg({PRC_BATCH_DOC} order by p.ord), '[]'::jsonb)"
                 " from prc_batches p where p.deleted_at is null)")
# the drill also injects one synthetic POSTED batch, so the ported write paths run against a batch the old code
# could have left behind: fetch it by id, then reverse it (its one line carries no allocations, so the reversal
# has nothing to remove — it just stamps the row the way the mock's ever-forward history had)
DRILL_PB_ID = "pbdrill1"
DRILL_PB = f"""'{{"id":"{DRILL_PB_ID}","no":"PB-09269999","fileName":"drill.csv","status":"posted","lines":[{{"line":2,"date":"2026-09-25","prcNo":"PRC/DRILL/1","currency":"USD","fcAmount":1,"rate":122,"allocations":[]}}],"skipped":0,"invoices":0,"fcTotals":{{"USD":1}},"bdt":122,"createdBy":"A. Rahman","createdAt":"2026-09-25T09:00:00.000Z","history":[{{"at":"2026-09-25T09:00:00.000Z","by":"A. Rahman","action":"created"}}]}}'::jsonb"""
PRE_R66B_PRC_BATCHES = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'prcBatches', {PRC_BATCH_AGG} || jsonb_build_array({DRILL_PB})
)) where key = 'main'"""

# ── R6.5 upgrade drill: the drawback claims ─────────────────────────────────────────────────────────────────
# The claims were the last compat documents: a database written before this slice holds them inside
# compat_state — the frozen lines, the DEDO references and the decision dates travelling with the head,
# timestamps in the ISO-8601 the snapshot carries — and no row in `drawback_claims`. These statements rebuild
# that shape from the live tables, so the first boot on this code has to adopt them. Nothing here ships: it is
# the inverse of the claims half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
CLAIM_DOC = ("(" + _NO_NULLS.format("""jsonb_build_object(
    'id', c.id, 'no', c.no, 'status', c.status, 'method', c.method, 'lines', c.lines,
    'cd', c.cd, 'rd', c.rd, 'claimed', c.claimed,
    'filedOn', c.filed_on, 'dedoRef', c.dedo_ref,
    'sanctionedOn', c.sanctioned_on, 'sanctioned', c.sanctioned, 'disallowedReason', c.disallowed_reason,
    'paidOn', c.paid_on, 'paid', c.paid, 'payRef', c.pay_ref,
    'rejectedOn', c.rejected_on, 'rejectReason', c.reject_reason, 'note', c.note,
    'createdBy', c.created_by, 'createdAt', """ + _ISO.format("c.created_at") + """, 'updatedAt', """ + _ISO.format("c.updated_at") + """, 'history', c.history)""") + ")")
CLAIM_AGG = (f"(select coalesce(jsonb_agg({CLAIM_DOC} order by c.ord), '[]'::jsonb)"
             " from drawback_claims c where c.deleted_at is null)")
# the drill also injects one synthetic DRAFT claim, so the ported write paths run against a claim the old
# code could have left behind: file it (the date has to sit inside its line's window), then delete a fresh
# draft — both against rows the adoption moved. Its one line names a sale that does not exist, so the
# drawback view's claimable totals do not move with it.
DRILL_CLAIM_ID = "dcdrill1"
# the drill's draft carries no money (its one line names a sale that does not exist), so the register's
# totals and the bond view's claimable figure do not move with it — the answers have to compare clean
DRILL_CLAIM = """'{"id":"dcdrill1","no":"DBK-09269999","status":"draft","method":"actual","lines":[{"saleId":"sdrill0","invoiceNo":"S-DRILL-1","exportDate":"2026-09-01","billNo":"BE-DRILL-1","deemed":false,"customerName":"DRILL EXPORT HOUSE","deadline":"2027-03-01","inputs":[],"cd":0,"rd":0,"total":0}],"cd":0,"rd":0,"claimed":0,"note":"A draft the upgrade drill injected, to be filed and superseded once the table owns the family.","createdBy":"A. Rahman","createdAt":"2026-09-22T09:00:00.000Z","history":[{"at":"2026-09-22T09:00:00.000Z","by":"A. Rahman","action":"created"}]}'::jsonb"""
PRE_R65B_CLAIMS = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'drawbackClaims', {CLAIM_AGG} || jsonb_build_array({DRILL_CLAIM})
)) where key = 'main'"""

# ── R5.3 upgrade drill: the credit and debit notes ───────────────────────────────────────────────────────────
# A database written before the notes had tables holds both families inside compat_state. These statements rebuild
# that shape from the live tables — one table with a `kind`, so the two documents' own field names (saleId /
# purchaseId, customerName / vendorName, soldQty / purchasedQty) come back out of the shared columns. Nothing here
# ships either: it is the inverse of the notes half of `adoptCompatRows()` in api/src/boot.ts, for the test only.
NOTE_LINES_DOC = ("""(select coalesce(jsonb_agg(""" + _NO_NULLS.format("""jsonb_build_object(
      'itemId', l.item_id, 'name', l.name, 'hsCode', l.hs_code, 'uom', l.uom, 'soldQty', l.sold_qty,
      'purchasedQty', l.purchased_qty, 'qty', l.qty, 'price', l.price, 'sdRate', l.sd_rate, 'vatRate', l.vat_rate,
      'subtotal', l.subtotal, 'sd', l.sd, 'vat', l.vat, 'total', l.total, 'tti', l.tti, 'rebate', l.rebate)""")
    + """ order by l.ord), '[]'::jsonb) from note_lines l where l.note_id = n.id)""")
NOTE_DOC = ("""(""" + _NO_NULLS.format("""jsonb_build_object(
    'id', n.id, 'no', n.no,
    'saleId', case when n.kind = 'credit' then n.source_id end,
    'saleNo', case when n.kind = 'credit' then n.source_no end,
    'saleDate', case when n.kind = 'credit' then n.source_date end,
    'saleMode', case when n.kind = 'credit' then n.source_mode end,
    'purchaseId', case when n.kind = 'debit' then n.source_id end,
    'purchaseNo', case when n.kind = 'debit' then n.source_no end,
    'purchaseDate', case when n.kind = 'debit' then n.source_date end,
    'purchaseMode', case when n.kind = 'debit' then n.source_mode end,
    'challanNo', n.challan_no,
    'customerId', case when n.kind = 'credit' then n.party_id end,
    'customerName', case when n.kind = 'credit' then n.party_name end,
    'customerBin', case when n.kind = 'credit' then n.party_bin end,
    'customerAddress', case when n.kind = 'credit' then n.party_address end,
    'vendorId', case when n.kind = 'debit' then n.party_id end,
    'vendorName', case when n.kind = 'debit' then n.party_name end,
    'vendorBin', case when n.kind = 'debit' then n.party_bin end,
    'vendorAddress', case when n.kind = 'debit' then n.party_address end,
    'branchId', n.branch_id, 'branchName', n.branch_name, 'issueDate', n.issue_date, 'issueTime', n.issue_time,
    'reason', n.reason, 'note', n.note, 'issuedBy', n.issued_by, 'designation', n.designation, 'process', n.process,
    'lines', """ + NOTE_LINES_DOC + """, 'subtotal', n.subtotal, 'sd', n.sd, 'vat', n.vat, 'total', n.total,
    'tti', case when n.kind = 'debit' then n.tti end, 'rebate', case when n.kind = 'debit' then n.rebate end,
    'createdAt', """ + _ISO.format("n.created_at") + """, 'updatedAt', """ + _ISO.format("n.updated_at") + """,
    'cancelReason', n.cancel_reason, 'history', n.history)""") + ")")
NOTE_AGG = lambda kind: (f"(select coalesce(jsonb_agg({NOTE_DOC} order by n.ord), '[]'::jsonb) "
                         f"from notes n where n.kind = '{kind}' and n.deleted_at is null)")
# both collections back inside the snapshot (a deleted draft has no place there: the mock removed it for good)
PRE_R53_NOTES = f"""update compat_state set data = jsonb_set(data, '{{db}}', (data->'db') || jsonb_build_object(
  'creditNotes', {NOTE_AGG('credit')},
  'debitNotes', {NOTE_AGG('debit')}
)) where key = 'main'"""


def annotate(level, title, msg):
    """A GitHub workflow-command annotation: the runner's log and artifact blobs are not reachable from everywhere,
    but the annotations of a check run are — so a failure in CI is readable without them."""
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    esc = lambda t: str(t).replace("%", "%25").replace("\n", "%0A").replace("\r", "%0A")
    print(f"::{level} title={esc(title)}::{esc(msg)}")


def check(cond, msg):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ok   {msg}")
    else:
        fail += 1
        print(f"  FAIL {msg}")
        annotate("error", "api_native check failed", msg)


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


# The finale drains compat_state and the boot drops the table — every drill that rewinds the tables into
# their pre-release shape has to put it back first, as the empty snapshot the old code would have written.
# The counters need no flushing any more: the boot lifts them from the rows, stamped drafts included.
def ensure_compat_state():
    psql("""create table if not exists compat_state (
      "key" text primary key not null, "data" jsonb not null,
      "updated_at" timestamp (3) with time zone default now() not null)""")
    psql("""insert into compat_state ("key", "data") values ('main', '{"db":{}}'::jsonb)
      on conflict ("key") do nothing""")


# the finale boot's own verdict: the drained snapshot table is gone
COMPAT_GONE = "select (to_regclass('public.compat_state') is null)"


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
    check(h["modules"]["native"] >= 7 and h["modules"]["compatRoutes"] == 0, f"health: {h['modules']['native']} native modules, {h['modules']['compatRoutes']} compat routes — the table is empty, every route is native")

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
    ud_body = {"kind": "UD", "no": f"BKMEA/UD/2026/R6{TAG}".upper(), "date": "2026-09-20", "customerId": "c10",
               "masterLcNo": f"EXP-LC-R6-{TAG}", "buyer": "E2E BUYER", "expiry": "2027-03-31", "lines": [{"itemId": "i21", "qty": 1000}]}
    ud = arif.post(f"{BASE}/vat/uds", json=ud_body)
    check(ud.status_code == 201, f"native (R6.2): a declaration is created for the restart check ({ud.status_code})")
    # …and the restart check below: own UDs are rows of their own now too (R6.5), so this one is written straight
    # into `bond_uds` with its inputs and garments
    bu = arif.post(f"{BASE}/vat/bond-uds", json={"kind": "UD", "issuer": "BKMEA", "no": f"BKMEA/UD/2026/R5{TAG}".upper(),
                                                 "date": "2026-08-01", "expiry": "2026-09-01",
                                                 "masterLcNo": f"EXP-LC-R5-{TAG}",
                                                 "inputs": [{"itemId": "i9", "qty": 100}],
                                                 "garments": [{"itemId": "i18", "qty": 300}]})
    check(bu.status_code == 201, f"native (R6.5): own UD created for the restart check ({bu.status_code})")
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
        check(psql(COMPAT_GONE) == "t", "R5.2: …and no longer inside the compat snapshot")
        check(psql(COMPAT_GONE) == "t",
              "R5.2: …and there is no compat snapshot to hold any of it — the table itself is gone")
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
        check(psql(COMPAT_GONE) == "t",
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

    # R5.3: transfers and damage entries are the first documents with their own tables. Their registers read
    # PostgreSQL; the branch split and an item's ledger derive from *every* movement document (served from the tables
    # themselves since R5.4), so a document written natively has to reach both copies at once; and an approval writes
    # the item counter it moves in the same transaction as the document.
    print("R5.3: stock documents are rows, and the derived stock follows them")
    other = [b["id"] for b in arif.get(f"{BASE}/stock").json()["branches"] if b["id"] != branch][0]

    def held():
        rows = arif.get(f"{BASE}/stock", params={"size": 100}).json()["data"]
        r = [x for x in rows if x["id"] == iid][0]
        return r["remain"], r["byBranch"].get(branch, 0), r["byBranch"].get(other, 0)

    tdate = time.strftime("%Y-%m-%d")
    t0 = held()
    tr = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": tdate, "vehicle": "",
                                              "note": f"R5.3 transfer {TAG}", "lines": [{"itemId": iid, "qty": 6}], "process": "Created"})
    tid, tno = tr.json().get("id"), tr.json().get("no")
    check(tr.status_code == 201 and tr.json()["process"] == "Created"
          and [h["action"] for h in tr.json()["history"]] == ["created"], f"native (R5.3): transfer draft created ({tr.status_code})")
    check(held() == t0, "R5.3: a draft moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from stock_documents where id = '{tid}' and process = 'Created'") == "1",
              "R5.3: the draft is a row in stock_documents")
        check(psql(f"select count(*) from stock_document_lines where doc_id = '{tid}'") == "1",
              "R5.3: …and its lines are rows in stock_document_lines")
    ap = arif.patch(f"{BASE}/transfers/{tid}", json={"process": "Approved"})
    check(ap.status_code == 200 and ap.json()["process"] == "Approved" and held() == (t0[0], t0[1] - 6, t0[2] + 6),
          f"R5.3: approving moves the stock, and the branch split, served from the tables, follows ({ap.status_code})")
    led = arif.get(f"{BASE}/items/{iid}/ledger", params={"branch": other}).json()
    check(any(e["type"] == "transferIn" and e["ref"] == tno for e in led["entries"]),
          "R5.3: …and the item's ledger, derived from every document, quotes it")
    if DB_URL:
        check(psql(f"select jsonb_array_length(history) from stock_documents where id = '{tid}'") == "2",
              "R5.3: the document's own history travels with the row")
    cn = arif.patch(f"{BASE}/transfers/{tid}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(cn.status_code == 200 and held() == t0, "R5.3: cancelling gives the stock back")
    if DB_URL:
        check(psql(f"select count(*) from stock_documents where id = '{tid}' and process = 'Cancelled' and cancel_reason is not null") == "1",
              "R5.3: …and the cancellation is stored on the row")
    # a damage entry writes stock off: the item's counter moves with the document, in its transaction
    dm = arif.post(f"{BASE}/damage", json={"branchId": branch, "date": tdate, "reason": "wastage", "note": f"R5.3 damage {TAG}",
                                           "lines": [{"itemId": iid, "qty": 2}], "process": "Approved"})
    did = dm.json().get("id")
    check(dm.status_code == 201 and dm.json()["process"] == "Approved" and held() == (t0[0] - 2, t0[1] - 2, t0[2]),
          f"native (R5.3): a damage entry approved on creation writes the stock off ({dm.status_code})")
    if DB_URL:
        check(psql(f"select damage = 2 from items where id = '{iid}'") == "t",
              "R5.3: …and the counter it moved is written with it (items.damage)")
    dcn = arif.patch(f"{BASE}/damage/{did}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(dcn.status_code == 200 and held() == t0, "R5.3: cancelling a damage entry puts the stock back")
    if DB_URL:
        check(psql(f"select damage = 0 from items where id = '{iid}'") == "t", "R5.3: …and takes the counter back")
    # editing a draft replaces its lines; deleting one removes the row and retires its number
    d2 = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": tdate,
                                              "lines": [{"itemId": iid, "qty": 3}], "process": "Created"}).json()
    ed = arif.put(f"{BASE}/transfers/{d2['id']}", json={"fromBranchId": branch, "toBranchId": other, "date": tdate,
                                                        "lines": [{"itemId": iid, "qty": 4}, {"itemId": "i19", "qty": 1}],
                                                        "process": "Created"})
    check(ed.status_code == 200 and [l["qty"] for l in ed.json()["lines"]] == [4, 1],
          f"R5.3: editing a draft replaces its lines ({ed.status_code})")
    if DB_URL:
        check(psql(f"select string_agg(item_id || ':' || qty::text, ',' order by ord) from stock_document_lines where doc_id = '{d2['id']}'")
              == f"{iid}:4.000,i19:1.000", "R5.3: …in the child table, in the order they are printed")
    dl = arif.delete(f"{BASE}/transfers/{d2['id']}")
    check(dl.status_code == 200 and dl.json().get("ok") is True, "R5.3: a draft is deleted")
    if DB_URL:
        check(psql(f"select count(*) from stock_documents where id = '{d2['id']}'") == "0"
              and psql(f"select count(*) from stock_document_lines where doc_id = '{d2['id']}'") == "0",
              "R5.3: …and its row and lines leave the database")
    nx = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": tdate,
                                              "lines": [{"itemId": iid, "qty": 1}], "process": "Created"}).json()
    check(nx["no"] != d2["no"], f"R5.3: a deleted draft's number stays retired ({d2['no']} → {nx['no']})")
    arif.delete(f"{BASE}/transfers/{nx['id']}")
    rows0 = psql("select count(*) from stock_documents") if DB_URL else None
    sh = arif.post(f"{BASE}/transfers", json={"fromBranchId": other, "toBranchId": branch, "date": tdate,
                                              "lines": [{"itemId": iid, "qty": 100000}], "process": "Approved"})
    check(sh.status_code == 422 and "Insufficient stock" in sh.json().get("title", ""),
          f"R5.3: approving more than the branch holds is a 422 ({sh.status_code})")
    if DB_URL:
        check(psql("select count(*) from stock_documents") == rows0, "R5.3: …and the refused document left no row behind")
        check(psql(COMPAT_GONE) == "t",
              "R5.3: the snapshot carries no stock-document collection at all")
        check(int(psql("select count(*) from stock_documents where kind = 'transfer'")) >= 8
              and int(psql("select count(*) from stock_documents where kind = 'damage'")) >= 6
              and int(psql("select count(*) from stock_document_lines")) >= 21,
              "R5.3: the demo transfers and damage entries were seeded into their tables")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into stock_documents (id, kind, no, date, process, from_branch_id, from_branch, to_branch_id, "
                                f"to_branch, total_qty, total_value, issued_by, created_at) select 'dupd{TAG}', kind, no, date, process, "
                                "from_branch_id, from_branch, to_branch_id, to_branch, 0, 0, 'x', now() from stock_documents limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.3: the database refuses a duplicate document number (unique index), not just the API")

    # R5.3: the sales invoices are rows too — the first revenue document out of the compat layer. The register, the
    # branch stock, an item's ledger and the credit a customer carries still derive from *every* document through
    # the in-memory copies the unported handlers read, so an invoice written natively has to reach them at once;
    # and approving one writes the SKU counter it moves (`items.sold`) in the same transaction.
    print("R5.3: sales invoices are rows, and the numbers derived from them follow")
    # a finished good with stock at the branch: a sales line has to be saleable (Finished Goods) and coverable
    def stock_rows():
        return {x["id"]: x for x in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"]}

    items_page = arif.get(f"{BASE}/items", params={"size": 200}).json()
    rows = items_page["data"] if isinstance(items_page, dict) else items_page
    sr = stock_rows()
    siid = [x["id"] for x in rows if x["group"] == "Finished Goods" and sr.get(x["id"], {}).get("byBranch", {}).get(branch, 0) >= 10][0]

    def sold_held():
        r = stock_rows()[siid]
        return r["remain"], r["byBranch"].get(branch, 0), r["byBranch"].get(other, 0)

    def party(mode):
        rows = arif.get(f"{BASE}/customers", params={"size": 100}).json()
        return [c for c in (rows["data"] if isinstance(rows, dict) else rows) if c["mode"] == mode][0]

    cust = party("Local")
    sold0, split0 = (float(psql(f"select sold from items where id = '{siid}'")) if DB_URL else None), sold_held()
    inv_body = {"customerId": cust["id"], "issueDate": tdate, "issueTime": "10:20", "deliveryAddress": "", "vehicle": "",
                "method": "Cash", "discount": 0, "paid": 0, "vds": False, "issuedBy": "Arif Hossain",
                "designation": "Sales Officer", "narration": f"R5.3 invoice {TAG}", "process": "Created",
                "branchId": branch, "lines": [{"itemId": siid, "qty": 2, "price": 100, "sdRate": 0, "vatRate": 5}]}
    si = arif.post(f"{BASE}/sales", json=inv_body)
    sid, sno = si.json().get("id"), si.json().get("invoiceNo")
    check(si.status_code == 201 and si.json()["process"] == "Created" and "export" not in si.json()
          and str(sno).startswith("S-") and si.json()["challanNo"]
          and [h["action"] for h in si.json()["history"]] == ["created"],
          f"native (R5.3): a sales draft is created, numbered and challaned ({si.status_code} {sno})")
    check(sold_held() == split0, "R5.3: a draft invoice moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from sales where id = '{sid}' and process = 'Created' and export_deemed is null") == "1"
              and psql(f"select count(*) from sale_lines where sale_id = '{sid}'") == "1",
              "R5.3: the draft is a row in sales, and its line a row in sale_lines")
    sa = arif.patch(f"{BASE}/sales/{sid}", json={"process": "Approved"})
    check(sa.status_code == 200 and sa.json()["process"] == "Approved"
          and sold_held() == (split0[0] - 2, split0[1] - 2, split0[2]),
          f"R5.3: approving moves the stock out, and the branch split, served from the tables, follows ({sa.status_code})")
    led = arif.get(f"{BASE}/items/{siid}/ledger").json()
    check(any(e.get("ref") == sno for e in led["entries"]), "R5.3: …and the item's ledger, derived from every document, quotes it")
    if DB_URL:
        check(psql(f"select sold = {sold0 + 2} from items where id = '{siid}'") == "t",
              "R5.3: …and the counter it moved is written with it (items.sold)")
        check(psql(f"select jsonb_array_length(history) from sales where id = '{sid}'") == "2",
              "R5.3: the invoice's own history travels with the row")
    sc = arif.patch(f"{BASE}/sales/{sid}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(sc.status_code == 200 and sold_held() == split0, "R5.3: cancelling brings the stock back")
    if DB_URL:
        check(psql(f"select count(*) from sales where id = '{sid}' and process = 'Cancelled' and cancel_reason is not null") == "1"
              and psql(f"select sold = {sold0} from items where id = '{siid}'") == "t",
              "R5.3: …and the cancellation and the counter are stored on the rows")
    check(arif.patch(f"{BASE}/sales/{sid}", json={"process": "Cancelled", "reason": "again"}).status_code == 409,
          "R5.3: an invoice that is already cancelled refuses a second cancellation (409)")
    # editing a draft replaces its lines; deleting one stamps the row (its number stays retired) and the undo restores it
    s2 = arif.post(f"{BASE}/sales", json={**inv_body, "lines": [{"itemId": siid, "qty": 3, "price": 100, "sdRate": 0, "vatRate": 5}]}).json()
    se = arif.put(f"{BASE}/sales/{s2['id']}", json={**inv_body, "lines": [
        {"itemId": siid, "qty": 4, "price": 100, "sdRate": 0, "vatRate": 5},
        {"itemId": "i19", "qty": 1, "price": 50, "sdRate": 0, "vatRate": 5}]})
    check(se.status_code == 200 and [l["qty"] for l in se.json()["lines"]] == [4, 1]
          and [h["action"] for h in se.json()["history"]][-1] == "edited",
          f"R5.3: editing a draft invoice replaces its lines ({se.status_code})")
    if DB_URL:
        check(psql(f"select string_agg(item_id || ':' || qty::text, ',' order by ord) from sale_lines where sale_id = '{s2['id']}'")
              == f"{siid}:4.000,i19:1.000", "R5.3: …in the child table, in the order they are printed")
    sd = arif.delete(f"{BASE}/sales/{s2['id']}")
    check(sd.status_code == 200 and sd.json().get("ok") is True and arif.get(f"{BASE}/sales/{s2['id']}").status_code == 404,
          "R5.3: a draft invoice is deleted and leaves the register")
    if DB_URL:
        check(psql(f"select count(*) from sales where id = '{s2['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from sale_lines where sale_id = '{s2['id']}'") == "2",
              "R5.3: …as a stamped row that keeps its lines, so its number stays retired")
    s3 = arif.post(f"{BASE}/sales", json=inv_body).json()
    check(s3["invoiceNo"] != s2["invoiceNo"], f"R5.3: the next invoice takes a new number ({s2['invoiceNo']} → {s3['invoiceNo']})")
    sr = arif.post(f"{BASE}/sales/{s2['id']}/restore")
    check(sr.status_code == 200 and sr.json()["process"] == "Created"
          and [h["action"] for h in sr.json()["history"]][-1] == "restored"
          and arif.get(f"{BASE}/sales/{s2['id']}").status_code == 200,
          f"R5.3: the undo restores the draft, with its history ({sr.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from sales where id = '{s2['id']}' and deleted_at is null") == "1",
              "R5.3: …by clearing the stamp on the row")
    # an export invoice carries its shipping documents as columns and takes its proceeds (PRC) entries as rows
    fcust = party("Foreign")
    # dated like the demo's own exports: a proceeds entry has to fall between the invoice and the company's today,
    # which is a fixed demo date, not the day the suite runs
    xdate = arif.get(f"{BASE}/sales", params={"size": 5, "category": "all", "trade": "export,deemed",
                                             "sort": "issueDate.desc"}).json()["data"][0]["issueDate"]
    ex = arif.post(f"{BASE}/sales", json={**inv_body, "customerId": fcust["id"], "issueDate": xdate, "process": "Approved",
                                          "export": {"deemed": False, "lcNo": f"LC{TAG}", "lcDate": xdate, "customsHouse": "CTG",
                                                     "country": "Germany", "billNo": f"BE{TAG}", "billDate": xdate,
                                                     "shippingAddress": "Hamburg", "currency": "USD", "fcValue": 1000,
                                                     "exchangeRate": 119.5}})
    xid = ex.json().get("id")
    check(ex.status_code == 201 and ex.json()["mode"] == "Foreign" and ex.json()["vat"] == 0
          and ex.json()["export"]["lcNo"] == f"LC{TAG}" and "realisations" not in ex.json()["export"],
          f"native (R5.3): an export invoice is zero-rated and carries its shipping documents ({ex.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from sales where id = '{xid}' and export_deemed = false and export_lc_no = 'LC{TAG}'"
                   f" and export_fc_value = 1000 and export_currency = 'USD'") == "1",
              "R5.3: …as columns of its own row, so an LC, a country or an FC value is queryable")
    rz = arif.post(f"{BASE}/sales/{xid}/realisations", json={"date": xdate, "bank": "Sonali Bank", "prcNo": f"prc{TAG}",
                                                            "fcAmount": 400, "rate": 119.5})
    entries = rz.json().get("export", {}).get("realisations", []) if rz.status_code == 201 else []
    rid = entries[-1].get("id") if entries else None
    check(rz.status_code == 201 and len(entries) == 1 and entries[0]["bdt"] == 47800.0
          and entries[0]["prcNo"] == f"PRC{TAG}".upper()
          and [h.get("note") or "" for h in rz.json()["history"]][-1].startswith("Proceeds realised:"),
          f"R5.3: proceeds realised against the invoice, in BDT at the entered rate ({rz.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from sale_realisations where sale_id = '{xid}'"
                   f" and prc_no = upper('PRC{TAG}') and bdt = 47800") == "1",
              "R5.3: …as a row of its own, the PRC number upper-cased")
    dup = arif.post(f"{BASE}/sales/{xid}/realisations", json={"date": xdate, "bank": "Sonali Bank", "prcNo": f"PRC{TAG}",
                                                             "fcAmount": 10, "rate": 119.5})
    check(dup.status_code == 422 and dup.json()["errors"].get("prcNo") == ["duplicate"],
          "R5.3: a PRC already on an invoice is refused (422 duplicate)")
    over = arif.post(f"{BASE}/sales/{xid}/realisations", json={"date": xdate, "bank": "Sonali Bank", "prcNo": f"prc2{TAG}",
                                                              "fcAmount": 5000, "rate": 119.5})
    check(over.status_code == 422 and over.json()["errors"].get("fcAmount") == ["exceedsOutstanding"],
          "R5.3: …and so is more than the invoice's outstanding foreign-currency value")
    rr = arif.delete(f"{BASE}/sales/{xid}/realisations", params={"rid": rid})
    check(rr.status_code == 200 and rr.json()["export"]["realisations"] == []
          and arif.post(f"{BASE}/sales/{xid}/realisations", json={"date": xdate, "bank": "Sonali Bank",
                                                                 "prcNo": f"PRC{TAG}", "fcAmount": 10, "rate": 119.5}).status_code == 201,
          "R5.3: removing an entry leaves the list on the invoice — and frees the PRC number again")
    cr = arif.get(f"{BASE}/sales/{xid}/creditable")
    check(cr.status_code == 200 and cr.json()["sale"]["invoiceNo"] == ex.json()["invoiceNo"]
          and cr.json()["lines"][0]["remaining"] == cr.json()["lines"][0]["soldQty"],
          f"R5.3: what is still returnable on an invoice is served from its rows ({cr.status_code})")
    # a service sale is its own register and its own number series, and moves no stock
    code = arif.get(f"{BASE}/sale-services").json()[0]
    split1 = sold_held()   # the approved export invoice above moved stock out; a service sale must not move any
    ss = arif.post(f"{BASE}/sales", json={**inv_body, "category": "service", "lines": [
        {"itemId": code["id"], "qty": 1, "price": 5000, "sdRate": 0, "vatRate": 15}]})
    check(ss.status_code == 201 and ss.json()["category"] == "service" and str(ss.json()["invoiceNo"]).startswith("SS-")
          and sold_held() == split1, f"native (R5.3): a service sale is numbered in its own series and moves no stock ({ss.status_code})")
    b1 = arif.post(f"{BASE}/sales", json=inv_body).json()
    bk = arif.post(f"{BASE}/sales/bulk", json={"ids": [b1["id"], sid], "action": "approve"})
    check(bk.status_code == 200 and bk.json() == {"done": [b1["id"]], "skipped": [sid]},
          f"R5.3: bulk approve takes the drafts and reports the ones it skipped ({bk.status_code})")
    rows0 = psql("select count(*) from sales") if DB_URL else None
    sh = arif.post(f"{BASE}/sales", json={**inv_body, "process": "Approved", "lines": [
        {"itemId": siid, "qty": 100000, "price": 1, "sdRate": 0, "vatRate": 5}]})
    check(sh.status_code == 422 and "Insufficient stock" in sh.json().get("title", ""),
          f"R5.3: approving more than the branch holds is a 422 ({sh.status_code})")
    if DB_URL:
        check(psql("select count(*) from sales") == rows0, "R5.3: …and the refused invoice left no row behind")
        check(psql(COMPAT_GONE) == "t",
              "R5.3: the snapshot carries no sales collection at all")
        check(int(psql("select count(*) from sales")) >= 227 and int(psql("select count(*) from sale_lines")) >= 442
              and int(psql("select count(*) from sales where export_deemed is not null")) >= 16
              and int(psql("select count(*) from sales where category = 'service'")) >= 11
              and int(psql("select count(*) from sale_realisations")) >= 12,
              "R5.3: the demo invoices were seeded into their tables, export headers and proceeds entries included")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into sales (id, invoice_no, challan_no, issue_date, issue_time, process, branch_id, "
                                "branch_name, customer_id, customer_name, customer_bin, customer_address, delivery_address, "
                                "mode, method, vds, subtotal, sd, vat, discount, net_total, paid, due, issued_by, designation, "
                                "created_at) select 'dups" + TAG + "', invoice_no, challan_no, issue_date, issue_time, process, "
                                "branch_id, branch_name, customer_id, customer_name, customer_bin, customer_address, "
                                "delivery_address, mode, method, vds, 0, 0, 0, 0, 0, 0, 0, 'x', 'y', now() from sales limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.3: the database refuses a duplicate invoice number (unique index), not just the API")

    # ── R5.3: the purchases ────────────────────────────────────────────────────────────────────────────────────
    print("R5.3: purchases are rows too — imports with their Bill of Entry and the duty every line cleared")

    def vendors(mode):
        rows = arif.get(f"{BASE}/vendors", params={"size": 100}).json()
        return [v for v in (rows["data"] if isinstance(rows, dict) else rows) if v["mode"] == mode]

    sv = arif.get(f"{BASE}/services").json()[0]
    vend = vendors("Local")[0]
    # a purchase moves `purchased`, so these checks buy demo SKUs of their own: the R5.2 restart check still
    # requires the item this suite created (`iid`) to hold exactly the 40 it opened with
    buyable = [x["id"] for x in arif.get(f"{BASE}/items", params={"size": 200}).json()["data"]
               if x["group"] != "Finished Goods" and x["id"] != iid]
    piid, other_buyable = buyable[0], buyable[1]

    def pheld():
        r = stock_rows()[piid]
        return r["remain"], r["byBranch"].get(branch, 0), r["byBranch"].get(other, 0)

    bought0, split2 = (float(psql(f"select purchased from items where id = '{piid}'")) if DB_URL else None), pheld()
    pur_body = {"vendorId": vend["id"], "issueDate": tdate, "challanNo": f"CH{TAG}", "challanDate": tdate,
                "method": "Cash", "discount": 0, "paid": 0, "issuedBy": "Arif Hossain",
                "designation": "Purchase Officer", "narration": f"R5.3 purchase {TAG}", "process": "Created",
                "branchId": branch, "lines": [{"itemId": piid, "qty": 5, "price": 100, "sdRate": 0, "vatRate": 5}]}
    pi = arif.post(f"{BASE}/purchases", json=pur_body)
    pid, pno = pi.json().get("id"), pi.json().get("invoiceNo")
    check(pi.status_code == 201 and pi.json()["process"] == "Created" and "boe" not in pi.json()
          and str(pno).startswith("P-") and pi.json()["challanNo"] == f"CH{TAG}"
          and [h["action"] for h in pi.json()["history"]] == ["created"],
          f"native (R5.3): a purchase draft is created and numbered ({pi.status_code} {pno})")
    check(pheld() == split2, "R5.3: a draft purchase moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from purchases where id = '{pid}' and process = 'Created' and boe_no is null") == "1"
              and psql(f"select count(*) from purchase_lines where purchase_id = '{pid}'") == "1",
              "R5.3: the draft is a row in purchases, and its line a row in purchase_lines")
    pa = arif.patch(f"{BASE}/purchases/{pid}", json={"process": "Approved"})
    check(pa.status_code == 200 and pa.json()["process"] == "Approved"
          and pheld() == (split2[0] + 5, split2[1] + 5, split2[2]),
          f"R5.3: approving moves the stock in, and the branch split, served from the tables, follows ({pa.status_code})")
    pled = arif.get(f"{BASE}/items/{piid}/ledger").json()
    check(any(e.get("ref") == pno for e in pled["entries"]),
          "R5.3: …and the item's ledger, derived from every document, quotes it")
    if DB_URL:
        check(psql(f"select purchased = {bought0 + 5} from items where id = '{piid}'") == "t",
              "R5.3: …and the counter it moved is written with it (items.purchased)")
        check(psql(f"select jsonb_array_length(history) from purchases where id = '{pid}'") == "2",
              "R5.3: the document's own history travels with the row")
    pcan = arif.patch(f"{BASE}/purchases/{pid}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(pcan.status_code == 200 and pheld() == split2, "R5.3: cancelling takes the stock back out")
    if DB_URL:
        check(psql(f"select count(*) from purchases where id = '{pid}' and process = 'Cancelled'"
                   f" and cancel_reason is not null") == "1"
              and psql(f"select purchased = {bought0} from items where id = '{piid}'") == "t",
              "R5.3: …and the cancellation and the counter are stored on the rows")
    check(arif.patch(f"{BASE}/purchases/{pid}", json={"process": "Cancelled", "reason": "again"}).status_code == 409,
          "R5.3: a purchase that is already cancelled refuses a second cancellation (409)")
    # editing a draft replaces its lines; deleting one stamps the row (its number stays retired) and the undo restores it
    p2 = arif.post(f"{BASE}/purchases", json={**pur_body, "lines": [
        {"itemId": piid, "qty": 3, "price": 100, "sdRate": 0, "vatRate": 5}]}).json()
    pe = arif.put(f"{BASE}/purchases/{p2['id']}", json={**pur_body, "lines": [
        {"itemId": piid, "qty": 4, "price": 100, "sdRate": 0, "vatRate": 5},
        {"itemId": other_buyable, "qty": 1, "price": 50, "sdRate": 0, "vatRate": 5}]})
    check(pe.status_code == 200 and [l["qty"] for l in pe.json()["lines"]] == [4, 1]
          and [h["action"] for h in pe.json()["history"]][-1] == "edited",
          f"R5.3: editing a draft purchase replaces its lines ({pe.status_code})")
    if DB_URL:
        check(psql(f"select string_agg(item_id || ':' || qty::text, ',' order by ord) from purchase_lines"
                   f" where purchase_id = '{p2['id']}'") == f"{piid}:4.000,{other_buyable}:1.000",
              "R5.3: …in the child table, in the order they are printed")
    pdel = arif.delete(f"{BASE}/purchases/{p2['id']}")
    check(pdel.status_code == 200 and pdel.json().get("ok") is True
          and arif.get(f"{BASE}/purchases/{p2['id']}").status_code == 404,
          "R5.3: a draft purchase is deleted and leaves the register")
    if DB_URL:
        check(psql(f"select count(*) from purchases where id = '{p2['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from purchase_lines where purchase_id = '{p2['id']}'") == "2",
              "R5.3: …as a stamped row that keeps its lines, so its number stays retired")
    p3 = arif.post(f"{BASE}/purchases", json=pur_body).json()
    check(p3["invoiceNo"] != p2["invoiceNo"],
          f"R5.3: the next purchase takes a new number ({p2['invoiceNo']} → {p3['invoiceNo']})")
    pr = arif.post(f"{BASE}/purchases/{p2['id']}/restore")
    check(pr.status_code == 200 and pr.json()["process"] == "Created"
          and [h["action"] for h in pr.json()["history"]][-1] == "restored"
          and arif.get(f"{BASE}/purchases/{p2['id']}").status_code == 200,
          f"R5.3: the undo restores the draft, with its history ({pr.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from purchases where id = '{p2['id']}' and deleted_at is null") == "1",
              "R5.3: …by clearing the stamp on the row")
    swap = arif.put(f"{BASE}/purchases/{p3['id']}", json={**pur_body, "category": "service", "lines": [
        {"itemId": sv["id"], "qty": 1, "price": 1000, "sdRate": 0, "vatRate": 10}]})
    check(swap.status_code == 409, f"R5.3: a goods purchase cannot become a service purchase ({swap.status_code})")
    # an import purchase carries its Bill of Entry, and every line's duty breakdown, as columns of its own
    imp = arif.post(f"{BASE}/purchases", json={**pur_body, "vendorId": vendors("Foreign")[0]["id"],
                                              "challanNo": f"BOE{TAG}", "process": "Approved",
                                              "boe": {"lcNo": f"LC{TAG}", "lcDate": tdate, "customsHouse": "CTG",
                                                      "origin": "China", "bonded": False},
                                              "lines": [{"itemId": piid, "qty": 10, "usd": 100, "usdRate": 119.5,
                                                         "cdRate": 25, "rdRate": 5, "sdRate": 0, "vatRate": 15,
                                                         "aitRate": 5, "atRate": 5}]})
    impid = imp.json().get("id")
    duty = imp.json()["lines"][0].get("duty", {}) if imp.status_code == 201 else {}
    check(imp.status_code == 201 and imp.json()["mode"] == "Foreign"
          and imp.json()["boe"]["no"] == f"BOE{TAG}" and imp.json()["boe"]["lcNo"] == f"LC{TAG}"
          and "bonded" not in imp.json()["boe"] and duty.get("av") == 11950 and duty.get("cd") == 2987.5
          and imp.json()["tti"] == 7289.5,
          f"native (R5.3): an import purchase prices its Bill of Entry lines with the duty stack ({imp.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from purchases where id = '{impid}' and boe_no = 'BOE{TAG}'"
                   f" and boe_lc_no = 'LC{TAG}' and boe_origin = 'China' and boe_bonded is null") == "1",
              "R5.3: …the Bill of Entry as columns of its own row, so a BoE, an LC or a country is queryable")
        check(psql(f"select count(*) from purchase_lines where purchase_id = '{impid}' and duty_av = 11950"
                   f" and duty_cd = 2987.5 and duty_at = 776.75 and tti = 7289.5 and foregone_total is null") == "1",
              "R5.3: …and the duty every line cleared as columns, so a BoE's duty is a sum, not a walk")
        bonded = int(psql("select count(*) from purchase_lines where foregone_total is not null"))
        check(bonded >= 4,
              f"R5.3: the bonded (IM-7) entries the bond register reports kept their duty foregone ({bonded} lines)")
    # a service purchase is its own register and its own number series, and moves no stock
    split3 = pheld()
    ps = arif.post(f"{BASE}/purchases", json={**pur_body, "category": "service", "lines": [
        {"itemId": sv["id"], "qty": 1, "price": 5000, "sdRate": 0, "vatRate": 10}]})
    check(ps.status_code == 201 and ps.json()["category"] == "service"
          and str(ps.json()["invoiceNo"]).startswith("PS-") and pheld() == split3,
          f"native (R5.3): a service purchase is numbered in its own series and moves no stock ({ps.status_code})")
    b1 = arif.post(f"{BASE}/purchases", json=pur_body).json()
    bk = arif.post(f"{BASE}/purchases/bulk", json={"ids": [b1["id"], pid], "action": "approve"})
    check(bk.status_code == 200 and bk.json() == {"done": [b1["id"]], "skipped": [pid]},
          f"R5.3: bulk approve takes the drafts and reports the ones it skipped ({bk.status_code})")
    rt = arif.get(f"{BASE}/purchases/{b1['id']}/returnable")
    check(rt.status_code == 200 and rt.json()["purchase"]["invoiceNo"] == b1["invoiceNo"]
          and rt.json()["lines"][0]["remaining"] == rt.json()["lines"][0]["purchasedQty"],
          f"R5.3: what is still returnable on a purchase is served from its rows ({rt.status_code})")
    check(arif.get(f"{BASE}/purchases/{ps.json()['id']}/returnable").status_code == 404,
          "R5.3: …and a service purchase has nothing to return (404)")
    if DB_URL:
        check(psql(COMPAT_GONE) == "t",
              "R5.3: the snapshot carries no purchases collection at all")
        check(int(psql("select count(*) from purchases")) >= 101 and int(psql("select count(*) from purchase_lines")) >= 101
              and int(psql("select count(*) from purchases where boe_no is not null")) >= 40
              and int(psql("select count(*) from purchases where category = 'service'")) >= 18,
              "R5.3: the demo purchases were seeded into their tables, Bills of Entry and duty breakdowns included")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into purchases (id, invoice_no, challan_no, challan_date, issue_date, process, "
                                "branch_id, branch_name, vendor_id, vendor_name, vendor_bin, vendor_address, mode, method, "
                                "subtotal, sd, vat, discount, net_total, paid, due, tti, rebate, issued_by, designation, "
                                "created_at) select 'dupp" + TAG + "', invoice_no, challan_no, challan_date, issue_date, "
                                "process, branch_id, branch_name, vendor_id, vendor_name, vendor_bin, vendor_address, mode, "
                                "method, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'x', 'y', now() from purchases limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.3: the database refuses a duplicate purchase number (unique index), not just the API")

    # ── R5.3: the credit and debit notes ─────────────────────────────────────────────────────────────────────
    print("R5.3: credit and debit notes are rows too — one table, `kind` telling them apart")
    # an approved invoice and an approved purchase to raise notes against, on the SKUs these checks already use
    csale = arif.post(f"{BASE}/sales", json={**inv_body, "process": "Approved", "lines": [
        {"itemId": siid, "qty": 6, "price": 100, "sdRate": 0, "vatRate": 5}]}).json()
    csale2 = arif.post(f"{BASE}/sales", json={**inv_body, "process": "Approved", "lines": [
        {"itemId": siid, "qty": 6, "price": 100, "sdRate": 0, "vatRate": 5}]}).json()
    cpur = arif.post(f"{BASE}/purchases", json={**pur_body, "process": "Approved", "challanNo": f"CHN{TAG}", "lines": [
        {"itemId": piid, "qty": 6, "price": 100, "sdRate": 0, "vatRate": 5}]}).json()
    unsold = arif.post(f"{BASE}/sales", json=inv_body).json()
    cn_body = {"saleId": csale["id"], "issueDate": tdate, "issueTime": "11:00", "reason": "quality",
               "note": f"R5.3 credit {TAG}", "issuedBy": "Arif Hossain", "designation": "Sales Officer",
               "process": "Created", "lines": [{"itemId": siid, "qty": 2}]}
    split4 = sold_held()
    cn = arif.post(f"{BASE}/credit-notes", json=cn_body)
    cnid, cno = cn.json().get("id"), cn.json().get("no")
    cnline = cn.json()["lines"][0] if cn.status_code == 201 else {}
    check(cn.status_code == 201 and cn.json()["process"] == "Created" and str(cno).startswith("CN-")
          and cn.json()["saleNo"] == csale["invoiceNo"] and cnline.get("soldQty") == 6 and cnline.get("price") == 100
          and "tti" not in cn.json() and [h["action"] for h in cn.json()["history"]] == ["created"],
          f"native (R5.3): a credit note is raised against the invoice and priced pro rata ({cn.status_code} {cno})")
    check(sold_held() == split4, "R5.3: a draft note moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from notes where id = '{cnid}' and kind = 'credit' and process = 'Created'"
                   f" and source_id = '{csale['id']}' and party_id = '{csale['customerId']}' and tti is null") == "1"
              and psql(f"select count(*) from note_lines where note_id = '{cnid}' and sold_qty = 6"
                       f" and purchased_qty is null") == "1",
              "R5.3: the draft is a row in notes, and its line a row in note_lines")
    si_sold = float(psql(f"select sold from items where id = '{siid}'")) if DB_URL else None
    cna = arif.patch(f"{BASE}/credit-notes/{cnid}", json={"process": "Approved"})
    check(cna.status_code == 200 and cna.json()["process"] == "Approved"
          and sold_held() == (split4[0] + 2, split4[1] + 2, split4[2]),
          f"R5.3: approving brings the goods back, and the branch split, served from the tables, follows ({cna.status_code})")
    cnled = arif.get(f"{BASE}/items/{siid}/ledger").json()
    check(any(e.get("ref") == cno for e in cnled["entries"]),
          "R5.3: …and the item's ledger, derived from every document, quotes the note")
    if DB_URL:
        check(psql(f"select sold = {si_sold - 2} from items where id = '{siid}'") == "t",
              "R5.3: …and the counter it moved is written with it (items.sold)")
        check(psql(f"select jsonb_array_length(history) from notes where id = '{cnid}'") == "2",
              "R5.3: the note's own history travels with the row")
    check(arif.get(f"{BASE}/sales/{csale['id']}/creditable").json()["lines"][0]["remaining"] == 4,
          "R5.3: …and what is still returnable on the invoice is 4 of the 6 it sold")
    cnc = arif.patch(f"{BASE}/credit-notes/{cnid}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(cnc.status_code == 200 and sold_held() == split4, "R5.3: cancelling sends the goods back out again")
    if DB_URL:
        check(psql(f"select count(*) from notes where id = '{cnid}' and process = 'Cancelled'"
                   f" and cancel_reason is not null") == "1"
              and psql(f"select sold = {si_sold} from items where id = '{siid}'") == "t",
              "R5.3: …and the cancellation and the counter are stored on the rows")
    check(arif.patch(f"{BASE}/credit-notes/{cnid}", json={"process": "Cancelled", "reason": "again"}).status_code == 409,
          "R5.3: a note that is already cancelled refuses a second cancellation (409)")
    # editing a draft replaces its lines; a note stays with the invoice it was raised against
    cn2 = arif.post(f"{BASE}/credit-notes", json=cn_body).json()
    cne = arif.put(f"{BASE}/credit-notes/{cn2['id']}", json={**cn_body, "lines": [{"itemId": siid, "qty": 3}]})
    check(cne.status_code == 200 and [l["qty"] for l in cne.json()["lines"]] == [3]
          and [h["action"] for h in cne.json()["history"]][-1] == "edited",
          f"R5.3: editing a draft note replaces its lines ({cne.status_code})")
    if DB_URL:
        check(psql(f"select qty::text from note_lines where note_id = '{cn2['id']}' and ord = 1") == "3.000",
              "R5.3: …in the child table")
    moved = arif.put(f"{BASE}/credit-notes/{cn2['id']}", json={**cn_body, "saleId": csale2["id"]})
    check(moved.status_code == 409, f"R5.3: a credit note cannot move to another invoice ({moved.status_code})")
    over = arif.post(f"{BASE}/credit-notes", json={**cn_body, "lines": [{"itemId": siid, "qty": 1000}]})
    check(over.status_code == 422 and over.json()["errors"].get("lines.0.qty") == ["exceedsRemaining"],
          "R5.3: returning more than the invoice sold is a 422 (exceedsRemaining)")
    notapp = arif.post(f"{BASE}/credit-notes", json={**cn_body, "saleId": unsold["id"]})
    check(notapp.status_code == 422 and notapp.json()["errors"].get("saleId") == ["notApproved"],
          "R5.3: a note against a draft invoice is a 422 (notApproved)")
    cnd = arif.delete(f"{BASE}/credit-notes/{cn2['id']}")
    check(cnd.status_code == 200 and cnd.json().get("ok") is True
          and arif.get(f"{BASE}/credit-notes/{cn2['id']}").status_code == 404,
          "R5.3: a draft note is deleted and leaves the register")
    if DB_URL:
        check(psql(f"select count(*) from notes where id = '{cn2['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from note_lines where note_id = '{cn2['id']}'") == "1",
              "R5.3: …as a stamped row that keeps its lines, so its id stays retired")
    cn3 = arif.post(f"{BASE}/credit-notes", json=cn_body).json()
    check(cn3["no"] != cn2["no"] and int(cn3["id"][2:]) > int(cn2["id"][2:]),
          f"R5.3: the next note takes a new number and a new id ({cn2['no']} → {cn3['no']})")
    # the debit side: the same table, the other kind, and the two totals only a debit note has
    dn_body = {"purchaseId": cpur["id"], "issueDate": tdate, "issueTime": "11:00", "reason": "damaged",
               "note": f"R5.3 debit {TAG}", "issuedBy": "Arif Hossain", "designation": "Purchase Officer",
               "process": "Created", "lines": [{"itemId": piid, "qty": 2}]}
    split5 = pheld()
    dn = arif.post(f"{BASE}/debit-notes", json=dn_body)
    dnid, dno = dn.json().get("id"), dn.json().get("no")
    dnline = dn.json()["lines"][0] if dn.status_code == 201 else {}
    check(dn.status_code == 201 and str(dno).startswith("DN-") and dn.json()["purchaseNo"] == cpur["invoiceNo"]
          and dnline.get("purchasedQty") == 6 and dn.json()["tti"] == 0 and "rebate" in dn.json()
          and [h["action"] for h in dn.json()["history"]] == ["created"],
          f"native (R5.3): a debit note is raised against the purchase and reverses its input tax ({dn.status_code} {dno})")
    if DB_URL:
        check(psql(f"select count(*) from notes where id = '{dnid}' and kind = 'debit' and source_id = '{cpur['id']}'"
                   f" and tti is not null and rebate is not null") == "1"
              and psql(f"select count(*) from note_lines where note_id = '{dnid}' and purchased_qty = 6"
                       f" and sold_qty is null and rebate is not null") == "1",
              "R5.3: …as a row of the same table, with the two totals only a debit note has")
    check(sold_held() == split4 and pheld() == split5, "R5.3: a draft debit note moves no stock either")
    big = arif.post(f"{BASE}/debit-notes", json={**dn_body, "process": "Approved",
                                                "lines": [{"itemId": piid, "qty": 100000}]})
    check(big.status_code == 422 and big.json()["errors"].get("lines.0.qty") == ["exceedsRemaining"],
          f"R5.3: returning more than the purchase bought is a 422 ({big.status_code})")
    # 4, not 6: the draft above already has 2 of the purchase's 6 units earmarked
    dn3 = arif.post(f"{BASE}/debit-notes", json={**dn_body, "lines": [{"itemId": piid, "qty": 4}]}).json()
    away = pheld()[1]
    out = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": tdate,
                    "vehicle": "", "note": f"R5.3 stock away {TAG}", "lines": [{"itemId": piid, "qty": away}],
                    "process": "Approved"})
    shortdn = arif.patch(f"{BASE}/debit-notes/{dn3['id']}", json={"process": "Approved"})
    back = arif.post(f"{BASE}/transfers", json={"fromBranchId": other, "toBranchId": branch, "date": tdate,
                     "vehicle": "", "note": f"R5.3 stock back {TAG}", "lines": [{"itemId": piid, "qty": away}],
                     "process": "Approved"})
    check(out.status_code in (200, 201) and back.status_code in (200, 201) and shortdn.status_code == 409
          and "Insufficient stock to return" in shortdn.json().get("title", ""),
          f"R5.3: approving a return the branch no longer holds is a 409 ({shortdn.status_code})")
    pi_pur = float(psql(f"select purchased from items where id = '{piid}'")) if DB_URL else None
    dna = arif.patch(f"{BASE}/debit-notes/{dnid}", json={"process": "Approved"})
    check(dna.status_code == 200 and pheld() == (split5[0] - 2, split5[1] - 2, split5[2]),
          f"R5.3: approving a debit note takes the goods back out ({dna.status_code})")
    if DB_URL:
        check(psql(f"select purchased = {pi_pur - 2} from items where id = '{piid}'") == "t",
              "R5.3: …and the counter it moved is written with it (items.purchased)")
    check(arif.get(f"{BASE}/purchases/{cpur['id']}/returnable").json()["lines"][0]["remaining"] == 0,
          "R5.3: …and what is still returnable on the purchase deducts every note that is not cancelled")
    svc_pur = ps.json()["id"]
    svcdn = arif.post(f"{BASE}/debit-notes", json={**dn_body, "purchaseId": svc_pur})
    check(svcdn.status_code == 422 and svcdn.json()["errors"].get("purchaseId") == ["unknown"],
          "R5.3: a service purchase has no goods to return (422)")
    dnc = arif.patch(f"{BASE}/debit-notes/{dnid}", json={"process": "Cancelled", "reason": f"R5.3 cancelled {TAG}"})
    check(dnc.status_code == 200 and pheld() == split5, "R5.3: cancelling puts the goods back on the books")
    if DB_URL:
        check(psql(f"select count(*) from notes where id = '{dnid}' and process = 'Cancelled'"
                   f" and cancel_reason is not null") == "1"
              and psql(f"select purchased = {pi_pur} from items where id = '{piid}'") == "t",
              "R5.3: …and the cancellation and the counter are stored on the rows")
    dn2 = arif.post(f"{BASE}/debit-notes", json=dn_body).json()
    dnd = arif.delete(f"{BASE}/debit-notes/{dn2['id']}")
    check(dnd.status_code == 200 and arif.get(f"{BASE}/debit-notes/{dn2['id']}").status_code == 404
          and arif.delete(f"{BASE}/debit-notes/{dnid}").status_code == 409,
          "R5.3: a draft debit note is deleted, and an approved one is not (409)")
    if DB_URL:
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "R5.3: the snapshot carries neither note collection at all")
        check(int(psql("select count(*) from notes where kind = 'credit'")) >= 5
              and int(psql("select count(*) from notes where kind = 'debit'")) >= 5
              and int(psql("select count(*) from note_lines")) >= 10,
              "R5.3: the demo notes were seeded into their tables, both kinds with their lines")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into notes (id, kind, no, source_id, source_no, source_date, source_mode, "
                                "challan_no, party_id, party_name, party_bin, party_address, branch_id, branch_name, "
                                "issue_date, issue_time, reason, issued_by, designation, process, subtotal, sd, vat, "
                                "total, created_at) select 'dupn" + TAG + "', kind, no, source_id, source_no, "
                                "source_date, source_mode, challan_no, party_id, party_name, party_bin, party_address, "
                                "branch_id, branch_name, issue_date, issue_time, reason, issued_by, designation, "
                                "process, 0, 0, 0, 0, now() from notes limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.3: the database refuses a duplicate note number (unique index), not just the API")

    # ── R5.4: the opening stock entries ───────────────────────────────────────────────────────────────────────
    print("R5.4: opening stock entries are rows, and the stock derived from them follows")
    osplit0 = held()
    oopen0 = float(psql(f"select opening from items where id = '{iid}'")) if DB_URL else None
    os_body = {"itemId": iid, "branchId": branch, "date": tdate, "inputTax": "standard", "qty": 7, "price": 12.5,
               "vatPaid": 3.25, "note": f"R5.4 opening {TAG}", "process": "Created"}
    os1 = arif.post(f"{BASE}/opening-stock", json=os_body)
    oid, ono = os1.json().get("id"), os1.json().get("no")
    check(os1.status_code == 201 and os1.json()["process"] == "Created" and str(ono).startswith("OS-")
          and os1.json()["value"] == 87.5 and os1.json()["branchName"]
          and [h["action"] for h in os1.json()["history"]] == ["created"],
          f"native (R5.4): an opening entry is created and numbered ({os1.status_code} {ono})")
    check(held() == osplit0, "R5.4: a draft entry moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from opening_entries where id = '{oid}' and process = 'Created'"
                   f" and item_id = '{iid}' and value = 87.5 and vat_paid = 3.25 and bond_boe_no is null") == "1",
              "R5.4: the draft is a row in opening_entries, with its value and the VAT paid on it")
    osa = arif.patch(f"{BASE}/opening-stock/{oid}", json={"process": "Approved"})
    check(osa.status_code == 200 and osa.json()["process"] == "Approved"
          and held() == (osplit0[0] + 7, osplit0[1] + 7, osplit0[2]),
          f"R5.4: approving brings the quantity in, and the branch split, served from the tables, follows ({osa.status_code})")
    oled = arif.get(f"{BASE}/items/{iid}/ledger").json()
    check(any(e.get("ref") == ono and e.get("type") == "opening" for e in oled["entries"]),
          "R5.4: …and the item's ledger quotes the entry as its opening row")
    if DB_URL:
        check(psql(f"select opening = {oopen0 + 7} from items where id = '{iid}'") == "t",
              "R5.4: …and the counter it moved is written with it (items.opening)")
        check(psql(f"select jsonb_array_length(history) from opening_entries where id = '{oid}'") == "2",
              "R5.4: the entry's own history travels with the row")
    osc = arif.patch(f"{BASE}/opening-stock/{oid}", json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"})
    check(osc.status_code == 200 and held() == osplit0, "R5.4: cancelling takes the quantity back out")
    if DB_URL:
        check(psql(f"select count(*) from opening_entries where id = '{oid}' and process = 'Cancelled'"
                   f" and cancel_reason is not null") == "1"
              and psql(f"select opening = {oopen0} from items where id = '{iid}'") == "t",
              "R5.4: …and the cancellation and the counter are stored on the rows")
    check(arif.patch(f"{BASE}/opening-stock/{oid}", json={"process": "Cancelled", "reason": "again"}).status_code == 409,
          "R5.4: an entry that is already cancelled refuses a second cancellation (409)")
    check(arif.patch(f"{BASE}/opening-stock/{oid}", json={"process": "Approved"}).status_code == 409,
          "R5.4: …and a cancelled entry cannot be approved again (409)")
    # editing a draft replaces its fields; deleting one stamps the row, so its id and number stay retired
    os2 = arif.post(f"{BASE}/opening-stock", json=os_body).json()
    ose = arif.put(f"{BASE}/opening-stock/{os2['id']}", json={**os_body, "qty": 3, "price": 10, "inputTax": "exempt"})
    check(ose.status_code == 200 and ose.json()["qty"] == 3 and ose.json()["value"] == 30
          and ose.json()["inputTax"] == "exempt" and [h["action"] for h in ose.json()["history"]][-1] == "edited",
          f"R5.4: editing a draft entry replaces its fields ({ose.status_code})")
    if DB_URL:
        check(psql(f"select qty::text || '/' || value::text || '/' || input_tax from opening_entries"
                   f" where id = '{os2['id']}'") == "3.000/30.00/exempt", "R5.4: …on the row")
    bad_item = arif.post(f"{BASE}/opening-stock", json={**os_body, "itemId": "nosuchitem"})
    bad_branch = arif.post(f"{BASE}/opening-stock", json={**os_body, "branchId": "nosuchbranch"})
    check(bad_item.status_code == 422 and bad_item.json()["errors"].get("itemId") == ["unknown"]
          and bad_branch.status_code == 422 and bad_branch.json()["errors"].get("branchId") == ["unknownBranch"],
          "R5.4: an unknown SKU or branch is a 422, from the mock's own rules")
    osd = arif.delete(f"{BASE}/opening-stock/{os2['id']}")
    check(osd.status_code == 200 and osd.json().get("ok") is True
          and arif.get(f"{BASE}/opening-stock/{os2['id']}").status_code == 404,
          "R5.4: a draft entry is deleted and leaves the register")
    if DB_URL:
        check(psql(f"select count(*) from opening_entries where id = '{os2['id']}' and deleted_at is not null") == "1",
              "R5.4: …as a stamped row, so its id stays retired")
    os3 = arif.post(f"{BASE}/opening-stock", json=os_body).json()
    check(os3["no"] != os2["no"] and int(os3["id"][2:]) > int(os2["id"][2:]),
          f"R5.4: the next entry takes a new number and a new id ({os2['no']} → {os3['no']})")
    check(arif.delete(f"{BASE}/opening-stock/{os3['id']}").status_code == 200
          and arif.get(f"{BASE}/opening-stock", params={"item": iid, "size": 100}).json()["total"]
          == int(psql(f"select count(*) from opening_entries where item_id = '{iid}' and deleted_at is null")) if DB_URL else True,
          "R5.4: the register's ?item= filter serves one SKU's entries from the table")
    if DB_URL:
        check(psql(COMPAT_GONE) == "t",
              "R5.4: the snapshot carries no openings collection at all")
        check(int(psql("select count(*) from opening_entries")) >= 24
              and int(psql("select count(*) from opening_entries where bond_boe_no is not null")) >= 2,
              "R5.4: the demo entries were seeded into their table, the R6.4 bond blocks with them")
        check(len(arif.get(f"{BASE}/vat/bond").json().get("rows", []) or []) >= 0
              and arif.get(f"{BASE}/vat/bond").status_code == 200,
              "R5.4: …and the bond register, which reads those blocks, still answers")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into opening_entries (id, no, item_id, name, hs_code, sku, uom, branch_id, "
                                "branch_name, date, input_tax, qty, price, value, vat_paid, process, issued_by, "
                                "created_at) select 'dupo" + TAG + "', no, item_id, name, hs_code, sku, uom, branch_id, "
                                "branch_name, date, input_tax, 0, 0, 0, 0, process, issued_by, now() "
                                "from opening_entries limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.4: the database refuses a duplicate entry number (unique index), not just the API")

    # ── R5.4: the production batches ──────────────────────────────────────────────────────────────────────────
    # The last collection the derived stock read from memory: a batch's lines are the finished goods, its consumption
    # the inputs the active BOM says they take, and approving one moves both counters (`items.prod_issue` and
    # `items.prod_receive`) in the same transaction as the row. The work orders, the BOMs and the production
    # configuration it is built from are still compat state, so they have to see a natively written batch at once.
    print("R5.4: production batches are rows, and the stock they consume and receive follows")

    def bfg_stock(*ids):
        rows = {x["id"]: x for x in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"]}
        return tuple(rows[i]["remain"] for i in ids)

    bom_page = arif.get(f"{BASE}/production/boms", params={"size": 100}).json()
    bom_rows = bom_page["data"] if isinstance(bom_page, dict) else bom_page
    bgid = sorted({b["itemId"] for b in bom_rows if b["process"] == "Approved"})[0]
    vendor_page = arif.get(f"{BASE}/vendors", params={"size": 100}).json()
    bvid = [v for v in (vendor_page["data"] if isinstance(vendor_page, dict) else vendor_page) if v.get("mode") == "Local"][0]["id"]
    batch_body = {"mode": "inHouse", "issueDate": tdate, "receiveDate": tdate, "remark": f"R5.4 batch {TAG}",
                  "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
                  "lines": [{"itemId": bgid, "issueQty": 10, "receiveQty": 10, "damageQty": 0}], "process": "Created"}
    bsplit0 = bfg_stock(bgid)
    b1 = arif.post(f"{BASE}/production/batches", json=batch_body)
    b1id, b1no = b1.json().get("id"), b1.json().get("no")
    bline = b1.json()["lines"][0]
    buses = {c["itemId"]: c["qty"] for c in b1.json().get("consumption", [])}
    binp = sorted(buses)[0]
    check(b1.status_code == 201 and b1.json()["process"] == "Created" and str(b1no).startswith("PB-")
          and bline["unitCost"] > 0 and b1.json()["value"] == round(bline["unitCost"] * 10, 2)
          and b1.json()["materialValue"] == round(sum(c["value"] for c in b1.json()["consumption"]), 2)
          and [h["action"] for h in b1.json()["history"]] == ["created"],
          f"native (R5.4): a batch is created and numbered, its line priced by the active BOM ({b1.status_code} {b1no})")
    check(len(buses) >= 1 and bfg_stock(bgid) == bsplit0,
          f"R5.4: the BOM's inputs are on the batch ({len(buses)} consumed), and a draft moves no stock")
    if DB_URL:
        check(psql(f"select count(*) from batches where id = '{b1id}' and process = 'Created' and mode = 'inHouse'") == "1"
              and psql(f"select count(*) from batch_lines where batch_id = '{b1id}'") == "1"
              and psql(f"select count(*) from batch_consumption where batch_id = '{b1id}'") == str(len(buses)),
              "R5.4: the draft is a row in batches, with its finished goods and the inputs it consumes")
    biss0 = float(psql(f"select prod_issue from items where id = '{binp}'")) if DB_URL else None
    brec0 = float(psql(f"select prod_receive from items where id = '{bgid}'")) if DB_URL else None
    bsplit_in = bfg_stock(binp)
    b1a = arif.patch(f"{BASE}/production/batches/{b1id}", json={"process": "Approved"})
    check(b1a.status_code == 200 and b1a.json()["process"] == "Approved"
          and bfg_stock(bgid, binp) == (round(bsplit0[0] + 10, 2), round(bsplit_in[0] - buses[binp], 2)),
          f"R5.4: approving receives the goods and consumes the inputs — the derived stock follows ({b1a.status_code})")
    bledger = arif.get(f"{BASE}/items/{bgid}/ledger").json()
    uledger = arif.get(f"{BASE}/items/{binp}/ledger").json()
    check(any(e.get("ref") == b1no and e.get("type") == "prodReceive" and e.get("in") == 10 for e in bledger["entries"])
          and any(e.get("ref") == b1no and e.get("type") == "prodIssue" for e in uledger["entries"]),
          "R5.4: …and both ledgers quote the batch — a receipt of the goods, an issue of the inputs")
    blots = [l for l in arif.get(f"{BASE}/production/lots", params={"item": bgid, "all": 1}).json() if l["batchNo"] == b1no]
    check(len(blots) == 1 and blots[0]["received"] == 10 and blots[0]["available"] == 10,
          "R5.4: …and the goods it received are a lot a sales invoice can draw on")
    if DB_URL:
        check(psql(f"select prod_issue = {round(biss0 + buses[binp], 2)} from items where id = '{binp}'") == "t"
              and psql(f"select prod_receive = {round(brec0 + 10, 2)} from items where id = '{bgid}'") == "t",
              "R5.4: …and the counters it moved are written with it (items.prod_issue / prod_receive)")
        check(psql(f"select jsonb_array_length(history) from batches where id = '{b1id}'") == "2",
              "R5.4: the batch's own history travels with the row")
    breg = arif.get(f"{BASE}/production/batches", params={"size": 200}).json()
    check(breg["total"] >= 9 and breg["facets"]["mode"]["inHouse"] >= 1 and breg["totals"]["totalReceive"] >= 10
          and any(b["id"] == b1id for b in breg["data"]),
          f"R5.4: the register lists the batches with their facets and totals ({breg['total']})")
    if DB_URL:
        check(breg["total"] == int(psql("select count(*) from batches where deleted_at is null")),
              "R5.4: …and its total is the live rows of the table")
    bcsv = arif.get(f"{BASE}/production/batches", params={"format": "csv"})
    check(bcsv.status_code == 200 and bcsv.headers.get("content-type", "").startswith("text/csv")
          and "Issue Qty" in bcsv.text and b1no in bcsv.text,
          "R5.4: the CSV export writes one row per batch line")
    bwo_page = arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json()
    bwo_rows = bwo_page["data"] if isinstance(bwo_page, dict) else bwo_page
    bwo = [w for w in bwo_rows if w["process"] == "Approved" and any(l.get("remaining", l["qty"]) >= 100 for l in w["lines"])][0]
    bwid = bwo["id"]
    bwoitem = [l["itemId"] for l in bwo["lines"] if l.get("remaining", l["qty"]) >= 100][0]
    bwoq = [l.get("remaining", l["qty"]) for l in bwo["lines"] if l["itemId"] == bwoitem][0]
    over = arif.post(f"{BASE}/production/batches", json={**batch_body, "lines": [
        {"itemId": bwoitem, "workOrderId": bwid, "issueQty": bwoq + 1, "receiveQty": 0}]})
    check(over.status_code == 422 and over.json()["errors"].get("lines.0.issueQty") == ["exceedsWorkOrder"],
          "R5.4: a batch cannot issue more than its work order has left (422, from the mock's own rule)")
    b2 = arif.post(f"{BASE}/production/batches", json={**batch_body, "lines": [
        {"itemId": bwoitem, "workOrderId": bwid, "issueQty": 100, "receiveQty": 100}]})
    check(b2.status_code == 201 and b2.json()["lines"][0].get("workOrderNo") == bwo["no"],
          f"R5.4: a batch on a work order carries its number ({b2.status_code})")
    b2a = arif.patch(f"{BASE}/production/batches/{b2.json()['id']}", json={"process": "Approved"})
    wonow = arif.get(f"{BASE}/production/work-orders/{bwid}").json()
    wline = [l for l in wonow["lines"] if l["itemId"] == bwoitem][0]
    check(b2a.status_code == 200 and wline["issued"] == 100 and wline["received"] == 100
          and wline["remaining"] == bwoq - 100 and wonow["status"] in ("partial", "completed"),
          f"R5.4: …and the work order's progress, which compat derives from the batches in memory, follows ({wonow['status']})")
    check(arif.patch(f"{BASE}/production/batches/{b2.json()['id']}",
                     json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"}).status_code == 200
          and [l for l in arif.get(f"{BASE}/production/work-orders/{bwid}").json()["lines"]
               if l["itemId"] == bwoitem][0]["issued"] == 0,
          "R5.4: cancelling gives the quantity back to the work order")
    b1c = arif.patch(f"{BASE}/production/batches/{b1id}", json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"})
    check(b1c.status_code == 200 and b1c.json()["process"] == "Cancelled"
          and bfg_stock(bgid, binp) == (round(bsplit0[0], 2), round(bsplit_in[0], 2)),
          "R5.4: cancelling puts the goods and the inputs back where they came from")
    if DB_URL:
        check(psql(f"select count(*) from batches where id = '{b1id}' and process = 'Cancelled'"
                   f" and cancel_reason is not null") == "1"
              and psql(f"select prod_issue = {round(biss0, 2)} from items where id = '{binp}'") == "t"
              and psql(f"select prod_receive = {round(brec0, 2)} from items where id = '{bgid}'") == "t",
              "R5.4: …and the cancellation and both counters are stored on the rows")
    check(arif.patch(f"{BASE}/production/batches/{b1id}", json={"process": "Cancelled", "reason": "again"}).status_code == 409,
          "R5.4: a batch that is already cancelled refuses a second cancellation (409)")
    check(arif.patch(f"{BASE}/production/batches/{b1id}", json={"process": "Approved"}).status_code == 409
          and arif.put(f"{BASE}/production/batches/{b1id}", json=batch_body).status_code == 409
          and arif.delete(f"{BASE}/production/batches/{b1id}").status_code == 409,
          "R5.4: …and a cancelled batch cannot be approved, edited or deleted (409)")
    # editing a draft replaces its lines; deleting one stamps the row, so its id and number stay retired
    b3 = arif.post(f"{BASE}/production/batches", json=batch_body).json()
    b3e = arif.put(f"{BASE}/production/batches/{b3['id']}", json={**batch_body, "remark": f"R5.4 edited {TAG}",
                                                                  "lines": [{"itemId": bgid, "issueQty": 4, "receiveQty": 3, "damageQty": 1}]})
    check(b3e.status_code == 200 and b3e.json()["totalIssue"] == 4 and b3e.json()["totalReceive"] == 3
          and b3e.json()["totalDamage"] == 1 and b3e.json()["remark"] == f"R5.4 edited {TAG}"
          and [h["action"] for h in b3e.json()["history"]][-1] == "edited",
          f"R5.4: editing a draft replaces its lines and its totals ({b3e.status_code})")
    if DB_URL:
        check(psql("select total_issue::text || '/' || total_receive::text || '/' || total_damage::text from batches"
                   f" where id = '{b3['id']}'") == "4.000/3.000/1.000"
              and psql(f"select receive_qty::text || '/' || damage_qty::text from batch_lines"
                       f" where batch_id = '{b3['id']}' and ord = 1") == "3.000/1.000",
              "R5.4: …on the row and on the line the edit replaced")
    check(arif.put(f"{BASE}/production/batches/{b3['id']}", json={**batch_body, "mode": "opening"}).status_code == 409,
          "R5.4: the batch type cannot change — a new batch instead (409)")
    b3d = arif.delete(f"{BASE}/production/batches/{b3['id']}")
    check(b3d.status_code == 200 and b3d.json().get("ok") is True
          and arif.get(f"{BASE}/production/batches/{b3['id']}").status_code == 404,
          "R5.4: a draft batch is deleted and leaves the register")
    if DB_URL:
        check(psql(f"select count(*) from batches where id = '{b3['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from batch_lines where batch_id = '{b3['id']}'") == "1",
              "R5.4: …as a stamped row that keeps its lines, so its id stays retired")
    b4 = arif.post(f"{BASE}/production/batches", json=batch_body).json()
    check(b4["no"] != b3["no"] and int(b4["id"][2:]) > int(b3["id"][2:]),
          f"R5.4: the next batch takes a new number and a new id ({b3['no']} → {b4['no']})")
    arif.delete(f"{BASE}/production/batches/{b4['id']}")
    bad_item = arif.post(f"{BASE}/production/batches", json={**batch_body, "lines": [{"itemId": "nosuchitem", "issueQty": 1}]})
    bad_qty = arif.post(f"{BASE}/production/batches", json={**batch_body, "lines": [{"itemId": bgid, "issueQty": 1, "receiveQty": 5}]})
    bad_vendor = arif.post(f"{BASE}/production/batches", json={**batch_body, "mode": "contractual", "vendorId": "nosuchvendor"})
    check(bad_item.status_code == 422 and bad_item.json()["errors"].get("lines.0.itemId") == ["unknown"]
          and bad_qty.status_code == 422 and bad_qty.json()["errors"].get("lines.0.receiveQty") == ["exceedsIssue"]
          and bad_vendor.status_code == 422 and bad_vendor.json()["errors"].get("vendorId") == ["unknown"],
          "R5.4: an unknown SKU, more received than issued and an unknown contractor are 422s, from the mock's own rules")
    # a contractual batch is a Mushak 6.4 challan: the inputs go out, the goods come back on a receipt of their own
    challan_body = {"mode": "contractual", "issueDate": tdate, "vendorId": bvid, "jobProcess": "washing",
                    "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
                    "lines": [{"itemId": bgid, "issueQty": 5}], "process": "Created"}
    b5 = arif.post(f"{BASE}/production/batches", json=challan_body)
    b5id, b5no = b5.json().get("id"), b5.json().get("no")
    check(b5.status_code == 201 and b5.json()["mode"] == "contractual" and b5.json()["vendorName"]
          and b5.json()["jobProcess"] == "washing" and b5.json()["address"]
          and b5.json()["lines"][0]["receiveQty"] == 0 and b5.json()["totalReceive"] == 0,
          f"native (R5.4): a contractual batch sends the inputs out and receives nothing yet ({b5.status_code} {b5no})")
    check(arif.patch(f"{BASE}/production/batches/{b5id}", json={"process": "Approved"}).status_code == 200,
          "R5.4: approving the challan sends the inputs to the contractor")
    awaiting = arif.get(f"{BASE}/production/batches", params={"receipt": "awaiting", "size": 50}).json()
    check(any(b["id"] == b5id for b in awaiting["data"]),
          "R5.4: …and the register's receipt facet shows it awaiting the goods")
    check(arif.post(f"{BASE}/production/batches/{b5id}/receive",
                    json={"receiveDate": tdate, "lines": [{"receiveQty": 1}, {"receiveQty": 1}]}).status_code == 422,
          "R5.4: a receipt needs one line per batch line (422 lineCount)")
    brec1 = float(psql(f"select prod_receive from items where id = '{bgid}'")) if DB_URL else None
    b5r = arif.post(f"{BASE}/production/batches/{b5id}/receive",
                    json={"receiveDate": tdate, "lines": [{"receiveQty": 4, "damageQty": 1}]})
    check(b5r.status_code == 200 and b5r.json()["totalReceive"] == 4 and b5r.json()["totalDamage"] == 1
          and b5r.json()["receiveDate"] == tdate and b5r.json()["receivedAt"]
          and b5r.json()["value"] == round(b5r.json()["lines"][0]["unitCost"] * 4, 2)
          and [h.get("note") for h in b5r.json()["history"]][-1] == "Finished goods received from the contractor",
          f"R5.4: the contractor's goods come back on the batch, which completes the challan ({b5r.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from batches where id = '{b5id}' and received_at is not null"
                   f" and total_receive = 4 and total_damage = 1") == "1"
              and psql(f"select receive_qty::text || '/' || damage_qty::text from batch_lines"
                       f" where batch_id = '{b5id}' and ord = 1") == "4.000/1.000"
              and psql(f"select prod_receive = {round(brec1 + 4, 2)} from items where id = '{bgid}'") == "t",
              "R5.4: …onto the row, its line and the counter the receipt moves")
    bsub = arif.get(f"{BASE}/production/subcontract", params={"from": "2026-01-01", "to": tdate})
    check(bsub.status_code == 200 and any(r.get("no") == b5no for r in bsub.json().get("rows", [])),
          "R5.4: …and the subcontracting register, which reads the batches in memory, still lists the challan")
    check(arif.post(f"{BASE}/production/batches/{b5id}/receive",
                    json={"receiveDate": tdate, "lines": [{"receiveQty": 1}]}).status_code == 409
          and arif.post(f"{BASE}/production/batches/{b1id}/receive",
                        json={"receiveDate": tdate, "lines": [{"receiveQty": 1}]}).status_code == 409,
          "R5.4: a batch is received once, and only a contractual one (409)")
    check(arif.patch(f"{BASE}/production/batches/{b5id}",
                     json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"}).status_code == 200,
          "R5.4: cancelling a received challan takes the goods and the inputs back")
    # an opening batch is work in progress brought forward: no BOM, no consumption, its own unit cost
    opening_batch = {"mode": "opening", "issueDate": "2025-07-01", "receiveDate": "2025-07-01",
                     "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
                     "lines": [{"itemId": bgid, "issueQty": 6, "receiveQty": 6, "unitCost": 120}], "process": "Approved"}
    b6 = arif.post(f"{BASE}/production/batches", json=opening_batch)
    check(b6.status_code == 201 and b6.json()["process"] == "Approved" and b6.json()["consumption"] == []
          and b6.json()["materialValue"] == 0 and b6.json()["lines"][0]["unitCost"] == 120
          and b6.json()["value"] == 720 and [h["action"] for h in b6.json()["history"]] == ["created", "approved"],
          f"native (R5.4): an opening batch is created and approved in one step, at its own unit cost ({b6.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from batches where id = '{b6.json()['id']}' and mode = 'opening'"
                   f" and process = 'Approved' and job_process is null") == "1"
              and psql(f"select count(*) from batch_consumption where batch_id = '{b6.json()['id']}'") == "0",
              "R5.4: …as a row of its own, with no consumed inputs")
    arif.patch(f"{BASE}/production/batches/{b6.json()['id']}", json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"})
    if DB_URL:
        check(psql(COMPAT_GONE) == "t",
              "R5.4: the snapshot carries no batches collection at all")
        check(int(psql("select count(*) from batches")) >= 8 and int(psql("select count(*) from batch_lines")) >= 10
              and int(psql("select count(*) from batch_consumption")) >= 30
              and int(psql("select count(*) from batches where mode = 'contractual' and vendor_id is not null")) >= 2,
              "R5.4: the demo batches were seeded into their tables, the contractors and their consumption with them")
        dupno = subprocess.run(["psql", DB_URL, "-At", "-c",
                                "insert into batches (id, no, mode, issue_date, issued_by, designation, total_issue, "
                                "total_receive, total_damage, material_value, value, process, branch_id, branch_name, "
                                "created_at) select 'dupb" + TAG + "', no, mode, issue_date, issued_by, designation, 0, "
                                "0, 0, 0, 0, process, branch_id, branch_name, now() from batches limit 1"],
                               capture_output=True, text=True)
        check(dupno.returncode != 0, "R5.4: the database refuses a duplicate batch number (unique index), not just the API")

    # ── R5.4: the derived stock — the branch split and an item's ledger ───────────────────────────────────────
    # Neither endpoint stores anything of its own: each adds up every movement document — purchases, sales, both
    # note kinds, transfers, damage entries, opening entries and the production batches — and every one of those
    # families has a table now, so both are served from the database instead of walked through the in-memory
    # copies. Two proofs follow: the numbers agree with the same sums written in SQL over the tables, and a row
    # changed in SQL alone (the in-memory copies left stale on purpose) moves the answer at once.
    print("R5.4: the branch split and an item's ledger are derived from the tables")

    dpage = arif.get(f"{BASE}/stock", params={"size": 200}).json()
    drows = dpage["data"]
    dbranches = dpage["branches"]
    dmain = [b["id"] for b in dbranches if b["category"] == "factory"][0]
    dside = [b["id"] for b in dbranches if b["id"] != dmain]
    dsku = [r["sku"] for r in drows]

    def jr(x):
        """The mock's Math.round — halves go up, which Python's round() does not do."""
        return math.floor(x + 0.5)

    def jr2(x):
        """The mock's round2."""
        return math.floor(x * 100 + 0.5) / 100

    def dstatus(r):
        return "out" if r["remain"] <= 0 else ("low" if r["remain"] < r["reorderLevel"] else "ok")

    def tally(rows, key):
        out = {}
        for r in rows:
            out[key(r)] = out.get(key(r), 0) + 1
        return out

    check(sorted(dpage) == ["branchValue", "branches", "data", "facets", "page", "size", "total", "totals"]
          and dpage["total"] == len(drows) and dsku == sorted(dsku, key=natkey),
          f"native (R5.4): /stock answers a page of every SKU — {dpage['total']} rows, sorted by SKU — with the "
          f"stock-holding branches and the value each holds, and nothing else in the body")
    if DB_URL:
        check(dpage["total"] == int(psql("select count(*) from items")),
              f"R5.4: …one row per SKU in the items table ({dpage['total']})")
    check(all(r["value"] == jr(max(0, r["remain"]) * r["costPrice"]) and r["saleValue"] == jr(max(0, r["remain"]) * r["salePrice"]) for r in drows)
          and dpage["totals"]["value"] == jr2(sum(r["value"] for r in drows))
          and dpage["totals"]["saleValue"] == jr2(sum(r["saleValue"] for r in drows))
          and dpage["branchValue"] == {b["id"]: jr(sum(max(0, r["byBranch"].get(b["id"], 0)) * r["costPrice"] for r in drows)) for b in dbranches},
          f"R5.4: every row is valued at cost and at sale price over what is left, the register totals both "
          f"({dpage['totals']['value']} at cost, {dpage['totals']['saleValue']} at sale), and each branch's value is its own quantity at cost")
    dfac = dpage["facets"]
    check(sorted(dfac) == ["group", "stock", "unit"] and all(sum(v.values()) == dpage["total"] for v in dfac.values())
          and dfac["group"] == tally(drows, lambda r: r["group"]) and dfac["unit"] == tally(drows, lambda r: r["unit"])
          and dfac["stock"] == tally(drows, dstatus),
          f"R5.4: the facets count the same rows — {dfac['stock']} by stock status, {len(dfac['group'])} groups, {len(dfac['unit'])} units")
    dlow = arif.get(f"{BASE}/stock", params={"size": 200, "stock": "low"}).json()
    check(dlow["total"] == dfac["stock"].get("low", 0) and all(dstatus(r) == "low" for r in dlow["data"])
          and dlow["facets"]["stock"] == dfac["stock"] and dlow["facets"]["group"] == tally(dlow["data"], lambda r: r["group"])
          and dlow["totals"]["value"] == jr2(sum(r["value"] for r in dlow["data"])),
          f"R5.4: ?stock=low keeps the {dlow['total']} SKUs below their re-order level, the other facet counts respect the filter and the totals follow the rows kept")
    dat = arif.get(f"{BASE}/stock", params={"size": 200, "branch": dside[0]}).json()
    check(dat["total"] < dpage["total"] and all(r["byBranch"].get(dside[0], 0) > 0 for r in dat["data"])
          and dat["branchValue"][dside[0]] == jr(sum(max(0, r["byBranch"].get(dside[0], 0)) * r["costPrice"] for r in dat["data"])),
          f"R5.4: ?branch= keeps the {dat['total']} SKUs held at {dside[0]}, and the branch values are over the rows kept")
    dhit = arif.get(f"{BASE}/stock", params={"size": 200, "q": drows[0]["sku"]}).json()
    dpage2 = arif.get(f"{BASE}/stock", params={"page": 2, "size": 5}).json()
    check(dhit["total"] >= 1 and all(drows[0]["sku"].lower() in f"{r['name']} {r['sku']} {r['hsCode']}".lower() for r in dhit["data"])
          and dpage2["page"] == 2 and dpage2["size"] == 5 and dpage2["total"] == dpage["total"]
          and [r["sku"] for r in dpage2["data"]] == dsku[5:10],
          f"R5.4: ?q= searches the name, the SKU and the HS code ({dhit['total']} hits for {drows[0]['sku']}), and paging slices the same sorted rows")
    dcsv = arif.get(f"{BASE}/stock", params={"format": "csv"})
    dlines = [l for l in dcsv.text.split("\n") if l.strip()]
    dcols = dlines[0].lstrip("\ufeff").split(",")
    check(dcsv.status_code == 200 and dcsv.headers["content-type"].startswith("text/csv")
          and "stock-by-branch-" in dcsv.headers["content-disposition"]
          and dcols[:4] == ["SKU", "Item", "Group", "Unit"] and dcols[4:4 + len(dbranches)] == [b["name"] for b in dbranches]
          and dcols[-4:] == ["Total", "Unit cost", "Value at cost", "Re-order level"] and len(dlines) - 1 == dpage["total"],
          f"R5.4: the CSV has a column per stock-holding branch and a row per SKU ({len(dlines) - 1} rows)")

    # The same sums, written in SQL over the ten tables the derivation reads — one query per SKU per branch.
    SPLIT = """with m as (
      select -l.qty as q from sales s join sale_lines l on l.sale_id = s.id
        where s.process = 'Approved' and s.deleted_at is null and s.branch_id = '{b}' and l.item_id = '{i}'
      union all select l.qty from purchases p join purchase_lines l on l.purchase_id = p.id
        where p.process = 'Approved' and p.deleted_at is null and p.branch_id = '{b}' and l.item_id = '{i}'
      union all select -l.qty from stock_documents d join stock_document_lines l on l.doc_id = d.id
        where d.kind = 'transfer' and d.process = 'Approved' and d.from_branch_id = '{b}' and l.item_id = '{i}'
      union all select l.qty from stock_documents d join stock_document_lines l on l.doc_id = d.id
        where d.kind = 'transfer' and d.process = 'Approved' and d.to_branch_id = '{b}' and l.item_id = '{i}'
      union all select -l.qty from stock_documents d join stock_document_lines l on l.doc_id = d.id
        where d.kind = 'damage' and d.process = 'Approved' and d.from_branch_id = '{b}' and l.item_id = '{i}'
      union all select -l.qty from notes n join note_lines l on l.note_id = n.id
        where n.kind = 'debit' and n.process = 'Approved' and n.deleted_at is null and n.branch_id = '{b}' and l.item_id = '{i}'
      union all select l.qty from notes n join note_lines l on l.note_id = n.id
        where n.kind = 'credit' and n.process = 'Approved' and n.deleted_at is null and n.branch_id = '{b}' and l.item_id = '{i}'
      union all select o.qty from opening_entries o
        where o.process = 'Approved' and o.deleted_at is null and o.branch_id = '{b}' and o.item_id = '{i}'
      union all select -c.qty from batches b join batch_consumption c on c.batch_id = b.id
        where b.process = 'Approved' and b.deleted_at is null and b.branch_id = '{b}' and c.item_id = '{i}'
      union all select l.receive_qty from batches b join batch_lines l on l.batch_id = b.id
        where b.process = 'Approved' and b.deleted_at is null and b.branch_id = '{b}' and l.item_id = '{i}'
    ) select round(coalesce(sum(q), 0)::numeric, 2) from m"""
    if DB_URL:
        dbad = [(r["sku"], b, float(psql(SPLIT.format(i=r["id"], b=b))), r["byBranch"].get(b, 0))
                for r in drows for b in dside
                if abs(float(psql(SPLIT.format(i=r["id"], b=b))) - round(r["byBranch"].get(b, 0), 2)) > 0.005]
        check(not dbad,
              f"R5.4: every quantity away from the factory is that branch's own approved documents, summed in SQL over the ten families "
              f"({len(drows)} SKUs × {len(dside)} branches){'' if not dbad else ' — mismatched: ' + str(dbad[:3])}")
        check(all(round(r["byBranch"].get(dmain, 0), 2) == jr2(r["remain"] - sum(v for k, v in r["byBranch"].items() if k != dmain))
                  and abs(float(psql("select opening + purchased + prod_receive - prod_issue - sold - damage "
                                     f"from items where id = '{r['id']}'")) - r["remain"]) < 0.005 for r in drows),
              "R5.4: the factory holds whatever is not explicitly at another branch, and `remain` is the counters on the SKU's own row")

    # One SKU's ledger: the item with the most stock away from the factory, so the branch side of it has rows too.
    drow = max(drows, key=lambda r: max((v for k, v in r["byBranch"].items() if k != dmain), default=0))
    ORDER = {"opening": 0, "purchase": 1, "prodReceive": 2, "saleReturn": 2.5, "transferIn": 3, "sale": 4,
             "purchaseReturn": 5, "transferOut": 6, "prodIssue": 7, "damage": 8}
    dled = arif.get(f"{BASE}/items/{drow['id']}/ledger")
    dledb = dled.json()
    dlets = dledb["entries"]
    check(dled.status_code == 200 and sorted(dledb) == ["branches", "byBranch", "closing", "entries", "item", "totals"]
          and dledb["item"]["id"] == drow["id"] and dledb["item"]["remain"] == drow["remain"]
          and dledb["byBranch"] == drow["byBranch"] and [b["id"] for b in dledb["branches"]] == [b["id"] for b in dbranches]
          and not any({"at", "transfer", "value", "sd", "vat", "challan"} & set(e) for e in dlets),
          f"native (R5.4): the ledger of {drow['sku']} — {len(dlets)} entries, the SKU and its branch split with it, "
          f"and none of the value, tax or challan details a Mushak book carries")
    check(dlets == sorted(dlets, key=lambda e: (e["date"], ORDER[e["type"]])) and all(e.get("refId") for e in dlets if not e.get("summary"))
          and dlets[0]["type"] == "opening" and any(e.get("summary") for e in dlets),
          "R5.4: the entries are sorted by date and type, every document row quotes the document it came from, the "
          "first is the opening balance and the production posted before R3 stays a monthly summary")
    dbal, dbal_ok = 0, True
    for e in dlets:
        dbal = jr2(dbal + e["in"] - e["out"])
        dbal_ok = dbal_ok and e["balance"] == dbal
    check(dbal_ok and dledb["totals"] == {"in": jr2(sum(e["in"] for e in dlets)), "out": jr2(sum(e["out"] for e in dlets))}
          and dledb["closing"] == dbal == jr2(dledb["item"]["remain"]),
          f"R5.4: the balance runs through the entries to {dledb['closing']} — in {dledb['totals']['in']}, out "
          f"{dledb['totals']['out']} — and closes on the SKU's own remaining quantity")
    dcloses = [r["sku"] for r in drows if jr2(arif.get(f"{BASE}/items/{r['id']}/ledger").json()["closing"]) != jr2(r["remain"])]
    check(not dcloses,
          f"R5.4: …for every SKU — {len(drows)} ledgers, each closing on the quantity its own row's counters say is left"
          f"{'' if not dcloses else ' (apart from ' + ', '.join(dcloses) + ')'}")
    dside_led = arif.get(f"{BASE}/items/{drow['id']}/ledger", params={"branch": dside[0]}).json()
    check(dside_led["branchId"] == dside[0] and dside_led["closing"] == jr2(drow["byBranch"][dside[0]])
          and not any(e["type"].startswith("transfer") for e in dlets)
          and (not drow["byBranch"][dside[0]] or any(e["type"].startswith("transfer") for e in dside_led["entries"])),
          f"R5.4: ?branch= closes on the {dside[0]} quantity ({dside_led['closing']}) and shows the transfers in and out, "
          f"which company-wide net to zero and so stay out of the register")
    doffice = [b["id"] for b in arif.get(f"{BASE}/company").json()["branches"] if b["category"] == "office"]
    dx1 = arif.get(f"{BASE}/items/nosuchitem/ledger")
    dx2 = arif.get(f"{BASE}/items/{drow['id']}/ledger", params={"branch": "nosuchbranch"})
    dx3 = arif.get(f"{BASE}/items/{drow['id']}/ledger", params={"branch": doffice[0]}) if doffice else None
    check(dx1.status_code == 404 and dx1.json()["title"] == "Item not found"
          and dx2.status_code == 404 and dx2.json()["title"] == "Branch not found"
          and (dx3 is None or (dx3.status_code == 404 and dx3.json()["title"] == "Branch not found")),
          "R5.4: an unknown SKU is a 404, and so is a branch that cannot hold stock — one that does not exist, or the head office")

    # A write reaches both endpoints at once: a damage entry approved at the other branch, then cancelled again.
    def dsplit():
        r = [x for x in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"] if x["id"] == drow["id"]][0]
        return r["remain"], r["byBranch"].get(dmain, 0), r["byBranch"].get(dside[0], 0)

    def dprobe():
        cw = arif.get(f"{BASE}/items/{drow['id']}/ledger").json()
        sb = arif.get(f"{BASE}/items/{drow['id']}/ledger", params={"branch": dside[0]}).json()
        return {"split": dsplit(), "entries": len(cw["entries"]), "out": cw["totals"]["out"], "closing": cw["closing"],
                "sideEntries": len(sb["entries"]), "sideClosing": sb["closing"]}

    d0 = dprobe()
    ddmg = arif.post(f"{BASE}/damage", json={"branchId": dside[0], "date": tdate, "reason": "wastage",
                                             "note": f"R5.4 derived {TAG}", "lines": [{"itemId": drow["id"], "qty": 3}],
                                             "process": "Approved"})
    d1 = dprobe()
    check(ddmg.status_code == 201 and d1["split"] == (jr2(d0["split"][0] - 3), d0["split"][1], jr2(d0["split"][2] - 3))
          and d1["entries"] == d0["entries"] + 1 and d1["out"] == jr2(d0["out"] + 3) and d1["closing"] == jr2(d0["closing"] - 3)
          and d1["sideEntries"] == d0["sideEntries"] + 1 and d1["sideClosing"] == jr2(d0["sideClosing"] - 3),
          f"R5.4: a damage entry approved at {dside[0]} is in both derived endpoints at once — the SKU's quantity there "
          f"{d0['split'][2]} → {d1['split'][2]}, a damage row in each ledger, and {d0['closing']} → {d1['closing']} left overall ({ddmg.status_code})")
    ddc = arif.patch(f"{BASE}/damage/{ddmg.json()['id']}", json={"process": "Cancelled", "reason": f"R5.4 cancelled {TAG}"})
    check(ddc.status_code == 200 and dprobe() == d0,
          "R5.4: …and cancelling it takes both back, row for row")

    # The decisive one: change a line in SQL alone, so the in-memory copies are stale, and both endpoints must move.
    if DB_URL:
        dtid = psql("select d.id from stock_documents d join stock_document_lines l on l.doc_id = d.id "
                    f"where d.kind = 'transfer' and d.process = 'Approved' and d.to_branch_id = '{dside[0]}' "
                    f"and l.item_id = '{drow['id']}' order by d.ord limit 1")
        dsid = psql("select s.id from sales s join sale_lines l on l.sale_id = s.id where s.process = 'Approved' "
                    f"and s.deleted_at is null and l.item_id = '{drow['id']}' order by s.ord limit 1")
        if dtid and dsid:
            dtq = float(psql(f"select qty from stock_document_lines where doc_id = '{dtid}' and item_id = '{drow['id']}'"))
            dsq = float(psql(f"select qty from sale_lines where sale_id = '{dsid}' and item_id = '{drow['id']}'"))
            dsbr = psql(f"select branch_id from sales where id = '{dsid}'")
            a0 = dprobe()
            psql(f"update stock_document_lines set qty = {dtq + 7} where doc_id = '{dtid}' and item_id = '{drow['id']}'")
            a1 = dprobe()
            psql(f"update stock_document_lines set qty = {dtq} where doc_id = '{dtid}' and item_id = '{drow['id']}'")
            check(a1["split"] == (a0["split"][0], jr2(a0["split"][1] - 7), jr2(a0["split"][2] + 7))
                  and a1["sideClosing"] == jr2(a0["sideClosing"] + 7) and a1["closing"] == a0["closing"]
                  and a1["entries"] == a0["entries"],
                  f"R5.4: a transfer line changed in SQL alone — the in-memory copies left stale — moves the branch split "
                  f"({a0['split'][2]} → {a1['split'][2]} at {dside[0]}) and that branch's ledger at once, and the "
                  f"company-wide ledger not at all, because a transfer nets out")
            psql(f"update sale_lines set qty = {dsq + 5} where sale_id = '{dsid}' and item_id = '{drow['id']}'")
            a2 = dprobe()
            psql(f"update sale_lines set qty = {dsq} where sale_id = '{dsid}' and item_id = '{drow['id']}'")
            a3 = dprobe()
            dexpect = a0["split"] if dsbr == dmain else (jr2(a0["split"][0]), jr2(a0["split"][1] + 5), jr2(a0["split"][2] - 5))
            check(a2["entries"] == a0["entries"] and a2["out"] == jr2(a0["out"] + 5) and a2["closing"] == jr2(a0["closing"] - 5)
                  and a2["split"] == dexpect and a3 == a0,
                  f"R5.4: an invoice line changed the same way moves the ledger — out {a0['out']} → {a2['out']}, closing "
                  f"{a0['closing']} → {a2['closing']}, the same entry with it — {'and not the branch split, because the invoice is at the factory' if dsbr == dmain else 'and the branch split with it'}, and putting both back restores every number")
        else:
            skipped("the SQL-only mutation probe (no transfer or invoice line for that SKU)")

    # ── R5.5: the price declarations and the production configuration ────────────────────────────────────────
    # A declaration is the Mushak 4.3 coefficient of ONE unit of a finished good: its inputs and the wastage each
    # allows are rows of `bom_inputs`, its cost heads rows of `bom_costs`, and the version in force for an item on a
    # date is what a production batch prices its lines and consumes its inputs from. The configuration is the one row
    # that says whether a batch follows a work order and whether it records the standard or the actual consumption.
    # Three proofs follow: the rows hold what the register prints (and a row changed in SQL alone moves the answer at
    # once), a declaration filed here is what the next batch is priced from — the batch rules read it through the
    # mirror this module writes through — and a version filed after a deleted draft takes the same number but a new
    # id, which is why the number's unique index covers the live rows only.
    print("R5.5: the price declarations and the production configuration are rows")

    pdPage = arif.get(f"{BASE}/production/boms", params={"size": 100}).json()
    pdRows = pdPage["data"]
    check(pdPage["total"] == len(pdRows) >= 6 and pdPage["totals"] == {}
          and set(pdPage["facets"]) == {"status", "item"} and set(pdPage["facetLabels"]) == {"item"}
          and len(pdPage["facetLabels"]["item"]) >= 6,
          f"native (R5.5): GET /production/boms answers the page with its facets and the finished goods' names "
          f"({pdPage['total']} declarations)")
    check([r["sku"] for r in pdRows] == sorted((r["sku"] for r in pdRows), key=natkey)
          and all(r["status"] in ("active", "draft", "superseded", "cancelled") and "salePrice" in r for r in pdRows),
          "R5.5: the register is sorted by SKU by default, and every row carries its status and the item's sale price")
    check(sum(pdPage["facets"]["status"].values()) == pdPage["total"]
          and sum(pdPage["facets"]["item"].values()) == pdPage["total"]
          and pdPage["facets"]["status"].get("active", 0) >= 1
          and len(pdPage["facetLabels"]["item"]) >= len({r["itemId"] for r in pdRows}),
          f"R5.5: the facets count the same rows twice over ({json.dumps(pdPage['facets']['status'])})")
    if DB_URL:
        check(psql("select count(*) from boms where deleted_at is null") == str(pdPage["total"])
              and psql("select count(*) from bom_inputs i join boms b on b.id = i.bom_id"
                       " where b.deleted_at is null") == str(sum(len(r["inputs"]) for r in pdRows))
              and psql("select count(*) from bom_costs c join boms c2 on c2.id = c.bom_id"
                       " where c2.deleted_at is null") == str(sum(len(r["costs"]) for r in pdRows)),
              "R5.5: …and its total is the live rows of the table, with the inputs and the cost heads as child rows")
        check(psql("""select count(*) from boms b where
              b.material_value <> (select coalesce(sum(i.value), 0) from bom_inputs i where i.bom_id = b.id)
              or b.wastage_value <> (select coalesce(sum(i.wastage_value), 0) from bom_inputs i where i.bom_id = b.id)
              or b.value_added <> (select coalesce(sum(c.amount), 0) from bom_costs c where c.bom_id = b.id)
              or b.price <> b.material_value + b.value_added
              or b.unit_cost <> b.price - (select coalesce(sum(c.amount), 0) from bom_costs c
                                           where c.bom_id = b.id and c.head = 'profit')""") == "0",
              "R5.5: every declaration's values are the sums of its own child rows — material, wastage, value added, "
              "price and unit cost")
        pdProbe = pdRows[0]["id"]
        pdUc0 = float(psql(f"select unit_cost from boms where id = '{pdProbe}'"))
        pdQty0 = float(psql(f"select qty from bom_inputs where bom_id = '{pdProbe}' and ord = 1"))
        psql(f"update boms set unit_cost = {jr2(pdUc0 + 1.5)} where id = '{pdProbe}'")
        psql(f"update bom_inputs set qty = {jr2(pdQty0 * 2)} where bom_id = '{pdProbe}' and ord = 1")
        pdMoved = arif.get(f"{BASE}/production/boms/{pdProbe}").json()
        check(pdMoved["unitCost"] == jr2(pdUc0 + 1.5) and pdMoved["inputs"][0]["qty"] == jr2(pdQty0 * 2),
              f"R5.5: a unit cost and an input quantity changed in SQL alone move the answer at once "
              f"({pdUc0} → {pdMoved['unitCost']}, {pdQty0} → {pdMoved['inputs'][0]['qty']})")
        psql(f"update boms set unit_cost = {pdUc0} where id = '{pdProbe}'")
        psql(f"update bom_inputs set qty = {pdQty0} where bom_id = '{pdProbe}' and ord = 1")
        pdBack = arif.get(f"{BASE}/production/boms/{pdProbe}").json()
        check(pdBack["unitCost"] == pdUc0 and pdBack["inputs"][0]["qty"] == pdQty0,
              "R5.5: …and putting the row back restores the answer exactly")

    pdCsv = arif.get(f"{BASE}/production/boms", params={"format": "csv"})
    check(pdCsv.status_code == 200 and pdCsv.headers.get("content-type", "").startswith("text/csv")
          and "price-declarations-" in pdCsv.headers.get("content-disposition", "")
          and pdCsv.text.splitlines()[0].lstrip("\ufeff").startswith("Declaration,Item,UoM,Version,Submitted,Effective")
          and len([l for l in pdCsv.text.splitlines()[1:] if l]) == pdPage["total"],
          "R5.5: the CSV export writes the Mushak 4.3 columns, one row per declaration")
    check(arif.get(f"{BASE}/production/boms", params={"status": "draft", "size": 50}).json()["total"]
          == pdPage["facets"]["status"].get("draft", 0)
          and arif.get(f"{BASE}/production/boms", params={"status": "active", "size": 50}).json()["total"]
          == pdPage["facets"]["status"].get("active", 0),
          "R5.5: ?status= narrows the register to one lifecycle state")
    pdName = pdRows[0]["inputs"][0]["name"].lower()
    pdQ = arif.get(f"{BASE}/production/boms", params={"q": pdName, "size": 50}).json()
    check(pdQ["total"] >= 1 and all(pdName in f"{r['no']} {r['itemName']} {r['sku']} {r['hsCode']} "
                                    + " ".join(i["name"] for i in r["inputs"]).lower() for r in pdQ["data"]),
          f"R5.5: ?q= finds a declaration by the name of one of its inputs ({pdQ['total']} mention it)")
    pdSort = arif.get(f"{BASE}/production/boms", params={"sort": "price.desc", "size": 100}).json()
    check([r["price"] for r in pdSort["data"]] == sorted((r["price"] for r in pdSort["data"]), reverse=True),
          "R5.5: ?sort=price.desc orders the register by the declared price")
    pdRange = arif.get(f"{BASE}/production/boms", params={"from": "2026-01-01", "to": "2026-12-31", "size": 100}).json()
    check(pdRange["total"] >= 1 and all("2026-01-01" <= r["effectiveDate"] <= "2026-12-31" for r in pdRange["data"]),
          f"R5.5: ?from=&to= filter on the effective date ({pdRange['total']} declarations take effect in 2026)")

    # an item to amend: a filed declaration of an item that has no draft on it (a draft would be a 409), preferring
    # an item that already has more than one version — whichever suites ran before this one
    pdFree = [r for r in pdRows if r["process"] == "Approved"
              and not any(x["process"] == "Created" for x in pdRows if x["itemId"] == r["itemId"])]
    check(len(pdFree) >= 1, f"R5.5: an item is left with a filed declaration and no draft on it ({len(pdFree)})")
    pdTwo = ([r for r in pdFree if sum(1 for x in pdRows if x["itemId"] == r["itemId"]) > 1] or pdFree)[0]
    pdOne = arif.get(f"{BASE}/production/boms/{pdTwo['id']}").json()
    check(pdOne["id"] == pdTwo["id"] and [v["id"] for v in pdOne["versions"]]
          == [x["id"] for x in sorted((r for r in pdRows if r["itemId"] == pdTwo["itemId"]), key=lambda r: -r["version"])],
          "R5.5: GET /production/boms/{id} lists every version of the item beside it, newest first")
    check(arif.get(f"{BASE}/production/boms/{pdTwo['no']}").json()["id"] == pdTwo["id"]
          and arif.get(f"{BASE}/production/boms/nosuchdeclaration").status_code == 404
          and arif.get(f"{BASE}/production/boms/nosuchdeclaration").json()["title"] == "Price declaration not found",
          "R5.5: a declaration is found by its number too, and an unknown one is a 404 problem")
    pdSku = arif.get(f"{BASE}/items/{pdTwo['itemId']}").json()
    check(pdOne["salePrice"] == pdSku["salePrice"] and pdOne["status"] == pdTwo["status"],
          "R5.5: the row carries the item's current sale price beside the declared one")

    # a new version of an item that already has one, effective in a few days: the version in force for a batch dated
    # today does not change, so what follows cannot disturb the other families' checks
    pdNextV = max(v["version"] for v in pdOne["versions"]) + 1

    def pdPlus(days, iso):
        return time.strftime("%Y-%m-%d", time.localtime(time.mktime(time.strptime(iso, "%Y-%m-%d")) + days * 86400))

    # after every declaration in the register and after today: the version in force for a batch dated today does not
    # change, and the rules' "after the previous version" holds whatever the suites before this one filed
    pdEff = pdPlus(6, max([tdate] + [x["effectiveDate"] for x in pdRows]))
    pdBody = {"itemId": pdTwo["itemId"], "effectiveDate": pdEff, "licenseDate": tdate,
              "amendmentReason": f"R5.5 amendment {TAG}: the yarn and the dyeing costs were revised for the season.",
              "inputs": [{"itemId": i["itemId"], "qty": i["qty"], "wastagePct": i["wastagePct"],
                          "price": jr2(i["price"] * 1.1)} for i in pdOne["inputs"]],
              "costs": [{"head": c["head"], "amount": jr2(c["amount"] * 1.05)} for c in pdOne["costs"]],
              "process": "Created"}
    pdNew = arif.post(f"{BASE}/production/boms", json=pdBody)
    pdn = pdNew.json() if pdNew.status_code == 201 else {}
    pdNewId, pdNewNo = pdn.get("id"), pdn.get("no")
    pdInputs, pdCosts = pdn.get("inputs", []), pdn.get("costs", [])
    pdProfit = next((c["amount"] for c in pdCosts if c["head"] == "profit"), 0)
    check(pdNew.status_code == 201 and str(pdNewId).startswith("bom") and pdn.get("version") == pdNextV
          and pdNewNo == f"BOM-{pdTwo['sku']}-v{pdNextV}" and pdn.get("status") == "draft"
          and pdn.get("process") == "Created" and [h["action"] for h in pdn.get("history", [])] == ["created"]
          and pdn.get("materialValue") == jr2(sum(i["value"] for i in pdInputs))
          and pdn.get("wastageValue") == jr2(sum(i["wastageValue"] for i in pdInputs))
          and pdn.get("valueAdded") == jr2(sum(c["amount"] for c in pdCosts))
          and pdn.get("price") == jr2(pdn.get("materialValue", 0) + pdn.get("valueAdded", 0))
          and pdn.get("unitCost") == jr2(pdn.get("price", 0) - pdProfit),
          f"native (R5.5): a declaration is filed as the item's next version and priced by the mock's own calcBom "
          f"({pdNew.status_code} {pdNewNo} {json.dumps(pdNew.json().get('errors') or '')[:60]})")
    check(len(pdInputs) >= 1 and all(i["value"] == jr2(i["grossQty"] * i["price"])
                                     and i["wastageValue"] == jr2(i["wastageQty"] * i["price"]) for i in pdInputs),
          "R5.5: each input's value is its gross quantity at its price, and its wastage is valued the same way")
    if DB_URL:
        check(psql(f"select count(*) from boms where id = '{pdNewId}' and no = '{pdNewNo}' and version = {pdNextV}"
                   f" and process = 'Created' and deleted_at is null") == "1"
              and psql(f"select count(*) from bom_inputs where bom_id = '{pdNewId}'") == str(len(pdInputs))
              and psql(f"select count(*) from bom_costs where bom_id = '{pdNewId}'") == str(len(pdCosts)),
              "R5.5: the draft is a row in boms, with its inputs and its cost heads beside it")

    check(arif.post(f"{BASE}/production/boms", json=pdBody).status_code == 409
          and arif.post(f"{BASE}/production/boms", json=pdBody).json()["title"]
          == "This item already has a draft declaration — edit or delete it first.",
          "R5.5: an item keeps one draft declaration — a second one is a 409 that says to edit or delete the first")
    pdOp = session("kamal")  # the run's own operator session signed out at the start
    check(pdOp.post(f"{BASE}/production/boms", json=pdBody).status_code == 403
          and pdOp.get(f"{BASE}/production/boms").status_code == 200
          and requests.get(f"{BASE}/production/boms").status_code == 401,
          "R5.5: filing a declaration needs master.edit (403 for an operator, who may still read the register), "
          "and the register needs a session")
    pdBad = [("an unknown item", {**pdBody, "itemId": "i6"}, {"itemId": ["unknown"]}),
             ("a finished good as an input", {**pdBody, "inputs": [{**pdBody["inputs"][0], "itemId": pdTwo["itemId"]}]},
              {"inputs.0.itemId": ["unknown"]}),
             ("a repeated input", {**pdBody, "inputs": [pdBody["inputs"][0], pdBody["inputs"][0]]},
              {"inputs.1.itemId": ["duplicate"]}),
             ("a repeated cost head", {**pdBody, "costs": [{"head": "labour", "amount": 5}, {"head": "labour", "amount": 6}]},
              {"costs.1.head": ["duplicate"]}),
             ("no amendment reason", {k: v for k, v in pdBody.items() if k != "amendmentReason"},
              {"amendmentReason": ["amendmentReason"]}),
             ("an effective date before the version in force", {**pdBody, "effectiveDate": pdTwo["effectiveDate"]},
              {"effectiveDate": ["afterPrevious"]}),
             ("a license date that is not a date", {**pdBody, "licenseDate": "25-06-2026"},
              {"licenseDate": ["required"]}),
             ("nothing but zeros", {**pdBody, "inputs": [{**i, "price": 0} for i in pdBody["inputs"]],
                                    "costs": [{**c, "amount": 0} for c in pdBody["costs"]]},
              {"costs": ["pricePositive"]})]
    for pdWhy, pdBadBody, pdWant in pdBad:
        pdR = arif.post(f"{BASE}/production/boms", json=pdBadBody)
        check(pdR.status_code == 422 and pdR.json()["title"] == "Validation failed"
              and all(pdR.json().get("errors", {}).get(k) == v for k, v in pdWant.items()),
              f"R5.5: {pdWhy} is refused with the mock's own 422 ({json.dumps(pdR.json().get('errors'))[:90]})")

    pdEdit = {**pdBody, "note": f"R5.5 note {TAG}",
              "inputs": [{**pdBody["inputs"][0], "qty": pdBody["inputs"][0]["qty"] * 1.5,
                          "price": jr2(pdBody["inputs"][0]["price"] * 1.2)}, *pdBody["inputs"][1:]]}
    pdPut = arif.put(f"{BASE}/production/boms/{pdNewId}", json=pdEdit)
    pdEdited = pdPut.json() if pdPut.status_code == 200 else {}
    check(pdPut.status_code == 200 and pdEdited.get("price", 0) > pdn.get("price", 0)
          and pdEdited.get("note") == pdEdit["note"] and pdEdited.get("version") == pdNextV
          and pdEdited.get("no") == pdNewNo
          and [h["action"] for h in pdEdited.get("history", [])] == ["created", "edited"],
          f"R5.5: editing the draft prices it again and keeps its version ({pdn.get('price')} → "
          f"{pdEdited.get('price')})")
    pdAudit = arif.get(f"{BASE}/audit", params={"entity": "bom", "entityId": pdNewId, "size": 20}).json()["data"]
    pdChanges = next((e.get("changes") or [] for e in pdAudit if e["action"] == "edited"), [])
    check(any(c["field"] == "price" for c in pdChanges) and any(c["field"] == "inputs" for c in pdChanges)
          and all(e["ref"] == pdNewNo for e in pdAudit),
          f"R5.5: …and the audit trail records the price that moved and the inputs' new signature "
          f"({[c['field'] for c in pdChanges]})")
    check(arif.put(f"{BASE}/production/boms/{pdTwo['id']}", json={}).status_code == 409
          and arif.put(f"{BASE}/production/boms/{pdTwo['id']}", json={}).json()["title"]
          == f"Only drafts can be edited — {pdTwo['no']} is {pdTwo['process']}. Amend it to create a new version.",
          "R5.5: a filed declaration cannot be edited — the 409 comes before the body is even parsed")

    pdApp = arif.patch(f"{BASE}/production/boms/{pdNewId}", json={"process": "Approved"})
    pdApproved = pdApp.json() if pdApp.status_code == 200 else {}
    check(pdApp.status_code == 200 and pdApproved.get("status") == "active"
          and pdApproved.get("process") == "Approved"
          and [h["action"] for h in pdApproved.get("history", [])] == ["created", "edited", "approved"],
          f"R5.5: approving files the version — {pdNewNo} is the declaration in force from {pdEff}")
    pdOld = arif.get(f"{BASE}/production/boms/{pdTwo['id']}").json()
    check(pdOld["status"] == "superseded" and pdOld["process"] == "Approved"
          and (not DB_URL or psql(f"select count(*) from boms where id = '{pdTwo['id']}'"
                                  " and superseded_at is not null") == "1"),
          "R5.5: …and supersedes the version that was in force, on the row as well as in the register")
    check([v["status"] for v in arif.get(f"{BASE}/production/boms/{pdNewId}").json()["versions"]]
          == ["active", "superseded"] + ["superseded"] * (pdNextV - 2),
          "R5.5: the version list beside it shows which one is in force")
    check(arif.patch(f"{BASE}/production/boms/{pdNewId}", json={"process": "Approved"}).status_code == 409
          and arif.patch(f"{BASE}/production/boms/{pdNewId}", json={"process": "Approved"}).json()["title"]
          == f"Cannot approve — {pdNewNo} is Approved.",
          "R5.5: a version that is filed cannot be approved again (409)")
    check(arif.patch(f"{BASE}/production/boms/{pdNewId}", json={"process": "Cancelled", "reason": f"R5.5 {TAG}"}).status_code == 409
          and arif.patch(f"{BASE}/production/boms/{pdNewId}", json={}).status_code == 400,
          "R5.5: …cannot be cancelled either (409), and a transition that is neither is a 400")

    # the batch rules read the declarations through the mirror this module writes through: a batch issued on the new
    # version's effective date is priced and consumed from it, while one issued today still follows the version in
    # force — so a natively filed declaration is what production is priced from, without a restart
    pdBatch = {"mode": "inHouse", "issueDate": pdEff, "receiveDate": pdEff, "remark": f"R5.5 batch {TAG}",
               "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
               "lines": [{"itemId": pdTwo["itemId"], "issueQty": 10, "receiveQty": 0, "damageQty": 0}],
               "process": "Created"}
    pdB = arif.post(f"{BASE}/production/batches", json=pdBatch)
    pdMade = pdB.json() if pdB.status_code == 201 else {}
    pdMadeLine = (pdMade.get("lines") or [{}])[0]
    pdUses = {c["itemId"]: c["qty"] for c in pdMade.get("consumption", [])}
    check(pdB.status_code == 201 and pdMadeLine.get("unitCost") == pdApproved.get("unitCost")
          and pdMadeLine.get("bomId") == pdNewId and pdMadeLine.get("bomVersion") == pdNextV
          and pdUses == {i["itemId"]: jr2(i["grossQty"] * 10) for i in pdApproved.get("inputs", [])},
          f"R5.5: a batch issued on {pdEff} is priced from the version filed here and consumes its inputs "
          f"({pdMade.get('no')} at {pdMadeLine.get('unitCost')})")
    pdForce = sorted((r for r in pdRows if r["itemId"] == pdTwo["itemId"] and r["process"] == "Approved"
                      and r["effectiveDate"] <= tdate), key=lambda r: -r["version"])[0]
    pdB0r = arif.post(f"{BASE}/production/batches", json={**pdBatch, "issueDate": tdate, "receiveDate": tdate})
    pdB0 = pdB0r.json() if pdB0r.status_code == 201 else {}
    pdB0Line = (pdB0.get("lines") or [{}])[0]
    check(pdB0Line.get("bomId") == pdForce["id"] and pdB0Line.get("unitCost") == pdForce["unitCost"],
          f"R5.5: …while a batch issued today is still priced from the version in force ({pdForce['no']}, whose "
          f"effective date has passed — the new one has not)")
    for pdDraftBatch in (pdMade, pdB0):
        if pdDraftBatch.get("id"):
            arif.delete(f"{BASE}/production/batches/{pdDraftBatch['id']}")

    pdFg2 = ([r for r in pdFree if r["itemId"] != pdTwo["itemId"]] or pdFree)[0]
    pdFg2V = max(x["version"] for x in pdRows if x["itemId"] == pdFg2["itemId"])
    pdCancelR = arif.post(f"{BASE}/production/boms", json={**pdBody, "itemId": pdFg2["itemId"]})
    pdCancel = pdCancelR.json() if pdCancelR.status_code == 201 else {}
    check(pdCancelR.status_code == 201 and pdCancel.get("version") == pdFg2V + 1
          and pdCancel.get("no") == f"BOM-{pdFg2['sku']}-v{pdFg2V + 1}",
          f"R5.5: the next amendment of an item with no draft on it becomes v{pdFg2V + 1} ({pdCancel.get('no')})")
    check(arif.patch(f"{BASE}/production/boms/{pdCancel.get('id')}", json={"process": "Cancelled"}).status_code == 422
          and arif.patch(f"{BASE}/production/boms/{pdCancel.get('id')}", json={"process": "Cancelled"}).json()["errors"]
          == {"reason": ["reasonMin"]},
          "R5.5: cancelling a draft needs a reason of ten characters (422)")
    pdCancelled = arif.patch(f"{BASE}/production/boms/{pdCancel.get('id')}",
                             json={"process": "Cancelled", "reason": f"R5.5 cancelled {TAG}"}).json()
    check(pdCancelled.get("status") == "cancelled" and pdCancelled.get("cancelReason") == f"R5.5 cancelled {TAG}"
          and (not DB_URL or psql(f"select count(*) from boms where id = '{pdCancel.get('id')}'"
                                  " and process = 'Cancelled' and cancel_reason is not null") == "1"),
          "R5.5: …and with one the draft is cancelled, on the row as well")
    pdGoneR = arif.post(f"{BASE}/production/boms", json={**pdBody, "itemId": pdFg2["itemId"]})
    pdGone = pdGoneR.json() if pdGoneR.status_code == 201 else {}
    check(pdGoneR.status_code == 201 and pdGone.get("version") == pdFg2V + 2
          and pdGone.get("no") == f"BOM-{pdFg2['sku']}-v{pdFg2V + 2}",
          f"R5.5: a cancelled version keeps its number retired — the next draft is v{pdFg2V + 2}")
    check(arif.delete(f"{BASE}/production/boms/{pdGone.get('id')}").status_code == 200
          and arif.delete(f"{BASE}/production/boms/{pdGone.get('id')}").status_code == 404,
          "R5.5: deleting a draft answers {ok: true}, and a second delete of it is a 404")
    check(arif.get(f"{BASE}/production/boms/{pdGone.get('id')}").status_code == 404
          and (not DB_URL or psql(f"select count(*) from boms where id = '{pdGone.get('id')}'"
                                  " and deleted_at is not null") == "1"),
          "R5.5: …the row is stamped rather than removed, and leaves the register")
    check(arif.delete(f"{BASE}/production/boms/{pdGone.get('no')}").status_code == 404
          and arif.delete(f"{BASE}/production/boms/{pdTwo['id']}").status_code == 409,
          "R5.5: a delete matches the id only, as the mock's did, and a filed declaration cannot be deleted (409)")
    pdAgain = arif.post(f"{BASE}/production/boms", json={**pdBody, "itemId": pdFg2["itemId"]}).json()
    check(pdAgain.get("no") and pdAgain.get("no") == pdGone.get("no")
          and int(str(pdAgain.get("id"))[3:]) > int(str(pdGone.get("id"))[3:]),
          f"R5.5: filing that item again takes the deleted draft's version but never its id "
          f"({pdGone['id']} {pdGone['no']} → {pdAgain['id']} {pdAgain['no']})")
    if pdAgain.get("id"):
        arif.delete(f"{BASE}/production/boms/{pdAgain['id']}")
    if DB_URL:
        pdDup = ("insert into boms (id, no, item_id, item_name, sku, hs_code, uom, version, effective_date,"
                 " material_value, wastage_value, value_added, price, unit_cost, process, created_at, deleted_at)"
                 f" select 'dupm{TAG}', no, item_id, item_name, sku, hs_code, uom, version, effective_date,"
                 " material_value, wastage_value, value_added, price, unit_cost, process, created_at, DELETED"
                 f" from boms where id = '{pdTwo['id']}'")
        pdLive = subprocess.run(["psql", DB_URL, "-c", pdDup.replace("DELETED", "null")], capture_output=True, text=True)
        pdStamped = subprocess.run(["psql", DB_URL, "-c", pdDup.replace("DELETED", "now()")], capture_output=True, text=True)
        check(pdLive.returncode != 0 and pdStamped.returncode == 0,
              "R5.5: the database refuses a second live declaration with the same number, but a deleted draft's "
              "number may come back — which is why the unique index covers the live rows only")
        psql(f"delete from boms where id = 'dupm{TAG}'")

    pdCfg0 = arif.get(f"{BASE}/production/config").json()
    check(set(pdCfg0) >= {"procedure", "consumption"} and pdCfg0["procedure"] in ("directStock", "workOrder")
          and pdCfg0["consumption"] in ("standard", "actual"),
          f"native (R5.5): GET /production/config answers the procedure and the consumption ({json.dumps(pdCfg0)})")
    if DB_URL:
        check(psql("select count(*) from production_config") == "1"
              and psql("select procedure || '/' || consumption from production_config")
              == f"{pdCfg0['procedure']}/{pdCfg0['consumption']}",
              "R5.5: …and it is the single row of production_config")
    check(pdOp.put(f"{BASE}/production/config", json={"procedure": "workOrder", "consumption": "standard"}).status_code == 403
          and arif.put(f"{BASE}/production/config", json={"procedure": "workOrder", "consumption": "standard"}).status_code == 403,
          "R5.5: only an administrator may change how the factory produces (403 for an operator and an approver)")
    pdCfgMoved = (pdCfg0.get("procedure"), pdCfg0.get("consumption")) != ("workOrder", "actual")
    pdCfg1 = admin.put(f"{BASE}/production/config", json={"procedure": "workOrder", "consumption": "actual"})
    check(pdCfg1.status_code == 200 and pdCfg1.json()["procedure"] == "workOrder"
          and pdCfg1.json()["consumption"] == "actual" and pdCfg1.json().get("updatedBy")
          and pdCfg1.json().get("updatedAt")
          and (not DB_URL or psql("select procedure || '/' || consumption from production_config") == "workOrder/actual"),
          "R5.5: an administrator's PUT replaces the row and stamps who changed it")
    pdWo = arif.post(f"{BASE}/production/batches", json={**pdBatch, "issueDate": tdate, "receiveDate": tdate})
    check(pdWo.status_code == 422 and pdWo.json().get("errors", {}).get("lines.0.workOrderId") == ["required"],
          f"R5.5: with the work-order procedure a batch has to draw on one — buildBatch read the row at once "
          f"({pdWo.status_code})")
    check(admin.put(f"{BASE}/production/config", json={"procedure": "nope"}).status_code == 422
          and admin.put(f"{BASE}/production/config", json={}).status_code == 422,
          "R5.5: a body the configuration's schema refuses is a 422")
    pdCfgAudit = admin.get(f"{BASE}/audit", params={"entity": "productionConfig", "size": 5}).json()["data"]
    pdCfgEvent = next((e for e in pdCfgAudit if e["action"] == "updated"), {})
    check(pdCfgEvent.get("ref") == "Production configuration" and pdCfgEvent.get("actor") == "System Administrator"
          and (not pdCfgMoved or {c["field"] for c in pdCfgEvent.get("changes") or []} >= {"procedure", "consumption"}),
          f"R5.5: …and the audit trail records what changed "
          f"({[c['field'] for c in pdCfgEvent.get('changes') or []]}{' — nothing to record, it already said that' if not pdCfgMoved else ''})")
    pdCfg2 = admin.put(f"{BASE}/production/config", json={"procedure": "directStock", "consumption": "standard"})
    pdFree = arif.post(f"{BASE}/production/batches", json={**pdBatch, "issueDate": tdate, "receiveDate": tdate})
    check(pdCfg2.status_code == 200 and pdFree.status_code == 201,
          "R5.5: …and setting it back lets a batch be created without a work order again")
    arif.delete(f"{BASE}/production/batches/{pdFree.json()['id']}")

    # ── R5.5: the work orders ────────────────────────────────────────────────────────────────────────────────
    # A work order is what the floor has to produce, and the progress it shows is never entered: it is what the
    # approved batches that draw on it have issued, received and rejected. So the rows are kept honest at both ends —
    # a batch write recomputes them in its own transaction, and every answer recomputes them again from the approved
    # batches' rows — and what the floor still owes is a SUM over `work_order_lines`.
    print("R5.5: the work orders are rows, and their progress follows the batches")

    wkPage = arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json()
    wkRows = wkPage["data"]
    check(wkPage["total"] == len(wkRows) >= 5 and wkPage["totals"] == {}
          and set(wkPage["facets"]) == {"process", "status"}
          and [w["createdAt"] for w in wkRows] == sorted((w["createdAt"] for w in wkRows), reverse=True),
          f"native (R5.5): GET /production/work-orders answers the page with its facets, newest first "
          f"({wkPage['total']} work orders)")
    check(all(w["status"] in ("draft", "open", "partial", "completed", "cancelled") for w in wkRows)
          and all((w["process"] == "Created") == (w["status"] == "draft") for w in wkRows)
          and all((w["process"] == "Cancelled") == (w["status"] == "cancelled") for w in wkRows)
          and sum(wkPage["facets"]["status"].values()) == wkPage["total"]
          and sum(wkPage["facets"]["process"].values()) == wkPage["total"],
          f"R5.5: every work order carries the status the batches give it ({json.dumps(wkPage['facets']['status'])})")
    if DB_URL:
        check(psql("select count(*) from work_orders where deleted_at is null") == str(wkPage["total"])
              and psql("select count(*) from work_order_lines l join work_orders w on w.id = l.work_order_id"
                       " where w.deleted_at is null") == str(sum(len(w["lines"]) for w in wkRows)),
              "R5.5: …and its total is the live rows of the table, each with the goods it asks for beside it")
        check(psql("""select count(*) from work_order_lines l join work_orders w on w.id = l.work_order_id
              where w.deleted_at is null and (coalesce(l.issued, 0), l.received, l.damaged) <> (
                (select coalesce(sum(bl.issue_qty), 0) from batch_lines bl join batches b on b.id = bl.batch_id
                  where bl.work_order_id = l.work_order_id and bl.item_id = l.item_id
                    and b.process = 'Approved' and b.deleted_at is null),
                (select coalesce(sum(bl.receive_qty), 0) from batch_lines bl join batches b on b.id = bl.batch_id
                  where bl.work_order_id = l.work_order_id and bl.item_id = l.item_id
                    and b.process = 'Approved' and b.deleted_at is null),
                (select coalesce(sum(bl.damage_qty), 0) from batch_lines bl join batches b on b.id = bl.batch_id
                  where bl.work_order_id = l.work_order_id and bl.item_id = l.item_id
                    and b.process = 'Approved' and b.deleted_at is null))""") == "0",
              "R5.5: every line's progress on its row is the sum of the approved batches that draw on it")
        check(psql("""select count(*) from work_order_lines l join work_orders w on w.id = l.work_order_id
              where w.deleted_at is null and l.remaining <> greatest(0, round(l.qty - coalesce(l.issued, 0), 2))""") == "0",
              "R5.5: …and what is still owed is the quantity ordered less what went into production")
        # the progress itself is recomputed from the batches on every answer, so what a SQL-only change has to move
        # is the quantity ordered — and what is still owed follows it
        wkProbe = wkRows[0]["id"]
        wkQty0 = float(psql(f"select qty from work_order_lines where work_order_id = '{wkProbe}' and ord = 1"))
        psql(f"update work_order_lines set qty = {jr2(wkQty0 + 25)} where work_order_id = '{wkProbe}' and ord = 1")
        wkMoved = arif.get(f"{BASE}/production/work-orders/{wkProbe}").json()
        wkListed = [w for w in arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json()["data"]
                    if w["id"] == wkProbe][0]
        check(wkMoved["lines"][0]["qty"] == jr2(wkQty0 + 25)
              and wkMoved["lines"][0]["remaining"] == jr2(max(0, wkQty0 + 25 - wkMoved["lines"][0]["issued"]))
              and wkListed["lines"][0]["qty"] == jr2(wkQty0 + 25),
              f"R5.5: a quantity ordered changed in SQL alone moves the answer at once, and what is still owed "
              f"follows it ({wkQty0} → {wkMoved['lines'][0]['qty']}, remaining {wkMoved['lines'][0]['remaining']})")
        psql(f"update work_order_lines set qty = {wkQty0} where work_order_id = '{wkProbe}' and ord = 1")
        wkBack = arif.get(f"{BASE}/production/work-orders/{wkProbe}").json()
        check(wkBack["lines"][0]["qty"] == wkQty0, "R5.5: …and putting the row back restores the answer exactly")

    wkCsv = arif.get(f"{BASE}/production/work-orders", params={"format": "csv"})
    wkLines = sum(len(w["lines"]) for w in wkRows)
    check(wkCsv.status_code == 200 and wkCsv.headers.get("content-type", "").startswith("text/csv")
          and "work-orders-" in wkCsv.headers.get("content-disposition", "")
          and wkCsv.text.splitlines()[0].lstrip("\ufeff")
          == "Issue Date,Work Order,Requisition No,Due,Item,UoM,Ordered,Issued,Received,Damaged,Remaining,Status"
          and len([l for l in wkCsv.text.splitlines()[1:] if l]) == wkLines,
          f"R5.5: the CSV export writes one row per line the floor owes ({wkLines} of them)")
    wkItem = wkRows[0]["lines"][0]["itemId"]
    check(arif.get(f"{BASE}/production/work-orders", params={"item": wkItem, "size": 50}).json()["total"]
          == sum(1 for w in wkRows if any(l["itemId"] == wkItem for l in w["lines"]))
          and "item" not in arif.get(f"{BASE}/production/work-orders", params={"item": wkItem, "size": 50}).json()["facets"],
          f"R5.5: ?item= keeps the work orders that ask for one SKU, and is taken out before the query runs")
    check(arif.get(f"{BASE}/production/work-orders", params={"status": "draft", "size": 50}).json()["total"]
          == wkPage["facets"]["status"].get("draft", 0)
          and arif.get(f"{BASE}/production/work-orders", params={"q": wkRows[0]["no"], "size": 50}).json()["total"] >= 1
          and [w["issueDate"] for w in arif.get(f"{BASE}/production/work-orders",
                                                params={"sort": "issueDate.asc", "size": 50}).json()["data"]]
          == sorted(w["issueDate"] for w in wkRows),
          "R5.5: ?status=, ?q= and ?sort= narrow and order the register as the mock's spec says")

    wkDrawn = ([w for w in wkRows if w["status"] in ("partial", "completed")] or wkRows)[0]
    wkOne = arif.get(f"{BASE}/production/work-orders/{wkDrawn['id']}").json()
    wkBatchPage = arif.get(f"{BASE}/production/batches", params={"size": 200}).json()["data"]
    wkDrawing = [b["id"] for b in wkBatchPage if any(l.get("workOrderId") == wkDrawn["id"] for l in b["lines"])]
    check(set(wkOne) == set(wkDrawn) | {"batches"} and sorted(b["id"] for b in wkOne["batches"]) == sorted(wkDrawing)
          and all(set(b) == {"id", "no", "mode", "issueDate", "process", "totalIssue", "totalReceive"}
                  for b in wkOne["batches"]),
          f"R5.5: GET /production/work-orders/{{id}} lists the batches that draw on it ({len(wkDrawing)} of them)")
    check(arif.get(f"{BASE}/production/work-orders/{wkDrawn['no']}").json()["id"] == wkDrawn["id"]
          and arif.get(f"{BASE}/production/work-orders/nosuchworkorder").status_code == 404
          and arif.get(f"{BASE}/production/work-orders/nosuchworkorder").json()["title"] == "Work order not found",
          "R5.5: a work order is found by its number too, and an unknown one is a 404 problem")

    # a work order of its own, approved at once, and a contractual challan that draws on it: the progress has to
    # follow the batch through every step — a draft counts for nothing, an approval moves what was issued, a receipt
    # what came back and what was rejected, and a cancellation gives it all back
    # an item with a declaration in force today, which is what a work order's line needs — the amended item when it
    # has one, any other when the suites before this one left it without
    wkInForce = [r["itemId"] for r in pdRows if r["process"] == "Approved" and r["effectiveDate"] <= tdate]
    wkFg = pdTwo["itemId"] if pdTwo["itemId"] in wkInForce else wkInForce[0]
    wkDue = time.strftime("%Y-%m-%d", time.localtime(time.time() + 14 * 86400))
    wkBody = {"requisitionNo": f"REQ-26-{TAG}", "issueDate": tdate, "dueDate": wkDue,
              "remark": f"R5.5 work order {TAG}", "lines": [{"itemId": wkFg, "qty": 40}], "process": "Approved"}
    wkNew = arif.post(f"{BASE}/production/work-orders", json=wkBody)
    wkn = wkNew.json() if wkNew.status_code == 201 else {}
    wkNewId, wkNewNo = wkn.get("id"), wkn.get("no")
    wkLine = (wkn.get("lines") or [{}])[0]
    check(wkNew.status_code == 201 and str(wkNewId).startswith("wo") and str(wkNewNo).startswith("PW-")
          and wkn.get("process") == "Approved" and wkn.get("status") == "open"
          and wkn.get("issuedBy") == "Arif Hossain" and wkn.get("requisitionNo") == wkBody["requisitionNo"]
          and wkn.get("dueDate") == wkDue
          and [h["action"] for h in wkn.get("history", [])] == ["created", "approved"]
          and set(wkLine) == {"itemId", "name", "sku", "uom", "qty", "issued", "received", "damaged", "remaining"}
          and wkLine.get("itemId") == wkFg and wkLine.get("qty") == 40 and wkLine.get("issued") == 0
          and wkLine.get("received") == 0 and wkLine.get("damaged") == 0 and wkLine.get("remaining") == 40,
          f"native (R5.5): a work order is created and approved in one step, with nothing issued yet ({wkNew.status_code} {wkNewNo})")
    if DB_URL:
        check(psql(f"select count(*) from work_orders where id = '{wkNewId}' and no = '{wkNewNo}'"
                   " and process = 'Approved' and status = 'open' and deleted_at is null") == "1"
              and psql(f"select count(*) from work_order_lines where work_order_id = '{wkNewId}'"
                       " and qty = 40 and received = 0 and remaining = 40") == "1",
              "R5.5: it is a row in work_orders with the goods it asks for beside it")
    wkAudit = arif.get(f"{BASE}/audit", params={"entity": "workOrder", "entityId": wkNewId, "size": 20}).json()["data"]
    # (a create+approve in one request can stamp both steps inside the same millisecond, where newest-first is a tie)
    check(len(wkAudit) == 2 and sorted(e["action"] for e in wkAudit) == ["approved", "created"]
          and all(e["ref"] == wkNewNo for e in wkAudit)
          and wkAudit[0]["at"] >= wkAudit[1]["at"],
          "R5.5: …and the audit trail records both steps against its number")
    wkView = session("auditor")  # a viewer reads everything and writes nothing
    check(wkView.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created"}).status_code == 403
          and wkView.get(f"{BASE}/production/work-orders").status_code == 200
          and requests.get(f"{BASE}/production/work-orders").status_code == 401,
          "R5.5: creating one needs doc.create — a viewer may read the register but not add to it, and reading it "
          "needs a session")
    wkOver = arif.post(f"{BASE}/production/batches", json={"mode": "inHouse", "issueDate": tdate, "receiveDate": tdate,
                       "remark": f"R5.5 over {TAG}", "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
                       "lines": [{"itemId": wkFg, "workOrderId": wkNewId, "issueQty": 41, "receiveQty": 0}],
                       "process": "Created"})
    check(wkOver.status_code == 422 and wkOver.json()["errors"].get("lines.0.issueQty") == ["exceedsWorkOrder"],
          f"R5.5: a batch cannot issue more than the work order has left ({wkOver.status_code}, from the mock's own rule)")
    wkChallan = {"mode": "contractual", "issueDate": tdate, "vendorId": bvid, "jobProcess": "washing",
                 "remark": f"R5.5 challan {TAG}", "issuedBy": "Arif Hossain", "designation": "Shift-In-Charge",
                 "lines": [{"itemId": wkFg, "workOrderId": wkNewId, "issueQty": 3}], "process": "Created"}
    wkB1 = arif.post(f"{BASE}/production/batches", json=wkChallan)
    wkB1id = wkB1.json().get("id") if wkB1.status_code == 201 else None
    check(wkB1.status_code == 201 and (not DB_URL or psql(
        f"select coalesce(trim_scale(issued), 0) || '/' || trim_scale(remaining) from work_order_lines"
              f" where work_order_id = '{wkNewId}'") == "0/40"),
          "R5.5: a draft challan draws on the work order but moves no progress — only approved batches count")
    check(arif.patch(f"{BASE}/production/batches/{wkB1id}", json={"process": "Approved"}).status_code == 200
          and arif.get(f"{BASE}/production/work-orders/{wkNewId}").json()["status"] == "partial"
          and arif.get(f"{BASE}/production/work-orders/{wkNewId}").json()["lines"][0]["issued"] == 3
          and (not DB_URL or psql(
              f"select trim_scale(issued) || '/' || trim_scale(remaining) from work_order_lines"
              f" where work_order_id = '{wkNewId}'") == "3/37"
              and psql(f"select status from work_orders where id = '{wkNewId}'") == "partial"),
          "R5.5: approving it moves the work order's progress — on the row and in the register at once")
    wkRec = arif.post(f"{BASE}/production/batches/{wkB1id}/receive",
                      json={"receiveDate": tdate, "lines": [{"receiveQty": 2, "damageQty": 1}]})
    check(wkRec.status_code == 200
          and arif.get(f"{BASE}/production/work-orders/{wkNewId}").json()["lines"][0]["received"] == 2
          and (not DB_URL or psql(
              f"select trim_scale(issued) || '/' || trim_scale(received) || '/' || trim_scale(damaged) || '/'"
              f" || trim_scale(remaining) from work_order_lines where work_order_id = '{wkNewId}'") == "3/2/1/37"),
          "R5.5: …and the contractor's receipt moves what came back and what was rejected")
    wkCancel = arif.patch(f"{BASE}/production/work-orders/{wkNewId}",
                          json={"process": "Cancelled", "reason": "not needed"})
    check(wkCancel.status_code == 409 and wkCancel.json()["title"]
          == f"{wkNewNo} has production batches ({wkB1.json().get('no')}) — cancel them first.",
          "R5.5: a work order a live batch draws on cannot be cancelled — the 409 names the batch")
    check(arif.patch(f"{BASE}/production/work-orders/{wkNewId}", json={"process": "Approved"}).status_code == 409
          and arif.put(f"{BASE}/production/work-orders/{wkNewId}", json={}).status_code == 409
          and arif.delete(f"{BASE}/production/work-orders/{wkNewId}").status_code == 409,
          "R5.5: an approved work order is neither approved again, nor edited (the 409 comes before the body is "
          "parsed), nor deleted")
    check(arif.patch(f"{BASE}/production/batches/{wkB1id}",
                     json={"process": "Cancelled", "reason": f"R5.5 cancelled {TAG}"}).status_code == 200
          and (not DB_URL or psql(
              f"select coalesce(trim_scale(issued), 0) || '/' || trim_scale(received) || '/' || trim_scale(damaged)"
              f" || '/' || trim_scale(remaining) from work_order_lines where work_order_id = '{wkNewId}'"
              ) == "0/0/0/40"
              and psql(f"select status from work_orders where id = '{wkNewId}'") == "open"),
          "R5.5: cancelling the batch takes the progress back — the work order is open again, on the row")
    wkCancelled = arif.patch(f"{BASE}/production/work-orders/{wkNewId}",
                             json={"process": "Cancelled", "reason": f"R5.5 cancelled {TAG}"})
    check(wkCancelled.status_code == 200 and wkCancelled.json().get("status") == "cancelled"
          and wkCancelled.json().get("cancelReason") == f"R5.5 cancelled {TAG}"
          and [h["action"] for h in wkCancelled.json().get("history", [])] == ["created", "approved", "cancelled"]
          and (not DB_URL or psql(f"select count(*) from work_orders where id = '{wkNewId}'"
                                  " and process = 'Cancelled' and cancel_reason is not null") == "1"),
          "R5.5: …and with the batches gone it cancels, with the reason on the row")
    check(arif.patch(f"{BASE}/production/work-orders/{wkNewId}",
                     json={"process": "Cancelled", "reason": f"R5.5 cancelled {TAG}"}).status_code == 409
          and arif.delete(f"{BASE}/production/work-orders/{wkNewId}").status_code == 409
          and arif.delete(f"{BASE}/production/work-orders/{wkNewId}").json()["title"]
          == f"Only drafts can be deleted — cancel {wkNewNo} instead.",
          "R5.5: a cancelled work order is not cancelled twice, and cannot be deleted")

    wkDraftR = arif.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created",
                                                                 "requisitionNo": f"REQ-26-{TAG}c"})
    wkDraft = wkDraftR.json() if wkDraftR.status_code == 201 else {}
    check(wkDraftR.status_code == 201 and wkDraft.get("status") == "draft" and wkDraft.get("process") == "Created",
          f"R5.5: a draft work order stays a draft ({wkDraft.get('no')})")
    wkBad = [("an unknown SKU", {"lines": [{"itemId": "i6", "qty": 10}], "issueDate": tdate, "process": "Created"},
              {"lines.0.itemId": ["unknown"]}),
             ("a SKU with no declaration in force on the issue date",
              {"lines": [{"itemId": wkFg, "qty": 10}], "issueDate": "2020-01-01", "process": "Created"},
              {"lines.0.itemId": ["noBom"]}),
             ("the same SKU twice", {"lines": [{"itemId": wkFg, "qty": 10}, {"itemId": wkFg, "qty": 5}],
                                     "issueDate": tdate, "process": "Created"},
              {"lines.1.itemId": ["duplicate"]}),
             ("a due date before the issue date", {"lines": [{"itemId": wkFg, "qty": 10}], "issueDate": tdate,
                                                   "dueDate": "2026-01-01", "process": "Created"},
              {"dueDate": ["beforeIssue"]}),
             ("no lines at all", {"lines": [], "issueDate": tdate, "process": "Created"},
              {"lines": ["atLeastOneLine"]})]
    for wkWhy, wkBadBody, wkWant in wkBad:
        wkR = arif.post(f"{BASE}/production/work-orders", json=wkBadBody)
        check(wkR.status_code == 422 and wkR.json()["title"] == "Validation failed"
              and all(wkR.json().get("errors", {}).get(k) == v for k, v in wkWant.items()),
              f"R5.5: {wkWhy} is refused with the mock's own 422 ({json.dumps(wkR.json().get('errors'))[:80]})")
    check(arif.delete(f"{BASE}/production/work-orders/{wkDraft.get('no')}").status_code == 404
          and arif.delete(f"{BASE}/production/work-orders/{wkDraft.get('id')}").status_code == 200
          and arif.get(f"{BASE}/production/work-orders/{wkDraft.get('id')}").status_code == 404,
          "R5.5: deleting a draft matches the id only, answers {ok: true}, and takes it out of the register")
    if DB_URL:
        check(psql(f"select count(*) from work_orders where id = '{wkDraft.get('id')}'"
                   " and deleted_at is not null") == "1"
              and psql(f"select count(*) from work_order_lines where work_order_id = '{wkDraft.get('id')}'") == "1",
              "R5.5: …the row is stamped rather than removed, and keeps the lines it asked for")
    wkAgain = arif.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created",
                                                                "requisitionNo": f"REQ-26-{TAG}d"}).json()
    check(wkAgain.get("id") and wkDraft.get("id") and int(wkAgain["id"][2:]) > int(wkDraft["id"][2:])
          and wkAgain.get("no") != wkDraft.get("no") and str(wkAgain.get("no")).startswith(str(wkDraft.get("no"))[:7]),
          f"R5.5: the next work order takes a new id and a new number — the deleted draft's stays retired "
          f"({wkDraft['id']} {wkDraft['no']} → {wkAgain['id']} {wkAgain['no']})")
    if wkAgain.get("id"):
        arif.delete(f"{BASE}/production/work-orders/{wkAgain['id']}")
    if DB_URL:
        wkDup = subprocess.run(["psql", DB_URL, "-c",
                                "insert into work_orders (id, no, issue_date, process, status, issued_by, created_at)"
                                f" select 'dupw{TAG}', no, issue_date, process, status, issued_by, created_at"
                                f" from work_orders where id = '{wkDrawn['id']}'"], capture_output=True, text=True)
        check(wkDup.returncode != 0, "R5.5: the database refuses a duplicate work order number (unique index), "
                                     "not just the API")

    # ── R5.5: the two derived registers of production ────────────────────────────────────────────────────────
    # Neither stores anything of its own. The finished-goods lots add up what the approved batches received and what
    # the approved invoices have drawn on since; the subcontracting register walks the contractual batches — what is
    # still at a contract manufacturer under a Mushak 6.4 challan, and for how long. Every document both read is a
    # row now, so both are served from the tables, and the proof is the derived stock's: the numbers agree with the
    # same sums written in SQL, and a row changed in SQL alone — the in-memory copies left stale on purpose — moves
    # the answer at once.
    print("R5.5: the finished-goods lots and the subcontracting register are derived from the tables")

    ltAll = arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
    ltLive = arif.get(f"{BASE}/production/lots").json()
    check(isinstance(ltAll, list) and len(ltAll) >= 1
          and all(set(l) == {"batchId", "batchNo", "date", "itemId", "received", "sold", "available"} for l in ltAll)
          and [l["date"] for l in ltAll] == sorted(l["date"] for l in ltAll)
          and all(l["available"] > 0 for l in ltLive) and len(ltLive) <= len(ltAll),
          f"native (R5.5): GET /production/lots answers the lots sorted by date, and ?all=1 keeps the empty ones "
          f"({len(ltAll)} lots, {len(ltLive)} with stock left)")
    check(all(l["available"] == jr2(max(0, l["received"] - l["sold"])) for l in ltAll)
          and all(l["batchNo"].startswith("PB-") for l in ltAll),
          "R5.5: what is left in a lot is what its batch received less what the invoices drew, and each quotes it")
    ltItem = ltAll[0]["itemId"]
    check([l for l in arif.get(f"{BASE}/production/lots", params={"all": 1, "item": ltItem}).json()
           if l["itemId"] != ltItem] == []
          and len(arif.get(f"{BASE}/production/lots", params={"all": 1, "item": ltItem}).json()) >= 1,
          f"R5.5: ?item= keeps one SKU's lots ({ltItem})")
    if DB_URL:
        check(psql("""select count(*) from (select l.batch_id, l.item_id from batch_lines l
                        join batches b on b.id = l.batch_id
                       where b.process = 'Approved' and b.deleted_at is null and l.receive_qty > 0
                       group by l.batch_id, l.item_id) t""") == str(len(ltAll)),
              f"R5.5: …and there is exactly one lot per batch and SKU an approved batch received ({len(ltAll)})")
        for lt in ltAll[:5]:
            ltGot = psql(f"""select trim_scale(coalesce(sum(l.receive_qty), 0)) || '/' || trim_scale(coalesce((
                   select sum(sl.qty) from sale_lines sl join sales sa on sa.id = sl.sale_id
                    where sl.batch_id = '{lt["batchId"]}' and sl.item_id = '{lt["itemId"]}'
                      and sa.process = 'Approved' and sa.deleted_at is null), 0))
                 from batch_lines l join batches b on b.id = l.batch_id
                where l.batch_id = '{lt["batchId"]}' and l.item_id = '{lt["itemId"]}'
                  and b.process = 'Approved' and b.deleted_at is null""")
            check(ltGot == f"{lt['received']}/{lt['sold']}",
                  f"R5.5: lot {lt['batchNo']} / {lt['itemId']} — received and drawn are the same sums in SQL "
                  f"({ltGot} = {lt['received']}/{lt['sold']})")
        # the decisive one: a received quantity changed in SQL alone, with the in-memory copies left stale. The lot
        # is picked, not assumed: enough received to take some away, enough left to draw on an invoice, and more
        # stock at its branch than the lot holds — so the lot, not the branch stock, is what refuses an overdraft.
        ltStock = {r["id"]: r for r in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"]}
        ltPick, ltSecond = None, None
        for ltCand in ltAll:
            if ltCand["received"] < 2 or ltCand["available"] < 6:
                continue
            ltBr = arif.get(f"{BASE}/production/batches/{ltCand['batchId']}").json().get("branchId")
            ltHave = ltStock.get(ltCand["itemId"], {}).get("byBranch", {}).get(ltBr, 0)
            if ltHave < 6:
                continue
            if ltHave > ltCand["available"] and ltPick is None:
                ltPick = (ltCand, ltBr, True)   # the lot, not the branch stock, is what refuses an overdraft
            elif ltSecond is None:
                ltSecond = (ltCand, ltBr, False)
        ltPick = ltPick or ltSecond
        check(ltPick is not None, "R5.5: a lot is left with stock to draw — the one the probes below move")
        ltRow, ltBranch, ltLotBinds = ltPick
        ltOrd = psql(f"select ord from batch_lines where batch_id = '{ltRow['batchId']}'"
                     f" and item_id = '{ltRow['itemId']}'")
        ltQty0 = float(psql(f"select receive_qty from batch_lines where batch_id = '{ltRow['batchId']}'"
                            f" and item_id = '{ltRow['itemId']}' and ord = {ltOrd}"))
        ltTake = min(7, jr2(ltQty0 - 1))
        ltStock0 = [r for r in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"]
                    if r["id"] == ltRow["itemId"]][0]["remain"]
        psql(f"update batch_lines set receive_qty = {jr2(ltQty0 - ltTake)} where batch_id = '{ltRow['batchId']}'"
             f" and item_id = '{ltRow['itemId']}' and ord = {ltOrd}")
        ltMoved = [l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
                   if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0]
        ltSplit = [r for r in arif.get(f"{BASE}/stock", params={"size": 200}).json()["data"]
                   if r["id"] == ltRow["itemId"]][0]["remain"]
        check(ltMoved["received"] == jr2(ltQty0 - ltTake)
              and ltMoved["available"] == jr2(max(0, ltQty0 - ltTake - ltMoved["sold"]))
              and ltSplit == ltStock0,
              f"R5.5: a received quantity changed in SQL alone moves that lot at once ({ltQty0} → {ltMoved['received']},"
              f" {ltRow['available']} → {ltMoved['available']} left) and not the branch split, which counts the SKU's"
              f" own counters ({ltSplit})")
        psql(f"update batch_lines set receive_qty = {ltQty0} where batch_id = '{ltRow['batchId']}'"
             f" and item_id = '{ltRow['itemId']}' and ord = {ltOrd}")
        ltBack = [l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
                  if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0]
        check(ltBack == ltRow, "R5.5: …and putting the row back restores the lot exactly")

        # an invoice that draws on a lot: the lot follows it, and a line changed in SQL alone moves it again
        ltRow = [l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
                 if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0]
        ltOver = arif.post(f"{BASE}/sales", json={**inv_body, "branchId": ltBranch, "process": "Approved",
                                                  "lines": [{"itemId": ltRow["itemId"],
                                                             "qty": jr2(ltRow["available"] + 1),
                                                             "price": 100, "sdRate": 0, "vatRate": 5,
                                                             "batchId": ltRow["batchId"]}]})
        ltOverQty = ltOver.json().get("errors", {}).get("lines.0.qty") or []
        check(ltOver.status_code == 422 and (("exceedsLot" in ltOverQty) if ltLotBinds else bool(ltOverQty)),
              f"R5.5: an invoice cannot draw more than the lot has left ({ltOver.status_code} "
              f"{json.dumps(ltOverQty)}, from the mock's own rule — which reads the copies this register's tables "
              f"are written through)")
        ltSale = arif.post(f"{BASE}/sales", json={**inv_body, "branchId": ltBranch, "process": "Approved",
                                                  "narration": f"R5.5 lot draw {TAG}",
                                                  "lines": [{"itemId": ltRow["itemId"], "qty": 5, "price": 100,
                                                             "sdRate": 0, "vatRate": 5, "batchId": ltRow["batchId"]}]})
        ltSid = ltSale.json().get("id")
        ltDrawn = [l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
                   if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0]
        check(ltSale.status_code == 201 and ltDrawn["sold"] == jr2(ltRow["sold"] + 5)
              and ltDrawn["available"] == jr2(max(0, ltRow["received"] - ltDrawn["sold"]))
              and (ltDrawn["available"] > 0) == (ltDrawn in arif.get(f"{BASE}/production/lots").json()),
              f"R5.5: an approved invoice that draws on a lot moves it ({ltRow['sold']} → {ltDrawn['sold']} drawn, "
              f"{ltDrawn['available']} left)")
        psql(f"update sale_lines set qty = qty + 3 where sale_id = '{ltSid}' and batch_id = '{ltRow['batchId']}'")
        ltAgain = [l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
                   if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0]
        check(ltAgain["sold"] == jr2(ltDrawn["sold"] + 3),
              f"R5.5: …and a line of that invoice changed in SQL alone moves the lot again ({ltDrawn['sold']} → "
              f"{ltAgain['sold']} drawn)")
        psql(f"update sale_lines set qty = qty - 3 where sale_id = '{ltSid}' and batch_id = '{ltRow['batchId']}'")
        check(arif.get(f"{BASE}/production/lots", params={"all": 1, "exclude": ltSid}).json()
              == [dict(l, sold=jr2(l["sold"] - 5), available=jr2(max(0, l["received"] - l["sold"] + 5)))
                  if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"] else l
                  for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()],
              "R5.5: ?exclude= leaves one invoice out — which is how the sales form edits a draft that draws a lot")
        arif.patch(f"{BASE}/sales/{ltSid}", json={"process": "Cancelled", "reason": f"R5.5 lot probe {TAG}"})
        check([l for l in arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
               if l["batchId"] == ltRow["batchId"] and l["itemId"] == ltRow["itemId"]][0] == ltRow,
              "R5.5: …and cancelling the invoice gives the lot its stock back")

    scRow = arif.get(f"{BASE}/production/subcontract").json()
    check(set(scRow) == {"from", "to", "overdueDays", "rows", "totals"}
          and scRow["from"] == f"{int(scRow['to'][:4]) - (1 if scRow['to'][5:7] >= '07' else 2)}-07-01"
          and scRow["overdueDays"] == 30 and set(scRow["totals"]) == {"atContractor", "pendingValue", "overdue", "returned"},
          f"native (R5.5): GET /production/subcontract answers the fiscal year the RMG registers run on by default "
          f"({scRow['from']} → {scRow['to']})")
    scAll = arif.get(f"{BASE}/production/subcontract", params={"from": "2025-01-01", "to": tdate}).json()
    scFields = {"id", "no", "issueDate", "receiveDate", "vendorId", "vendorName", "vendorBin", "process",
                "state", "materialValue", "value", "issued", "received", "damaged", "pending", "days", "status"}
    check(all(set(r) <= scFields and set(r) >= scFields - {"receiveDate"} for r in scAll["rows"])
          and [(r["issueDate"], r["no"]) for r in scAll["rows"]]
          == sorted(((r["issueDate"], r["no"]) for r in scAll["rows"]), key=lambda x: (x[0], x[1]), reverse=True)
          and all(r["pending"] == jr2(max(0, r["issued"] - r["received"] - r["damaged"])) for r in scAll["rows"]),
          f"R5.5: …every contractual challan in the range, newest first, with what is still at the contractor "
          f"({len(scAll['rows'])} of them)")
    check(scAll["totals"]["atContractor"] == sum(1 for r in scAll["rows"] if r["status"] in ("atContractor", "partial", "overdue"))
          and scAll["totals"]["returned"] == sum(1 for r in scAll["rows"] if r["status"] == "returned")
          and scAll["totals"]["overdue"] == sum(1 for r in scAll["rows"] if r["status"] == "overdue"),
          f"R5.5: the totals count the same rows ({json.dumps(scAll['totals'])})")
    scOnly = arif.get(f"{BASE}/production/subcontract",
                      params={"from": "2025-01-01", "to": tdate, "status": "returned"}).json()
    check(scOnly["rows"] == [r for r in scAll["rows"] if r["status"] == "returned"]
          and scOnly["totals"] == scAll["totals"],
          "R5.5: ?status= keeps one state of the challan — the totals still count the whole range")
    scOverdue = {}
    for scDays in (1, 30, 365):
        scGot = arif.get(f"{BASE}/production/subcontract", params={"from": "2025-01-01", "to": tdate, "days": scDays}).json()
        scOverdue[scDays] = sum(1 for r in scGot["rows"] if r["status"] == "overdue")
        check(scGot["overdueDays"] == scDays
              and all((r["status"] == "overdue") == (r["days"] > scDays and r["status"] not in ("returned", "cancelled", "draft"))
                      for r in scGot["rows"])
              and scGot["totals"]["overdue"] == scOverdue[scDays],
              f"R5.5: ?days={scDays} moves the overdue threshold — a challan is overdue once it is older than that "
              f"and has not come back ({scOverdue[scDays]} of {len(scGot['rows'])})")
    check(scOverdue[1] >= scOverdue[30] >= scOverdue[365],
          f"R5.5: …and the stricter the threshold, the more challans are overdue "
          f"({scOverdue[1]} / {scOverdue[30]} / {scOverdue[365]})")
    scCsv = arif.get(f"{BASE}/production/subcontract", params={"from": "2025-01-01", "to": tdate, "format": "csv"})
    check(scCsv.status_code == 200 and scCsv.headers.get("content-type", "").startswith("text/csv")
          and scCsv.headers.get("content-disposition") == f'attachment; filename="subcontract-register-2025-01-01-{tdate}.csv"'
          and scCsv.text.splitlines()[0].lstrip("\ufeff").startswith("Batch No,Sent,Returned,Contractor,BIN,Process")
          and len([l for l in scCsv.text.splitlines()[1:] if l]) == len(scAll["rows"]),
          "R5.5: the CSV export writes the register's fourteen columns, one row per challan")
    for scWhy, scParams, scWant in [("a from that is not a date", {"from": "nope"}, {"from": ["date"]}),
                                    ("a to that is not a date", {"to": "nope"}, {"to": ["date"]}),
                                    ("a range the wrong way round", {"from": tdate, "to": "2025-01-01"},
                                     {"to": ["toBeforeFrom"]})]:
        scBad = arif.get(f"{BASE}/production/subcontract", params=scParams)
        check(scBad.status_code == 422 and scBad.json()["title"] == "Validation failed"
              and scBad.json().get("errors") == scWant,
              f"R5.5: {scWhy} is a 422 from the register's own rule ({json.dumps(scBad.json().get('errors'))})")
    check(requests.get(f"{BASE}/production/lots").status_code == 401
          and requests.get(f"{BASE}/production/subcontract").status_code == 401,
          "R5.5: both registers need a session")
    if DB_URL:
        check(psql("""select count(*) from batches where mode = 'contractual' and deleted_at is null
                       and issue_date >= '2025-01-01'""") == str(len(scAll["rows"])),
              "R5.5: …and its rows are the contractual batches in the range, straight out of the table")
        scCand = [r for r in scAll["rows"] if r["received"] >= 5] or [r for r in scAll["rows"] if r["pending"] >= 5]
        check(len(scCand) >= 1, "R5.5: a challan is left whose receipt the probe can move")
        scOne = scCand[0]
        scStep = -5 if scOne["received"] >= 5 else 5
        scNewRec = jr2(scOne["received"] + scStep)
        scNewPend = jr2(max(0, scOne["issued"] - scNewRec - scOne["damaged"]))
        scRec0 = float(psql(f"select total_receive from batches where id = '{scOne['id']}'"))
        scAt0 = psql(f"select coalesce({_ISO.format('received_at')}, '') from batches where id = '{scOne['id']}'")
        scLots0 = arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
        # clearing the receipt also clears the date the "days" are counted to, and the register then counts to the
        # company's today — which a receipt may be *later* than (it stamps the real clock, TODAY is a demo date), so
        # the days can go down as well as up; what has to hold is the rule: the days are between the issue date and
        # the receipt, or between the issue date and today when there is none
        scToday = arif.get(f"{BASE}/production/subcontract").json()["to"]
        scWantDays = max(0, (datetime.date.fromisoformat(scToday) - datetime.date.fromisoformat(scOne["issueDate"])).days)
        psql(f"update batches set total_receive = {scNewRec}, received_at = null where id = '{scOne['id']}'")
        scMoved = [r for r in arif.get(f"{BASE}/production/subcontract",
                                       params={"from": "2025-01-01", "to": tdate}).json()["rows"] if r["id"] == scOne["id"]][0]
        scLots1 = arif.get(f"{BASE}/production/lots", params={"all": 1}).json()
        # the lots read a batch's *lines*, not the totals on its row, so this challan's lots cannot have moved; the
        # whole list is compared too, and anything that did move is named in the failure
        scLotOf = lambda ls: [l for l in ls if l["batchId"] == scOne["id"]]
        scLotDiff = [(a, b) for a, b in zip(scLots0, scLots1) if a != b]
        if len(scLots0) != len(scLots1):
            scLotDiff.append((len(scLots0), len(scLots1)))
        check(scMoved["received"] == scNewRec and scMoved["pending"] == scNewPend
              and scMoved["status"] != "returned" and scMoved["days"] == scWantDays
              and scMoved["issued"] == scOne["issued"] and scMoved["damaged"] == scOne["damaged"]
              and scMoved["materialValue"] == scOne["materialValue"] and scMoved["value"] == scOne["value"]
              and scLotOf(scLots1) == scLotOf(scLots0) and not scLotDiff,
              f"R5.5: a challan's receipt changed in SQL alone moves the register at once ({scOne['received']} → "
              f"{scMoved['received']} returned, {scOne['pending']} → {scMoved['pending']} pending, "
              f"{scOne['status']} → {scMoved['status']}, {scOne['days']} → {scMoved['days']} days counted to "
              f"{scToday}) and leaves the lots alone "
              f"({json.dumps(scLotDiff)[:300] if scLotDiff else 'no lot moved'})")
        psql(f"update batches set total_receive = {scRec0}, received_at = "
             + (f"'{scAt0}'" if scAt0 else "null") + f" where id = '{scOne['id']}'")
        scBack = [r for r in arif.get(f"{BASE}/production/subcontract",
                                      params={"from": "2025-01-01", "to": tdate}).json()["rows"] if r["id"] == scOne["id"]][0]
        check(scBack["received"] == scOne["received"] and scBack["pending"] == scOne["pending"]
              and scBack["status"] == scOne["status"],
              "R5.5: …and putting the row back restores the register — the lots never moved, because they read the "
              "batch's lines, not its totals")

    # ── R5.6: accounting ──────────────────────────────────────────────────────────────────────────────────────
    # The money accounts, the receipts and the payments with the invoices they settle. The decisive check is the one
    # that crosses families: `paid` and `due` are columns of `sales` and `purchases`, so a receipt that settles an
    # invoice writes those rows with it — and cancelling it, or a transaction that rolled back, puts them back. What
    # an invoice still owes is what the sales form, the statement and `settlementsOf` all read.
    print("R5.6: accounting is rows, and a settlement reaches the invoices it settles")

    ayPage = arif.get(f"{BASE}/accounting/accounts", params={"size": 100}).json()
    ayRows = ayPage["data"]
    check(ayPage["total"] == len(ayRows) >= 3 and set(ayPage["facets"]) == {"kind", "status"}
          and all({"id", "kind", "provider", "accountNo", "owner", "openingBalance", "inflow", "outflow", "balance", "docs"}
                  <= set(a) for a in ayRows)
          and [a["provider"] for a in ayRows] == sorted((a["provider"] for a in ayRows), key=str.lower),
          f"native (R5.6): GET /accounting/accounts answers the page with the derived balance on every row "
          f"({ayPage['total']} accounts)")
    check(all(a["balance"] == jr2(a["openingBalance"] + a["inflow"] - a["outflow"]) for a in ayRows)
          and ayPage["totals"].get("balance") == jr2(sum(a["balance"] for a in ayRows)),
          "R5.6: a balance is the opening balance plus what was received less what was paid out")
    if DB_URL:
        check(psql("select count(*) from money_accounts") == str(ayPage["total"]),
              f"R5.6: …and its total is the rows of the table ({ayPage['total']})")
        # the inflow is every approved receipt on the account, less its charge; the outflow is the payments *and*
        # the treasury deposits, which are still compat state — so only the side that is rows is summed here
        for ayAcc in ayRows[:4]:
            ayGot = psql(f"""select coalesce((select sum(amount - charge) from money_docs
                    where account_id = '{ayAcc["id"]}' and kind = 'receipt' and process = 'Approved'
                      and deleted_at is null), 0)""")
            check(jr2(float(ayGot)) == ayAcc["inflow"],
                  f"R5.6: {ayAcc['provider']} · {ayAcc['accountNo']} — what it received is the same sum over "
                  f"money_docs ({ayGot} = {ayAcc['inflow']})")
    # an account of its own, so the checks below never disturb the seeded ones
    ayKind = "bank"
    ayBody = {"kind": ayKind, "provider": f"R5.6 Bank {TAG}", "accountNo": f"00{TAG}", "owner": "DiziVat Ltd",
              "branch": "Gulshan", "bankType": "current", "serviceCharge": 0.5,
              "openingBalance": 100000, "openingDate": "2026-01-01", "active": True}
    ayNew = arif.post(f"{BASE}/accounting/accounts", json=ayBody)
    ayn = ayNew.json() if ayNew.status_code == 201 else {}
    check(ayNew.status_code == 201 and str(ayn.get("id", "")).startswith("ac") and ayn.get("balance") == 100000
          and ayn.get("inflow") == 0 and ayn.get("outflow") == 0 and ayn.get("docs") == 0,
          f"native (R5.6): an account is created with its opening balance and nothing through it "
          f"({ayNew.status_code} {ayn.get('provider')})")
    if DB_URL:
        check(psql(f"select count(*) from money_accounts where id = '{ayn.get('id')}'"
                   f" and opening_balance = 100000 and kind = '{ayKind}'") == "1",
              "R5.6: …and it is a row in money_accounts")
    ayDup = arif.post(f"{BASE}/accounting/accounts", json={**ayBody, "accountNo": f"00-{TAG}"})
    check(ayDup.status_code == 422 and ayDup.json().get("errors", {}).get("accountNo") == ["duplicate"],
          "R5.6: the same account number at the same provider is a 422 — the mock's own duplicate rule")
    ayWalletNo = f"019{int(TAG, 16) % 10 ** 8:08d}"  # 11 digits: the form's own MOBILE_RE
    ayWalletBody = {"kind": "mobile", "provider": f"R5.6 Wallet {TAG}", "accountNo": ayWalletNo,
                    "owner": "DiziVat Ltd", "walletType": "merchant", "authorised": "Arif Hossain",
                    "serviceCharge": 0.5, "openingBalance": 5000, "openingDate": "2026-01-01", "active": True}
    ayWalletR = arif.post(f"{BASE}/accounting/accounts", json=ayWalletBody)
    check(ayWalletR.status_code == 201 and ayWalletR.json().get("kind") == "mobile",
          f"native (R5.6): a mobile wallet is another kind, which the register keeps apart by its own facet "
          f"({ayWalletR.status_code})")
    check(arif.post(f"{BASE}/accounting/accounts", json={**ayWalletBody, "accountNo": f"00-{TAG}"}).status_code == 422
          and arif.post(f"{BASE}/accounting/accounts", json={**ayWalletBody, "kind": "bank"}).status_code == 422,
          "R5.6: a wallet number that is not a mobile number, and a bank account without its type, are refused")
    if ayWalletR.status_code == 201:
        arif.delete(f"{BASE}/accounting/accounts/{ayWalletR.json()['id']}")
    ayCash = {k: v for k, v in ayBody.items() if k not in ("branch", "bankType")}
    check(arif.put(f"{BASE}/accounting/accounts/{ayn.get('id')}", json={**ayCash, "kind": "cash"}).status_code == 409
          and arif.put(f"{BASE}/accounting/accounts/{ayn.get('id')}",
                       json={**ayCash, "kind": "cash"}).json()["title"]
          == "An account cannot change its kind — add a new account.",
          "R5.6: …and an account cannot change its kind (409, from the mock's own rule — reached once the body the "
          "new kind needs is there)")
    check(arif.put(f"{BASE}/accounting/accounts/{ayn.get('id')}",
                   json={**ayBody, "openingBalance": 120000}).json().get("balance") == 120000,
          "R5.6: editing an account moves its balance, which is derived, not stored")
    ayCsv = arif.get(f"{BASE}/accounting/accounts", params={"format": "csv"})
    check(ayCsv.status_code == 200 and ayCsv.headers.get("content-disposition", "").startswith("attachment; filename=\"money-accounts-")
          and ayCsv.text.splitlines()[0].lstrip("\ufeff").startswith("Kind,Bank / service,Branch"),
          "R5.6: the CSV export writes the account columns, one row per account")
    check(pdOp.post(f"{BASE}/accounting/accounts", json=ayBody).status_code == 403
          and requests.get(f"{BASE}/accounting/accounts").status_code == 401,
          "R5.6: adding an account needs master.edit, and reading them needs a session")

    # a receipt: the open invoices of one customer, and one of them settled
    def ay_parties(collection, mode="Local"):
        r = arif.get(f"{BASE}/{collection}", params={"size": 200}).json()
        return [p for p in (r["data"] if isinstance(r, dict) else r) if p.get("mode") == mode]

    ayParty = None
    for ayCand in ay_parties("customers")[:14]:
        ayOpen = arif.get(f"{BASE}/accounting/open-invoices", params={"kind": "receipt", "party": ayCand["id"]}).json()
        if ayOpen and ayOpen[0]["due"] >= 100:
            ayParty, ayInv = ayCand, ayOpen[0]
            break
    check(ayParty is not None, "R5.6: a customer is left with an open invoice to settle")
    ayBank = ayn.get("id") if ayn.get("kind") == "bank" else [a for a in ayRows if a["kind"] == "bank"][0]["id"]
    ayDate = "2026-07-15"
    ayCfg0 = arif.get(f"{BASE}/accounting/config").json()
    if ayCfg0.get("closedUpTo") and ayDate <= ayCfg0["closedUpTo"]:
        ayDate = time.strftime("%Y-%m-%d", time.localtime(time.mktime(time.strptime(ayCfg0["closedUpTo"], "%Y-%m-%d")) + 86400))
    ayRec = {"partyId": ayParty["id"], "date": ayDate, "method": "bankTransfer", "accountId": ayBank,
             "amount": 500, "reference": f"R5.6 {TAG}", "allocations": [{"docId": ayInv["id"], "amount": 500}],
             "process": "Created"}
    ayPaid0 = float(psql(f"select paid from sales where id = '{ayInv['id']}'")) if DB_URL else None
    ayDue0 = ayInv["due"]
    ayDraft = arif.post(f"{BASE}/accounting/receipts", json=ayRec)
    aym = ayDraft.json() if ayDraft.status_code == 201 else {}
    check(ayDraft.status_code == 201 and str(aym.get("no", "")).startswith("MR-") and aym.get("process") == "Created"
          and aym.get("allocated") == 500 and aym.get("unallocated") == 0 and aym.get("partyName") == ayParty["name"],
          f"native (R5.6): a receipt is created and numbered, against the invoice it will settle "
          f"({ayDraft.status_code} {aym.get('no')})")
    if DB_URL:
        check(psql(f"select count(*) from money_docs where id = '{aym.get('id')}' and kind = 'receipt'"
                   " and process = 'Created' and deleted_at is null") == "1"
              and psql(f"select invoice_no || ':' || trim_scale(amount) from money_allocations"
                       f" where doc_id = '{aym.get('id')}'") == f"{ayInv['no']}:500",
              "R5.6: …and it is a row in money_docs with the invoice it settles beside it")
        check(psql(f"select paid = {ayPaid0} from sales where id = '{ayInv['id']}'") == "t",
              "R5.6: a draft settles nothing — the invoice's own row is untouched until it is approved")
    for ayWhy, ayBad, ayWant in [
        ("a closed book", {**ayRec, "date": ayCfg0["closedUpTo"]} if ayCfg0.get("closedUpTo") else None, None),
        ("a date in the future", {**ayRec, "date": "2030-01-01"}, {"date": ["future"]}),
        ("an account that is not a bank", {**ayRec, "method": "cash"}, {"accountId": ["accountMismatch"]}),
        ("more allocated than the receipt took", {**ayRec, "amount": 10},
         {"amount": ["overAllocated"]}),
        ("more than the invoice has left", {**ayRec, "amount": ayDue0 + 1,
                                            "allocations": [{"docId": ayInv["id"], "amount": ayDue0 + 1}]},
         {"allocations.0.amount": ["exceedsDue"]}),
        ("an invoice that is not open", {**ayRec, "allocations": [{"docId": "nosuchinvoice", "amount": 5}]},
         {"allocations.0.docId": ["notOpen"]}),
        ("the same invoice twice", {**ayRec, "allocations": [{"docId": ayInv["id"], "amount": 5},
                                                             {"docId": ayInv["id"], "amount": 5}]},
         {"allocations.1.docId": ["duplicate"]}),
        ("no reference on a transfer", {k: v for k, v in ayRec.items() if k != "reference"},
         {"reference": ["required"]})]:
        if ayBad is None:
            continue
        ayR = arif.post(f"{BASE}/accounting/receipts", json=ayBad)
        ayWant = ayWant or {"date": ["dateClosed"]}
        check(ayR.status_code == 422 and all(ayR.json().get("errors", {}).get(k) == v for k, v in ayWant.items()),
              f"R5.6: {ayWhy} is refused with the mock's own 422 ({json.dumps(ayR.json().get('errors'))[:70]})")

    ayApp = arif.patch(f"{BASE}/accounting/receipts/{aym.get('id')}", json={"process": "Approved"})
    ayAp = ayApp.json() if ayApp.status_code == 200 else {}
    ayPaid1 = float(psql(f"select paid from sales where id = '{ayInv['id']}'")) if DB_URL else None
    check(ayApp.status_code == 200 and ayAp.get("process") == "Approved"
          and [h["action"] for h in ayAp.get("history", [])] == ["created", "approved"],
          f"R5.6: approving the receipt is what settles the invoice ({ayApp.status_code})")
    if DB_URL:
        check(ayPaid1 == jr2(ayPaid0 + 500)
              and psql(f"select due = net_total - paid from sales where id = '{ayInv['id']}'") == "t",
              f"R5.6: …the settlement wrote the invoice's own row with it (paid {ayPaid0} → {ayPaid1}, and due "
              f"follows) — the money document and the invoice register move together")
        check(psql(f"select count(*) from money_docs where id = '{aym.get('id')}' and process = 'Approved'") == "1"
              and psql(f"select trim_scale(allocated) from money_docs where id = '{aym.get('id')}'") == "500",
              "R5.6: …and the approval is on the money document's row too")
    ayOpen1 = [o for o in arif.get(f"{BASE}/accounting/open-invoices",
                                   params={"kind": "receipt", "party": ayParty["id"]}).json()
               if o["id"] == ayInv["id"]]
    check(bool(ayOpen1) and ayOpen1[0]["due"] == jr2(ayDue0 - 500)
          and ayOpen1[0]["paid"] == jr2(ayInv["paid"] + 500),
          f"R5.6: …so what is still open is what is left ({ayDue0} → {ayOpen1[0]['due'] if ayOpen1 else '?'})")
    ayStmt = arif.get(f"{BASE}/accounting/statement", params={"kind": "customer", "party": ayParty["id"]}).json()
    check(ayStmt["reconciled"] and any(r.get("ref") == aym.get("no") for r in ayStmt["rows"]),
          f"R5.6: the customer's statement carries the receipt and still reconciles ({aym.get('no')})")
    ayCancel = arif.patch(f"{BASE}/accounting/receipts/{aym.get('id')}",
                          json={"process": "Cancelled", "reason": f"R5.6 cancelled {TAG}"})
    ayPaid2 = float(psql(f"select paid from sales where id = '{ayInv['id']}'")) if DB_URL else None
    check(ayCancel.status_code == 200 and ayCancel.json().get("process") == "Cancelled"
          and (not DB_URL or ayPaid2 == ayPaid0),
          f"R5.6: cancelling it gives the settlement back — the invoice is as open as it was "
          f"({ayPaid1} → {ayPaid2})")
    check(arif.patch(f"{BASE}/accounting/receipts/{aym.get('id')}",
                     json={"process": "Cancelled", "reason": f"R5.6 cancelled {TAG}"}).status_code == 409,
          "R5.6: …and a cancelled receipt is not cancelled twice")

    # a payment, on the other side of the ledger
    ayVend = None
    for ayCand in ay_parties("vendors")[:14]:
        ayOpenV = arif.get(f"{BASE}/accounting/open-invoices", params={"kind": "payment", "party": ayCand["id"]}).json()
        if ayOpenV and ayOpenV[0]["due"] >= 100:
            ayVend, ayInvV = ayCand, ayOpenV[0]
            break
    if ayVend is None:
        skipped("a payment against an open purchase (no supplier with one left)")
    else:
        ayPaidV0 = float(psql(f"select paid from purchases where id = '{ayInvV['id']}'")) if DB_URL else None
        ayPay = {"partyId": ayVend["id"], "date": ayDate, "method": "bankTransfer", "accountId": ayBank,
                 "amount": 250, "reference": f"R5.6 {TAG}", "allocations": [{"docId": ayInvV["id"], "amount": 250}],
                 "process": "Approved"}
        ayPayR = arif.post(f"{BASE}/accounting/payments", json=ayPay)
        ayP = ayPayR.json() if ayPayR.status_code == 201 else {}
        check(ayPayR.status_code == 201 and str(ayP.get("no", "")).startswith("PV-")
              and (not DB_URL or float(psql(f"select paid from purchases where id = '{ayInvV['id']}'")) == jr2(ayPaidV0 + 250)),
              f"native (R5.6): a payment approved at once settles the purchase the same way ({ayPayR.status_code} "
              f"{ayP.get('no')})")
        ayPayCancel = arif.patch(f"{BASE}/accounting/payments/{ayP.get('id')}", json={"process": "Cancelled", "reason": f"R5.6 cancelled {TAG}"})
        check(ayPayCancel.status_code == 200
              and (not DB_URL or float(psql(f"select paid from purchases where id = '{ayInvV['id']}'")) == ayPaidV0),
              "R5.6: …and cancelling it puts the purchase's counters back")

    # the register itself, and the drafts it deletes
    ayRecPage = arif.get(f"{BASE}/accounting/receipts", params={"size": 100}).json()
    check(ayRecPage["total"] >= 1 and set(ayRecPage["facets"]) == {"process", "method", "party", "account"}
          and set(ayRecPage["facetLabels"]) == {"party", "account"}
          and all(ayRecPage["facets"]["process"].get(p, 0) >= 0 for p in ("Created", "Approved", "Cancelled")),
          f"native (R5.6): the register answers its four facets and labels them ({ayRecPage['total']} receipts)")
    ayFiltered = arif.get(f"{BASE}/accounting/receipts", params={"invoice": ayInv["id"], "size": 100}).json()
    check(all(any(a["docId"] == ayInv["id"] for a in m["allocations"]) for m in ayFiltered["data"])
          and ayFiltered["total"] <= ayRecPage["total"],
          f"R5.6: ?invoice= keeps the receipts that settle one ({ayFiltered['total']} of them)")
    ayCsvR = arif.get(f"{BASE}/accounting/receipts", params={"format": "csv"})
    check(ayCsvR.status_code == 200 and ayCsvR.headers.get("content-disposition", "").startswith("attachment; filename=\"receipts-")
          and "Invoices" in ayCsvR.text.splitlines()[0].lstrip("\ufeff"),
          "R5.6: the CSV export names the invoices each receipt settled")
    ayGone = arif.post(f"{BASE}/accounting/receipts", json={**ayRec, "amount": 50,
                                                            "allocations": [{"docId": ayInv["id"], "amount": 50}]})
    ayg = ayGone.json() if ayGone.status_code == 201 else {}
    check(ayGone.status_code == 201 and arif.delete(f"{BASE}/accounting/receipts/{ayg.get('id')}").status_code == 200
          and arif.get(f"{BASE}/accounting/receipts/{ayg.get('id')}").status_code == 404,
          "R5.6: deleting a draft answers {ok: true} and takes it out of the register")
    if DB_URL:
        check(psql(f"select count(*) from money_docs where id = '{ayg.get('id')}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from money_allocations where doc_id = '{ayg.get('id')}'") == "1",
              "R5.6: …the row is stamped rather than removed, and keeps the invoice it settled")
        ayAgain = arif.post(f"{BASE}/accounting/receipts", json={**ayRec, "amount": 50,
                                                                 "allocations": [{"docId": ayInv["id"], "amount": 50}]})
        ayag = ayAgain.json() if ayAgain.status_code == 201 else {}
        check(ayAgain.status_code == 201 and ayag.get("id") != ayg.get("id") and ayag.get("no") != ayg.get("no"),
              f"R5.6: …so the next receipt takes a new id and a new number ({ayg.get('id')} {ayg.get('no')} → "
              f"{ayag.get('id')} {ayag.get('no')})")
        arif.delete(f"{BASE}/accounting/receipts/{ayag.get('id')}")
        ayDupNo = subprocess.run(["psql", DB_URL, "-c",
                                  "insert into money_docs (id, no, kind, date, party_id, party_name, party_bin, method,"
                                  " account_id, account_name, amount, charge, allocated, unallocated, process, issued_by,"
                                  f" created_at) select 'dupm{TAG}', no, kind, date, party_id, party_name, party_bin,"
                                  " method, account_id, account_name, amount, charge, allocated, unallocated, process,"
                                  " issued_by, created_at from money_docs where deleted_at is null limit 1"],
                                 capture_output=True, text=True)
        check(ayDupNo.returncode != 0, "R5.6: the database refuses a duplicate number (unique index), not just the API")

    ayCfg1 = admin.put(f"{BASE}/accounting/config", json={"closedUpTo": ayCfg0.get("closedUpTo"),
                                                          "allowAdvance": not ayCfg0.get("allowAdvance", True),
                                                          "autoAllocate": ayCfg0.get("autoAllocate", True)})
    check(ayCfg1.status_code == 200 and ayCfg1.json().get("allowAdvance") != ayCfg0.get("allowAdvance", True)
          and ayCfg1.json().get("updatedBy")
          and (not DB_URL or psql("select count(*) from accounting_config") == "1"),
          f"native (R5.6): the configuration is one row and an administrator's PUT replaces it "
          f"({ayCfg1.status_code})")
    check(pdOp.put(f"{BASE}/accounting/config", json={"allowAdvance": True, "autoAllocate": True}).status_code == 403,
          "R5.6: closing or opening the books needs settings.manage")
    ayCfgBad = admin.put(f"{BASE}/accounting/config", json={"closedUpTo": "2030-01-01", "allowAdvance": True, "autoAllocate": True})
    check(ayCfgBad.status_code == 422 and ayCfgBad.json().get("errors", {}).get("closedUpTo") == ["future"],
          "R5.6: the books cannot be closed up to a date in the future")
    admin.put(f"{BASE}/accounting/config", json={"closedUpTo": ayCfg0.get("closedUpTo"),
                                                 "allowAdvance": ayCfg0.get("allowAdvance", True),
                                                 "autoAllocate": ayCfg0.get("autoAllocate", True)})
    # an account the receipts went through cannot be deleted — only deactivated — while one nothing quotes can
    ayRefused = arif.delete(f"{BASE}/accounting/accounts/{ayn.get('id')}")
    check(ayRefused.status_code == 409
          and ayRefused.json()["title"] == f"{ayn.get('provider')} · {ayn.get('accountNo')} has transactions — deactivate it instead.",
          f"R5.6: an account that has been used refuses deletion ({ayRefused.status_code}) and says to deactivate it")
    ayOff = arif.put(f"{BASE}/accounting/accounts/{ayn.get('id')}", json={**ayBody, "active": False})
    check(ayOff.status_code == 200 and ayOff.json().get("active") is False
          and arif.get(f"{BASE}/accounting/accounts", params={"status": "inactive", "size": 100}).json()["total"] >= 1,
          "R5.6: …and deactivating it takes it out of the active facet")
    ayFree = arif.post(f"{BASE}/accounting/accounts",
                       json={**ayBody, "provider": f"R5.6 Unused {TAG}", "accountNo": f"99{TAG}"})
    ayf = ayFree.json() if ayFree.status_code == 201 else {}
    check(ayFree.status_code == 201 and arif.delete(f"{BASE}/accounting/accounts/{ayf.get('id')}").status_code == 200
          and arif.get(f"{BASE}/accounting/accounts/{ayf.get('id')}").status_code == 404,
          "R5.6: an account nothing quotes is deleted")


    # ── R5.6: the NBR VAT documents that are not invoices ────────────────────────────────────────────────────
    print("R5.6: treasury deposits, VDS certificates and VAT adjustments are rows")
    admin = session("admin")
    # the demo company's clock says 2026-09-25, so 2026-09 is the current tax period: the last one whose Mushak 9.1
    # return has not been submitted, and the only one a new document may be dated into
    vdPeriod, vdDate = "2026-09", "2026-09-20"

    vdTreasury = arif.get(f"{BASE}/vat/treasury", params={"size": 100}).json()
    vdVds = arif.get(f"{BASE}/vat/vds", params={"size": 100}).json()
    vdAdj = arif.get(f"{BASE}/vat/adjustments", params={"size": 100}).json()
    check(vdTreasury["total"] >= 10 and set(vdTreasury["facets"]) == {"process", "head", "period", "mode"}
          and all(vdTreasury["facets"]["head"].get(h, 0) >= 0 for h in ("vat", "vds", "sd")),
          f"native (R5.6): the treasury register answers with its facets ({vdTreasury['total']} deposits)")
    check(vdVds["total"] >= 50 and set(vdVds["facets"]) == {"process", "mode", "party", "period"}
          and set(vdVds["facetLabels"]) == {"party"}
          and all(vdVds["facets"]["mode"].get(m, 0) >= 0 for m in ("purchase", "sales")),
          f"native (R5.6): the VDS register answers with its facets and names the parties ({vdVds['total']} entries)")
    check(vdAdj["total"] >= 5 and set(vdAdj["facets"]) == {"process", "kind", "period"},
          f"native (R5.6): the adjustment register answers with its facets ({vdAdj['total']} adjustments)")
    if DB_URL:
        check(psql("select count(*) from treasury_deposits where deleted_at is null") == str(vdTreasury["total"])
              and psql("select count(*) from vds_entries where deleted_at is null") == str(vdVds["total"])
              and psql("select count(*) from vat_adjustments where deleted_at is null") == str(vdAdj["total"]),
              "R5.6: …and every one of them is a row in its own table")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "R5.6: …and no longer inside the compat snapshot")
    check(arif.get(f"{BASE}/vat/treasury", params={"format": "csv"}).text.splitlines()[0].lstrip("﻿").startswith("Challan date")
          and arif.get(f"{BASE}/vat/vds", params={"format": "csv"}).headers.get("content-disposition", "").startswith('attachment; filename="vds-')
          and "9.1 note" in arif.get(f"{BASE}/vat/adjustments", params={"format": "csv"}).text.splitlines()[0],
          "R5.6: the three registers print their own CSV")
    check(arif.get(f"{BASE}/vat/vds/eligible", params={"mode": "sales"}).status_code == 200
          and arif.get(f"{BASE}/vat/vds/eligible", params={"mode": "purchase"}).status_code == 200,
          "R5.6: the invoices a certificate may still be written against are read from the tables")

    # a treasury deposit: created, approved, and refused when the account it leaves from cannot cover it
    vdBank = min([a for a in arif.get(f"{BASE}/accounting/accounts", params={"size": 100}).json()["data"]
                  if a["kind"] == "bank" and a["active"]], key=lambda a: a["balance"])
    vdTBody = {"head": "vat", "taxPeriod": vdPeriod, "challanNo": f"R56-{TAG}-1", "challanDate": vdDate,
               "mode": "online", "bank": "Sonali Bank", "bankBranch": "Motijheel", "district": "Dhaka",
               "amount": 12500, "depositor": "Kanchanjhara Apparel", "address": "Gulshan",
               "description": f"R5.6 deposit {TAG}", "process": "Created"}
    vdT0 = arif.post(f"{BASE}/vat/treasury", json=vdTBody)
    vdT = vdT0.json() if vdT0.status_code == 201 else {}
    check(vdT0.status_code == 201 and vdT.get("no", "").startswith("TC-")
          and vdT.get("process") == "Created" and vdT.get("history", [{}])[0].get("action") == "created",
          f"native (R5.6): a treasury deposit is created and numbered ({vdT0.status_code} {vdT.get('no')})")
    if DB_URL:
        check(psql(f"select count(*) from treasury_deposits where id = '{vdT.get('id')}' and deleted_at is null") == "1"
              and psql(f"select trim_scale(amount) from treasury_deposits where id = '{vdT.get('id')}'") == "12500",
              "R5.6: …and it is a row in treasury_deposits, with the economic code its head takes")
        check(psql(f"select code from treasury_deposits where id = '{vdT.get('id')}'")
              == psql(f"select code from treasury_deposits where head = 'vat' and id <> '{vdT.get('id')}' limit 1"),
              "R5.6: …the code is the head's, in the company's zone")
    check(arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-1"}).status_code == 422
          and arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-2", "challanDate": "2099-01-01"}).status_code == 422
          and arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-2", "taxPeriod": "2099-01"}).status_code == 422,
          "R5.6: a challan number twice, a challan in the future and a period outside the returns are refused")
    check(arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-2", "taxPeriod": "2026-08"}).json()
          .get("errors", {}).get("taxPeriod") == ["periodLocked"],
          "R5.6: a deposit in a period whose Mushak 9.1 was submitted is refused with the mock's own 422")
    vdPoor = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-3", "amount": 50000000,
                                                    "accountId": vdBank["id"], "process": "Approved"})
    check(vdPoor.status_code == 409 and vdPoor.json().get("title", "").startswith("Not enough balance in"),
          f"R5.6: approving one an account cannot cover is refused ({vdPoor.status_code})")
    check(arif.patch(f"{BASE}/vat/treasury/{vdT.get('id')}", json={"process": "Approved"}).status_code == 200
          and arif.get(f"{BASE}/vat/treasury/{vdT.get('id')}").json().get("process") == "Approved",
          f"R5.6: a deposit is approved ({vdT.get('no')})")
    if DB_URL:
        check(psql(f"select count(*) from audit_events where entity = 'treasury' and entity_id = '{vdT.get('id')}'") == "2",
              "R5.6: …and its creation and its approval are events in audit_events")
    check(arif.put(f"{BASE}/vat/treasury/{vdT.get('id')}", json={**vdTBody, "amount": 9000}).status_code == 409
          and arif.delete(f"{BASE}/vat/treasury/{vdT.get('id')}").status_code == 409,
          "R5.6: an approved deposit can neither be edited nor deleted")
    vdCancel = arif.patch(f"{BASE}/vat/treasury/{vdT.get('id')}", json={"process": "Cancelled", "reason": f"R5.6 {TAG}"})
    check(vdCancel.status_code == 200 and vdCancel.json().get("process") == "Cancelled"
          and vdCancel.json().get("cancelReason") == f"R5.6 {TAG}"
          and arif.patch(f"{BASE}/vat/treasury/{vdT.get('id')}", json={"process": "Cancelled", "reason": f"R5.6 {TAG}"}).status_code == 409,
          "R5.6: cancelling needs a reason, is recorded on the row, and does not happen twice")
    if DB_URL:
        check(psql(f"select cancel_reason from treasury_deposits where id = '{vdT.get('id')}'") == f"R5.6 {TAG}"
              and psql(f"select count(*) from treasury_deposits where id = '{vdT.get('id')}' and deleted_at is null") == "1",
              "R5.6: …the cancelled row is the one the register reads")

    # a VDS certificate: written against an approved invoice, and settling part of what that invoice is due.
    # The demo's own invoices may have had their VAT withheld already — CI runs the whole browser suite before
    # this one — so these checks buy their own: a service purchase carries the VAT and moves no stock.
    vdPur = arif.post(f"{BASE}/purchases", json={**pur_body, "issueDate": vdDate, "challanDate": vdDate,
                                                 "challanNo": f"VDS{TAG}", "process": "Approved",
                                                 "category": "service",
                                                 "lines": [{"itemId": sv["id"], "qty": 1, "price": 5000,
                                                            "sdRate": 0, "vatRate": 10, "vds": True}]})
    vdPool = [e for e in arif.get(f"{BASE}/vat/vds/eligible", params={"mode": "purchase"}).json()
              if e["id"] == vdPur.json().get("id") and e["remaining"] >= 100]
    vdPick = vdPool[0] if vdPool else None
    check(vdPick is not None,
          f"R5.6: a purchase is left with VAT to withhold ({vdPur.status_code} {vdPur.json().get('invoiceNo')})")
    if vdPick:
        vdBody = {"mode": "purchase", "docId": vdPick["id"], "amount": 100, "certificateNo": f"R56-{TAG}",
                  "certificateDate": vdDate, "remark": f"R5.6 {TAG}", "process": "Created"}
        vdV0 = arif.post(f"{BASE}/vat/vds", json=vdBody)
        vdV = vdV0.json() if vdV0.status_code == 201 else {}
        check(vdV0.status_code == 201 and vdV.get("docNo") == vdPick["no"] and vdV.get("docVat") == vdPick["vat"]
              and vdV.get("partyName") and vdV.get("taxPeriod") == vdPeriod,
              f"native (R5.6): a certificate is written against the invoice ({vdV0.status_code} {vdV.get('no')} on {vdV.get('docNo')})")
        check(arif.post(f"{BASE}/vat/vds", json={**vdBody, "amount": vdPick["remaining"] + 5000}).json()
              .get("errors", {}).get("amount") == ["exceedsVds"],
              "R5.6: more than the VAT the invoice has left to withhold is refused")
        check(arif.post(f"{BASE}/vat/vds", json={**vdBody, "certificateDate": "2000-01-01"}).json()
              .get("errors", {}).get("certificateDate") == ["beforeInvoice"],
              "R5.6: a certificate dated before its own invoice is refused")
        check(arif.post(f"{BASE}/vat/vds", json={**vdBody, "treasuryId": "tc9999"}).json()
              .get("errors", {}).get("treasuryId") == ["unknown"],
              "R5.6: a challan that is not a VDS challan is refused")
        vdPaid0 = float(psql(f"select paid from purchases where id = '{vdPick['id']}'")) if DB_URL else None
        check(arif.patch(f"{BASE}/vat/vds/{vdV.get('id')}", json={"process": "Approved"}).status_code == 200,
              f"R5.6: approving the certificate settles part of the invoice ({vdV.get('no')})")
        if DB_URL:
            check(psql(f"select trim_scale(settled) from vds_entries where id = '{vdV.get('id')}'") == "100"
                  and float(psql(f"select paid from purchases where id = '{vdPick['id']}'")) == jr2(vdPaid0 + 100)
                  and float(psql(f"select due from purchases where id = '{vdPick['id']}'"))
                  == jr2(float(psql(f"select net_total from purchases where id = '{vdPick['id']}'")) - jr2(vdPaid0 + 100)),
                  f"R5.6: …and the settlement is written on the purchase row with it (paid {vdPaid0} → {jr2(vdPaid0 + 100)})")
            check(psql(f"select count(*) from audit_events where entity = 'vds' and entity_id = '{vdV.get('id')}'") == "2",
                  "R5.6: …and the certificate's creation and approval are events in audit_events")
        check(arif.patch(f"{BASE}/vat/vds/{vdV.get('id')}", json={"process": "Cancelled", "reason": f"R5.6 {TAG}"}).status_code == 200,
              "R5.6: cancelling the certificate gives the settlement back")
        # its own case: a challan in a period that is not locked, under the VDS head, quoted by a live certificate
        vdQuoted0 = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "head": "vds", "challanNo": f"R56-{TAG}-q",
                                                           "process": "Approved"})
        vdQuoted = vdQuoted0.json() if vdQuoted0.status_code == 201 else {}
        vdQuote = arif.post(f"{BASE}/vat/vds", json={"mode": "purchase", "docId": vdPick["id"] if vdPick else "",
                                                     "amount": 50, "certificateNo": f"R56-{TAG}-q",
                                                     "certificateDate": vdDate, "treasuryId": vdQuoted.get("id"),
                                                     "process": "Created"}) if vdQuoted.get("id") and vdPick else None
        vdBlocked = (arif.patch(f"{BASE}/vat/treasury/{vdQuoted.get('id')}",
                                json={"process": "Cancelled", "reason": f"R5.6 {TAG}"})
                     if vdQuote is not None and vdQuote.status_code == 201 else None)
        check(vdBlocked is not None and vdBlocked.status_code == 409
              and "quote this challan" in vdBlocked.json().get("title", ""),
              f"R5.6: a challan a VDS certificate still quotes cannot be cancelled "
              f"({vdQuoted.get('no')} → {vdBlocked.status_code if vdBlocked is not None else 'no case'})")
        if vdQuote is not None and vdQuote.status_code == 201:
            arif.delete(f"{BASE}/vat/vds/{vdQuote.json()['id']}")
            check(arif.patch(f"{BASE}/vat/treasury/{vdQuoted.get('id')}",
                             json={"process": "Cancelled", "reason": f"R5.6 {TAG}"}).status_code == 200,
                  "R5.6: …once the certificate is gone, the challan can be")

        if DB_URL:
            check(float(psql(f"select paid from purchases where id = '{vdPick['id']}'")) == vdPaid0
                  and psql(f"select trim_scale(coalesce(settled, 0)) from vds_entries where id = '{vdV.get('id')}'") == "0",
              "R5.6: …the purchase's own row is exactly as open as it was")

    # a VAT adjustment: the 9.1 note no book can derive
    vdABody = {"kind": "otherIncrease", "issueDate": "2026-09-18", "taxPeriod": vdPeriod, "amount": 5000,
               "description": f"R5.6 adjustment {TAG}", "reference": f"R56-{TAG}", "process": "Created"}
    vdA0 = arif.post(f"{BASE}/vat/adjustments", json=vdABody)
    vdA = vdA0.json() if vdA0.status_code == 201 else {}
    check(vdA0.status_code == 201 and vdA.get("note") == 27 and vdA.get("no", "").startswith("VA-"),
          f"native (R5.6): an adjustment is created and lands in its 9.1 note ({vdA0.status_code} {vdA.get('no')} → note {vdA.get('note')})")
    check(arif.post(f"{BASE}/vat/adjustments", json={**vdABody, "issueDate": "2099-01-01"}).json()
          .get("errors", {}).get("issueDate") == ["future"]
          and arif.post(f"{BASE}/vat/adjustments", json={**vdABody, "kind": "sdExport"}).json()
          .get("errors", {}).get("purchaseId") == ["required"],
          "R5.6: a date in the future is refused, and a claim for SD on exported inputs needs its purchase line")
    if DB_URL:
        check(psql(f"select note from vat_adjustments where id = '{vdA.get('id')}'") == "27"
              and psql(f"select count(*) from vat_adjustments where id = '{vdA.get('id')}' and deleted_at is null") == "1",
              "R5.6: …and it is a row in vat_adjustments")
    check(arif.patch(f"{BASE}/vat/adjustments/{vdA.get('id')}", json={"process": "Approved"}).status_code == 200
          and arif.get(f"{BASE}/vat/adjustments/{vdA.get('id')}").json().get("process") == "Approved",
          "R5.6: an adjustment is approved — nothing moves but its own state")
    check(arif.patch(f"{BASE}/vat/adjustments/{vdA.get('id')}", json={"process": "Cancelled", "reason": f"R5.6 {TAG}"}).status_code == 200,
          "R5.6: …and cancelled with a reason")

    # drafts: deleted, stamped, and never replaced
    vdGone = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-9"})
    vdg = vdGone.json() if vdGone.status_code == 201 else {}
    check(vdGone.status_code == 201 and arif.delete(f"{BASE}/vat/treasury/{vdg.get('id')}").status_code == 200
          and arif.get(f"{BASE}/vat/treasury/{vdg.get('id')}").status_code == 404,
          f"R5.6: deleting a draft answers {{ok: true}} and takes it out of the register ({vdg.get('no')})")
    if DB_URL:
        check(psql(f"select count(*) from treasury_deposits where id = '{vdg.get('id')}' and deleted_at is not null") == "1",
              "R5.6: …the row is stamped rather than removed, so its id and its number stay retired")
        vdAgain = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-9"})
        vda = vdAgain.json() if vdAgain.status_code == 201 else {}
        check(vdAgain.status_code == 201 and vda.get("id") != vdg.get("id") and vda.get("no") != vdg.get("no"),
              f"R5.6: …so the next deposit takes a new id and a new number ({vdg.get('id')} {vdg.get('no')} → {vda.get('id')} {vda.get('no')})")
        arif.delete(f"{BASE}/vat/treasury/{vda.get('id')}")
        vdDupNo = subprocess.run(["psql", DB_URL, "-c",
                                  "insert into treasury_deposits (id, no, head, code, tax_period, challan_no,"
                                  " challan_date, mode, bank, bank_branch, district, amount, depositor, address,"
                                  " description, process, created_at) select 'dupT" + TAG + "', no, head, code,"
                                  " tax_period, challan_no, challan_date, mode, bank, bank_branch, district, amount,"
                                  " depositor, address, description, process, created_at from treasury_deposits"
                                  " where deleted_at is null limit 1"], capture_output=True, text=True)
        check(vdDupNo.returncode != 0, "R5.6: the database refuses a duplicate challan number (unique index), not just the API")
        vdDupVds = subprocess.run(["psql", DB_URL, "-c",
                                   "insert into vds_entries (id, no, mode, doc_id, doc_no, challan_no, doc_date,"
                                   " party_id, party_name, party_bin, party_address, doc_value, doc_vat, amount,"
                                   " certificate_date, tax_period, process, issued_by, created_at) select 'dupV" + TAG + "',"
                                   " no, mode, doc_id, doc_no, challan_no, doc_date, party_id, party_name, party_bin,"
                                   " party_address, doc_value, doc_vat, amount, certificate_date, tax_period, process,"
                                   " issued_by, created_at from vds_entries where deleted_at is null limit 1"],
                                  capture_output=True, text=True)
        check(vdDupVds.returncode != 0, "R5.6: …and a duplicate certificate number, the same way")
    check(session("kamal").patch(f"{BASE}/vat/treasury/{vdT.get('id')}", json={"process": "Approved"}).status_code == 403
          and session("kamal").get(f"{BASE}/vat/treasury", params={"size": 2}).status_code == 200,
          "R5.6: approving needs doc.approve, and the register needs a session")
    check(requests.get(f"{BASE}/vat/treasury").status_code == 401, "R5.6: …and a session is what the register answers to")

    # R6.2: the exporters' Utilization Declarations are rows
    print("R6.2: the UD / UP register is served from the tables")
    udToday = tdate  # the fit question is asked for an invoice dated today
    udReg = arif.get(f"{BASE}/vat/uds").json()
    udRows = udReg.get("rows", [])
    udLines = sum(len(r["lines"]) for r in udRows)
    check(len(udRows) >= 3 and set(udReg.get("totals", {})) == {"active", "warn", "over", "expired"}
          and len(udReg.get("bonds", [])) >= 1
          and all(set(r) >= {"id", "no", "state", "usedPct", "daysLeft", "invoices", "bblc", "lines"} for r in udRows),
          f"native (R6.2): the register answers every declaration with its usage and the bond watch-list "
          f"({len(udRows)} declarations, {len(udReg.get('bonds', []))} licences)")
    if DB_URL:
        check(psql("select count(*) from uds where deleted_at is null") == str(len(udRows))
              and psql("select count(*) from ud_lines l join uds u on u.id = l.ud_id where u.deleted_at is null")
              == str(udLines)
              and psql(COMPAT_GONE) == "t",
              f"R6.2: …every one of them is a row in uds with its inputs in ud_lines ({udLines} inputs), "
              f"and none is inside the compat snapshot")
    check(arif.get(f"{BASE}/vat/uds", params={"format": "csv"}).headers.get("content-disposition", "").startswith('attachment; filename="ud-register-')
          and arif.get(f"{BASE}/vat/uds", params={"format": "csv"}).text.splitlines()[0].lstrip("\ufeff").startswith("UD / UP No"),
          "R6.2: the register prints its own CSV")
    check(len(arif.get(f"{BASE}/vat/uds", params={"customer": "c10"}).json().get("rows", [])) >= 3
          and not arif.get(f"{BASE}/vat/uds", params={"customer": "c1"}).json().get("rows"),
          "R6.2: …and one exporter's own declarations, which is what the sales form asks for")
    udOpen = [r for r in udRows if r["id"] == "ud3"][0]
    check(arif.get(f"{BASE}/vat/uds/ud3").json().get("no") == udOpen["no"]
          and len(arif.get(f"{BASE}/vat/uds/ud3").json().get("lines", [])) == len(udOpen["lines"])
          and arif.get(f"{BASE}/vat/uds/nope").status_code == 404,
          "R6.2: one declaration answers with its lines, and an unknown id is 404")

    # the fit question the sales form asks: inside the declaration, over it, and for a number not in the register
    udFitIn = arif.post(f"{BASE}/vat/uds/fit", json={"customerId": "c10", "issueDate": udToday,
                                                    "udNo": udOpen["no"],
                                                    "lines": [{"itemId": udOpen["lines"][0]["itemId"], "qty": 10}]})
    udFitOver = arif.post(f"{BASE}/vat/uds/fit", json={"customerId": "c10", "issueDate": udToday,
                                                       "udNo": udOpen["no"],
                                                       "lines": [{"itemId": udOpen["lines"][0]["itemId"], "qty": 10_000_000}]})
    udFitNone = arif.post(f"{BASE}/vat/uds/fit", json={"customerId": "c10", "issueDate": udToday,
                                                       "udNo": f"NOT-IN-REGISTER-{TAG}", "lines": []})
    check(udFitIn.status_code == 200 and udFitIn.json().get("ok") is True and udFitIn.json().get("udId") == "ud3"
          and not udFitIn.json().get("problems"),
          f"native (R6.2): an invoice inside the declaration fits ({udFitIn.status_code})")
    check(udFitOver.status_code == 200 and udFitOver.json().get("ok") is False
          and udFitOver.json().get("problems") == ["exceeds"],
          "R6.2: …one that takes more than the declaration permits does not")
    check(udFitNone.status_code == 200 and udFitNone.json() is None,
          "R6.2: …and a number the register does not hold answers null, as the mock did")

    # one declaration: created, amended and deleted — the number in capitals, unique per exporter
    udNo = f"BKMEA/UD/2026/R62{TAG}".upper()
    udBody = {"kind": "UD", "no": udNo.lower(), "date": "2026-09-01", "customerId": "c10",
              "masterLcNo": f"EXP-LC-R62-{TAG}", "buyer": "R6.2 BUYER", "expiry": "2027-03-31",
              "note": f"R6.2 {TAG}", "masterLcValue": 100000, "currency": "USD",
              "lines": [{"itemId": "i21", "qty": 500, "value": 2150}, {"itemId": "i20", "qty": 20, "value": 100}]}
    udMade = arif.post(f"{BASE}/vat/uds", json=udBody)
    udU = udMade.json() if udMade.status_code == 201 else {}
    check(udMade.status_code == 201 and udU.get("no") == udNo and udU.get("id", "").startswith("ud")
          and len(udU.get("lines", [])) == 2 and udU.get("status") == "active"
          and udU.get("createdBy") == "Arif Hossain" and [h["action"] for h in udU.get("history", [])] == ["created"],
          f"native (R6.2): a declaration is created with its number in capitals ({udMade.status_code} {udU.get('no')})")
    if DB_URL:
        check(psql(f"select count(*) from uds where id = '{udU.get('id')}' and deleted_at is null") == "1"
              and psql(f"select count(*) from ud_lines where ud_id = '{udU.get('id')}'") == "2"
              and psql(f"select master_lc_value::text from uds where id = '{udU.get('id')}'") == "100000.00",
              "R6.2: …it is a row in uds, its two inputs are rows in ud_lines, and the LC value is a number in SQL")
        check(psql(f"select count(*) from audit_events where entity = 'ud' and entity_id = '{udU.get('id')}' "
                   f"and action = 'created'") == "1",
              "R6.2: …and its creation is an event in audit_events")
    check(arif.post(f"{BASE}/vat/uds", json={**udBody, "no": udNo.lower()}).json().get("errors", {}).get("no") == ["duplicate"],
          "R6.2: the same number for the same exporter is refused with the mock's own 422")
    udDup = subprocess.run(["psql", DB_URL, "-c",
                            f"insert into uds (id, no, date, kind, customer_id, customer_name, customer_bin,"
                            f" master_lc_no, expiry, status, created_by, created_at) select 'dupU{TAG}', no, date,"
                            f" kind, customer_id, customer_name, customer_bin, master_lc_no, expiry, status,"
                            f" created_by, created_at from uds where deleted_at is null limit 1"],
                           capture_output=True, text=True) if DB_URL else None
    check(udDup is None or udDup.returncode != 0,
          "R6.2: …and the database refuses it too — one number per exporter, while the declaration lives")
    check(arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}B", "customerId": "c1"}).json()
          .get("errors", {}).get("customerId") == ["notExporter"],
          "R6.2: a customer that is not an exporter cannot hold one")
    check(arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}C", "lines": [{"itemId": "nope", "qty": 1}]}).json()
          .get("errors", {}).get("lines.0.itemId") == ["unknown"],
          "R6.2: …nor can an input the SKUs do not hold")
    check(arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}D", "expiry": "2026-01-01"}).status_code == 422
          and arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}D", "lines": []}).status_code == 422,
          "R6.2: an expiry before its date and a declaration with no inputs are refused")

    # an edit of the quantities is an amendment (BGMEA/BKMEA certificate), stored with the declaration
    udEdit = arif.put(f"{BASE}/vat/uds/{udU.get('id')}",
                      json={**udBody, "masterLcValue": 120000, "amendReason": "buyer raised the order",
                            "amendDate": "2026-09-20",
                            "lines": [{"itemId": "i21", "qty": 600, "value": 2580}, {"itemId": "i20", "qty": 20, "value": 100}]})
    udE = udEdit.json() if udEdit.status_code == 200 else {}
    check(udEdit.status_code == 200 and [l["qty"] for l in udE.get("lines", [])] == [600, 20]
          and len(udE.get("amendments", [])) == 1 and udE["amendments"][0]["no"] == 1
          and udE["amendments"][0]["reason"] == "buyer raised the order"
          and udE["amendments"][0]["masterLcValueFrom"] == 100000
          and udE["amendments"][0]["masterLcValueTo"] == 120000,
          f"R6.2: raising a quantity is an amendment, and it is stored with the declaration ({udEdit.status_code})")
    if DB_URL:
        check(psql(f"select jsonb_array_length(amendments) from uds where id = '{udU.get('id')}'") == "1"
              and psql(f"select trim_scale(qty) from ud_lines where ud_id = '{udU.get('id')}' and item_id = 'i21'") == "600",
              "R6.2: …the certificate and the new quantity are what the columns hold")
        check(psql(f"select count(*) from audit_events where entity = 'ud' and entity_id = '{udU.get('id')}' "
                   f"and action = 'edited'") == "1",
              "R6.2: …and the edit is an event in audit_events, with the changes it made")

    # the two copies are one: the RMG export register is still compat code and reads the declarations from memory
    udExpBefore = arif.get(f"{BASE}/vat/exports").json()["totals"]["atRisk"]["count"]
    udUsed = [r for r in arif.get(f"{BASE}/vat/uds").json()["rows"] if r["invoices"] > 0][0]
    udBody2 = {k: udUsed.get(k) for k in ("kind", "no", "date", "customerId", "masterLcNo", "expiry")}
    udClosed = arif.put(f"{BASE}/vat/uds/{udUsed['id']}", json={**udBody2, "buyer": udUsed.get("buyer", ""),
        "note": udUsed.get("note", ""), "masterLcValue": udUsed.get("masterLcValue"), "currency": udUsed.get("currency", "USD"),
        "status": "closed", "amendReason": "", "amendDate": "",
        "lines": [{"itemId": l["itemId"], "qty": l["qty"], "value": l.get("value")} for l in udUsed["lines"]]})
    udExports = arif.get(f"{BASE}/vat/exports").json()
    check(udClosed.status_code == 200 and udExports["totals"]["atRisk"]["count"] == udExpBefore + 1
          and "udBalance" in [m for r in udExports["rows"] if r["id"] == "s226" for m in r["missing"]],
          f"R6.2: closing a declaration natively is seen at once by the export register — the four readers included — "
          f"reading the in-memory copy ({udExpBefore} → {udExports['totals']['atRisk']['count']} at risk)")
    arif.put(f"{BASE}/vat/uds/{udUsed['id']}", json={**udBody2, "buyer": udUsed.get("buyer", ""),
        "note": udUsed.get("note", ""), "masterLcValue": udUsed.get("masterLcValue"), "currency": udUsed.get("currency", "USD"),
        "status": "active", "amendReason": "", "amendDate": "",
        "lines": [{"itemId": l["itemId"], "qty": l["qty"], "value": l.get("value")} for l in udUsed["lines"]]})
    check(arif.get(f"{BASE}/vat/exports").json()["totals"]["atRisk"]["count"] == udExpBefore,
          "R6.2: …and reopening it puts the export register back")

    # deleting: only a declaration no invoice has drawn on goes, and its row stays to retire the id
    check(arif.delete(f"{BASE}/vat/uds/{udUsed['id']}").status_code == 409,
          "R6.2: a declaration an invoice has drawn on cannot be deleted (409)")
    udDel = arif.delete(f"{BASE}/vat/uds/{udU.get('id')}")
    check(udDel.status_code == 200 and arif.get(f"{BASE}/vat/uds/{udU.get('id')}").status_code == 404
          and not any(r["no"] == udNo for r in arif.get(f"{BASE}/vat/uds").json()["rows"]),
          f"R6.2: deleting one answers {{ok: true}} and takes it out of the register ({udDel.status_code})")
    if DB_URL:
        check(psql(f"select count(*) from uds where id = '{udU.get('id')}' and deleted_at is not null") == "1",
              "R6.2: …the row is stamped rather than removed, so its id stays retired")
    udAgain = arif.post(f"{BASE}/vat/uds", json=udBody)
    check(udAgain.status_code == 201 and udAgain.json().get("id") != udU.get("id"),
          f"R6.2: …so the next declaration takes a new id ({udU.get('id')} → {udAgain.json().get('id')})")
    if udAgain.status_code == 201:
        arif.delete(f"{BASE}/vat/uds/{udAgain.json()['id']}")
    check(session("auditor").post(f"{BASE}/vat/uds", json=udBody).status_code == 403
          and session("auditor").get(f"{BASE}/vat/uds").status_code == 200,
          "R6.2: writing one needs doc.create, and the register needs a session")
    check(requests.post(f"{BASE}/vat/uds", json=udBody).status_code == 401
          and requests.get(f"{BASE}/vat/uds").status_code == 401,
          "R6.2: …and a session is what both answer to")

    # R6: chain verification endpoint
    v = arif.get(f"{BASE}/audit/verify")
    check(v.status_code == 200 and v.json().get("ok") is True and v.json().get("algorithm") == "SHA-256", f"R6: audit chain verifies ({v.json().get('count') if v.ok else v.status_code} events)")
    check(len(v.json().get("head", "")) == 64 if v.ok else False, "R6: chain head is a SHA-256 hex digest")
    check(session("kamal").get(f"{BASE}/audit/verify").status_code == 403, "R6: operators cannot run the verification (audit.view)")

    # R6.2: VAT officer — time-boxed, read-only, every read logged
    print("R6.2: VAT officer + backups")
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
    check(o.get(f"{BASE}/vat/exports").status_code == 200 and o.get(f"{BASE}/audit", params={"size": 2}).status_code == 200, "R6.2: officer can read (the registers and the audit trail)")
    check(o.post(f"{BASE}/units", json={"code": "ZZ", "name": "x", "decimals": 0}).status_code == 403, "R6.2: officer cannot write")
    # a native endpoint writes the officer's access event without waiting for it (the state lock is not re-entrant,
    # so it cannot be part of the request), while a compat endpoint writes it before it answers — so the trail is
    # read until both are there rather than once
    refs = set()
    for _ in range(40):
        acc = admin.get(f"{BASE}/audit", params={"entity": "access", "size": 50}).json()["data"]
        refs = {e["ref"] for e in acc if e.get("actorId") == off["user"]["id"]}
        if {"/vat/exports", "/audit"} <= refs:
            break
        time.sleep(0.25)
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
    check(d.ok and snap.get("format") == "dizivat-backup/1" and "audit_events" in snap.get("tables", {}) and "compat_state" not in snap.get("tables", {})
              and all("notif_read" in u for u in snap.get("tables", {}).get("users", [])),
              "R6.2: download is a gzip JSON snapshot of the tables — compat_state among them no more; the read ids ride the users' rows")
    check(not any("password_hash" in u for u in snap.get("tables", {}).get("users", [])), "R6.2: password hashes are not in backups")
    check(session("arif").get(f"{BASE}/backups").status_code == 403, "R6.2: backups need settings.manage")
    if DB_URL:
        check(int(psql("select count(*) from backups")) >= 2 and psql(f"select sha256 from backups where id = {bid[2:]}") == bk.json()["sha256"], "R6.2: backups are rows in the backups table")
        dup = subprocess.run(["psql", DB_URL, "-At", "-c", f"insert into backups (kind, slot, by, size, sha256, tables, data) select 'scheduled', slot, 'x', 1, 'x', '{{}}', '\\x00' from backups where kind = 'scheduled' limit 1"], capture_output=True, text=True)
        check(dup.returncode != 0, "R6.2: only one scheduled backup per slot (unique index)")

    # R6.3: RMG demo company, SD on exported inputs + penalty, restore drill into a fresh database
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

    # R6.4: bond consumption register + drawback, bonded import fields persisted in PostgreSQL
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

    # the four readers are native now (the last of the compat table): the bond register's three CSVs, the export
    # register's CSV and filters, the penalty's what-if validations and the SD list's exclude all answer straight
    # from the mirror, with the mock's own rules
    check(all(arif.get(f"{BASE}/vat/bond", params={"format": "csv", "view": v}).status_code == 200
              and arif.get(f"{BASE}/vat/bond", params={"format": "csv", "view": v}).headers.get("content-type", "").startswith("text/csv")
              for v in ("register", "lots", "drawback")),
          "R6: the bond register's three CSVs answer (register, BoE lots, drawback)")
    exCsv = arif.get(f"{BASE}/vat/exports", params={"format": "csv"})
    exDeemed = arif.get(f"{BASE}/vat/exports", params={"kind": "deemed"}).json()
    check(exCsv.status_code == 200 and "Invoice (Mushak 6.3)" in exCsv.text
          and len(exDeemed.get("rows", [])) > 0 and all(r.get("kind") == "deemed" for r in exDeemed.get("rows", []))
          and exDeemed.get("totals", {}).get("direct", {}).get("count", 0) > 0,
          "R6: the export register's CSV answers and its kind filter narrows the rows, the range's totals intact")
    penExp = arif.get(f"{BASE}/vat/penalty").json()
    check(penExp.get("asOf") == "2026-09-25" and len(penExp.get("rows", [])) >= 10
          and arif.get(f"{BASE}/vat/penalty", params={"period": "2019-01"}).status_code == 422
          and arif.get(f"{BASE}/vat/penalty", params={"period": "2026-08", "vat": "-5"}).status_code == 422
          and arif.get(f"{BASE}/vat/penalty", params={"period": "2026-08", "paidOn": "2026-07-01"}).status_code == 422,
          "R6: the penalty exposure answers for every period, and the what-if's 422s are the mock's own")
    sdRows = arif.get(f"{BASE}/vat/sd-eligible").json().get("rows", [])
    sdExcl = next((r.get("id") for r in sdRows if r.get("id")), None)
    check(len(sdRows) >= 1 and (sdExcl is None or arif.get(f"{BASE}/vat/sd-eligible", params={"exclude": sdExcl}).status_code == 200),
          "R6: the SD-eligible list answers with its exclude parameter (the claim being edited)")

    # R6.5: own UD settlement and drawback claims on their own tables, persisted in PostgreSQL
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
    if DB_URL and ud_id:
        check(psql(f"select count(*) from bond_uds where id = '{ud_id}' and settlement is not null"
                   f" and settlement->>'bondRef' = 'CBC/N/{TAG}'") == "1"
              and psql(f"select count(*) from bond_ud_inputs where ud_id = '{ud_id}'") == "1"
              and psql(f"select count(*) from bond_ud_garments where ud_id = '{ud_id}'") == "1",
              "R6.5: …and the settled UD is a row of bond_uds, its input a row of bond_ud_inputs, its garment a row of bond_ud_garments, the settlement frozen with it")
        check(int(psql("select count(*) from bond_uds where settlement is not null")) >= 2
              and psql(f"select count(*) from audit_events where entity = 'bondUd' and action = 'approved' and ref = '{ud_no}'") == "1",
              "R6.5: the seeded settlement and this one are both rows, and the settlement is an audit event")
        dupBu = subprocess.run(["psql", DB_URL, "-At", "-c",
                                f"insert into bond_uds (id, ord, no, kind, issuer, date, expiry, master_lc_no, created_by, created_at) "
                                f"select 'buDup{TAG[:6]}', 999999, no, kind, issuer, date, expiry, master_lc_no, created_by, created_at "
                                f"from bond_uds where id = 'bu1'"], capture_output=True, text=True)
        check(dupBu.returncode != 0, "R6.5: the database refuses a duplicate UD number (unique index), not just the API")
        # an edit that only changes the note: the head rewritten, the line rows replaced with the same lines
        b3 = bu.get("bu3", {})
        if b3:
            ebody = {"kind": b3["kind"], "issuer": b3["issuer"], "no": b3["no"], "date": b3["date"], "expiry": b3["expiry"],
                     "masterLcNo": b3["masterLcNo"], "masterLcValue": b3.get("masterLcValue"), "currency": b3.get("currency", "USD"),
                     "buyer": b3.get("buyer", ""), "note": f"R6.5 note {TAG}",
                     "inputs": [{"itemId": l["itemId"], "qty": l["qty"]} for l in b3["inputs"]],
                     "garments": [{"itemId": g["itemId"], "qty": g["qty"]} for g in b3["garments"]]}
            buEdit = arif.put(f"{BASE}/vat/bond-uds/bu3", json=ebody)
            check(buEdit.status_code == 200 and buEdit.json().get("note") == f"R6.5 note {TAG}"
                  and psql(f"select count(*) from bond_uds where id = 'bu3' and note = 'R6.5 note {TAG}'"
                           f" and history->-1->>'action' = 'edited'") == "1"
                  and psql("select count(*) from bond_ud_inputs where ud_id = 'bu3'") == str(len(b3["inputs"])),
                  f"R6.5: an edit rewrites the head and replaces the line rows ({buEdit.status_code})")
            bondLots = arif.get(f"{BASE}/vat/bond").json().get("lots", [])
            check(any(l.get("udId") for l in bondLots),
                  "R6.5: the bond register (still compat) links its lots to the own UDs the mirror holds")
        buReg = arif.get(f"{BASE}/vat/bond-uds").json()
        check(any(r.get("id") == ud_id and r.get("state") == "settled" for r in buReg.get("rows", []))
              and "settled" in arif.get(f"{BASE}/vat/bond-uds", params={"format": "csv"}).text,
              "R6.5: the register and its CSV read the rows")
    drafts = arif.get(f"{BASE}/vat/drawback-claims", params={"status": "draft"}).json().get("rows", [])
    claim_id = drafts[0]["id"] if drafts else None
    fr = arif.post(f"{BASE}/vat/drawback-claims/{claim_id}/action", json={"action": "file", "date": "2026-09-25", "ref": f"DEDO/N/{TAG}"}) if claim_id else None
    check(fr is not None and fr.status_code == 200 and fr.json().get("status") == "filed", "R6.5: a draft drawback claim is filed with DEDO")
    # …and the claims are rows now. The seven seeded ones sit in `drawback_claims` (two refunded, one sanctioned
    # mid-way, two filed, one rejected, one draft the suites may have filed already — only the terminal statuses
    # are ours to assert), the one just filed beside them with the DEDO reference it was filed under, and the
    # audit trail carries both the seeded journeys and the filing.
    # (the e2e suites run before this one on the CI database and delete the seeded draft — a delete is a
    # stamp, so the seven are counted as rows, stamped or not; the two statuses asserted are terminal)
    check(psql("select count(*) from drawback_claims where id in ('dc1', 'dc2', 'dc3', 'dc4', 'dc5', 'dc6', 'dc7')") == "7"
          and psql("select status from drawback_claims where id = 'dc2'") == "paid"
          and psql("select status from drawback_claims where id = 'dc4'") == "rejected",
          "R6.5: the seeded drawback claims are rows in drawback_claims (two refunded, one rejected)")
    check(claim_id is not None
          and psql(f"select count(*) from drawback_claims where id = '{claim_id}' and status = 'filed' and filed_on = '2026-09-25' and dedo_ref = 'DEDO/N/{TAG}'") == "1",
          "R6.5: the filed claim is a row too, with the DEDO reference it was filed under")
    check(psql("select count(*) from audit_events where entity = 'drawbackClaim' and ref in ('DBK-11250001', 'DBK-04260004')") >= "2"
          and claim_id is not None and psql(f"select count(*) from audit_events where entity = 'drawbackClaim' and ref = (select no from drawback_claims where id = '{claim_id}') and action = 'submitted'") >= "1",
          "R6.5: the audit trail carries the seeded claims and the filing")

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
    # …and the register is rows now. The seeded batches sit in `prc_batches` (three posted, one reversed — the
    # suite's own postings add more, so only these four ids are ours to assert), the batch just posted beside
    # them with the realisation its allocation took, and the audit trail carries both the seeded reversals and
    # the posting (asserted by identity, not by count: every run of this suite leaves its own events behind).
    check(psql("select count(*) from prc_batches where id in ('pb1', 'pb2', 'pb3', 'pb4') and deleted_at is null") == "4"
          and psql("select status from prc_batches where id = 'pb4'") == "reversed"
          and psql("select status from prc_batches where id = 'pb1'") == "posted",
          "R6.6: the seeded PRC batches are rows in prc_batches (three posted, PB-09260004 reversed)")
    check(pb_id is not None
          and psql(f"select count(*) from prc_batches where id = '{pb_id}' and file_name = 'native-{TAG}.csv' and status = 'posted' and invoices = 1") == "1"
          and psql(f"select count(*) from sale_realisations where batch_id = '{pb_id}' and prc_no = '{prc_no}' and fc_amount = 1") == "1",
          "R6.6: the posted batch is a row too, with the realisation its allocation took in sale_realisations")
    check(psql("select count(*) from audit_events where entity = 'prcBatch' and ref like 'PB-05260001 ·%' and action = 'created'") >= "1"
          and psql("select count(*) from audit_events where entity = 'prcBatch' and ref like 'PB-09260004 ·%' and action = 'cancelled'") >= "1"
          and pb_id is not None and psql(f"select count(*) from audit_events where entity = 'prcBatch' and ref = (select no || ' · ' || file_name from prc_batches where id = '{pb_id}') and action = 'imported'") >= "1",
          "R6.6: the audit trail carries the seeded batches and the posting")
    lfs = arif.get(f"{BASE}/vat/late-filings").json()
    check({"lf1", "lf2"} <= {r["id"] for r in lfs.get("rows", [])}, "R6.6: seeded Mushak 9.3 applications served")
    am_id = None
    for per in ("2026-06", "2026-05", "2026-04", "2026-02", "2026-01"):
        r = arif.post(f"{BASE}/vat/return-amendments", json={"period": per, "reasonKind": "clerical", "description": f"Native check {TAG} — transposed digits", "noAudit": True,
                                                            "corrections": [{"note": 1, "field": "value", "to": 1234.56, "explanation": "Transposed digits"}]})
        if r.status_code == 201: am_id = r.json()["id"]; break
    fr = arif.post(f"{BASE}/vat/return-amendments/{am_id}/action", json={"action": "file", "date": "2026-09-25", "ref": f"NBR/N/{TAG}"}) if am_id else None
    check(fr is not None and fr.status_code == 200 and fr.json().get("status") == "filed", "R6.6: a Mushak 9.4 application is created and filed")

    # …and both families are rows now. The seeded applications sit in `late_filings` (one refused, one filed and
    # deemed allowed), the application just filed in `return_amendments` with its reference, and a draft that is
    # deleted is stamped — not removed — so its id retires with it, the way the mock's ever-forward counter had.
    # (the seeded rows are asserted by id, not by count or status: the e2e suites that run before this one in CI
    #  leave their own applications in the same database — they reject the seeded 09-2026 filing and approve one
    #  of their own — so only the rows' identity is ours to assert)
    check(psql("select count(*) from late_filings where id in ('lf1', 'lf2') and deleted_at is null") == "2"
          and psql("select no || ' ' || period from late_filings where id = 'lf1'") == "LF-01260001 2025-12"
          and psql("select no || ' ' || period from late_filings where id = 'lf2'") == "LF-09260002 2026-09",
          "R6.6: the seeded 9.3 applications are rows in late_filings (one refused, one filed for 09-2026)")
    check(am_id is not None and psql(f"select status from return_amendments where id = '{am_id}'") == "filed"
          and psql(f"select filed_ref from return_amendments where id = '{am_id}'") == f"NBR/N/{TAG}",
          "R6.6: the filed 9.4 application is a row too, with the NBR reference it was filed under")
    dd_id = None
    for per in ("2026-05", "2026-02", "2026-01"):
        r = arif.post(f"{BASE}/vat/return-amendments", json={"period": per, "reasonKind": "clerical", "description": f"Native check {TAG} — a draft to delete", "noAudit": True,
                                                             "corrections": [{"note": 1, "field": "value", "to": 999999.99, "explanation": "Draft to delete"}]})
        if r.status_code == 201: dd_id = r.json()["id"]; break
    dd = arif.delete(f"{BASE}/vat/return-amendments/{dd_id}") if dd_id else None
    check(dd is not None and dd.status_code == 200
          and psql(f"select count(*) from return_amendments where id = '{dd_id}' and deleted_at is not null") == "1"
          and all(r.get("id") != dd_id for r in arif.get(f"{BASE}/vat/return-amendments").json().get("rows", [])),
          "R6.6: a deleted 9.4 draft is stamped, not removed — the register no longer lists it, and its id retires with it")
    # the fourth action step files the amended return itself. An increase would need the treasury deposit of the
    # difference + interest; a decrease posts the decreasing adjustment (note 32, s.55 read with s.66) in the period
    # the Commissioner allowed — a row of the adjustments family, written beside the application in one transaction.
    dec_id = None
    for per in ("2026-04", "2026-02", "2026-01"):
        r = arif.post(f"{BASE}/vat/return-amendments", json={"period": per, "reasonKind": "overpaid", "description": f"Native check {TAG} — VAT over-declared on a cancelled challan", "noAudit": True,
                                                             "corrections": [{"note": 4, "field": "vat", "to": 1234.56, "explanation": "Cancelled challan, VAT reversed"}]})
        if r.status_code == 201: dec_id = r.json()["id"]; break
    dec = dec_ref = None
    if dec_id:
        arif.post(f"{BASE}/vat/return-amendments/{dec_id}/action", json={"action": "file", "date": "2026-09-25", "ref": f"CVAT/DEC/{TAG}"})
        dec_ref = f"CVAT/DEC/{TAG}"
        ap = arif.post(f"{BASE}/vat/return-amendments/{dec_id}/action", json={"action": "approve", "date": "2026-09-25", "ref": f"CVAT/AMEND/{TAG}", "adjustPeriod": "2026-09"})
        am_step = arif.post(f"{BASE}/vat/return-amendments/{dec_id}/action", json={"action": "amend", "date": "2026-09-25"})
        dec = am_step.json() if am_step.status_code == 200 else {}
    adj_ids = (dec.get("amended") or {}).get("adjustmentIds") or []
    check(dec.get("status") == "amended" and dec.get("effect", {}).get("direction") == "decrease" and len(adj_ids) >= 1,
          "R6.6: a decreasing 9.4 application is approved and files its amended return")
    check(dec_id is not None and psql(f"select count(*) from return_amendments where id = '{dec_id}' and amended->'adjustmentIds' is not null") == "1"
          and psql(f"select count(*) from vat_adjustments a join return_amendments r on r.id = '{dec_id}' where a.id in (select jsonb_array_elements_text(r.amended->'adjustmentIds')) and a.note = 32 and a.kind = 'otherDecrease' and a.tax_period = '2026-09'") >= "1",
          "R6.6: the decrease posts its decreasing adjustment (note 32) in the allowed period — a row of the adjustments family")
    check(dec_id is not None and psql(f"""select count(*) from audit_events where entity = 'adjustment' and ref in (
                 select a.no from vat_adjustments a where a.id in (
                   select jsonb_array_elements_text(r.amended->'adjustmentIds') from return_amendments r where r.id = '{dec_id}'))""") >= "1",
          "R6.6: …and the audit trail carries the adjustment the application posted")

    # R5.6: the readers — the Mushak books, the dashboard, the ⌘K search, the notifications, the two service-code
    # lists and the bulk import. None of them stores a row of its own: each adds up documents that live in the
    # tables, so the decisive checks are the ones that move a row in SQL alone — the in-memory copies left stale on
    # purpose — and require the answer to have moved with it. What they read through the mirror (the SKUs, the
    # parties, the company) is checked after the restart below, with everything else.
    print("R5.6: the Mushak books, the dashboard, the search, the notifications and the import")
    bk = arif.get(f"{BASE}/mushak/6.1", params={"item": iid}).json()
    check(bk.get("form") == "6.1" and bk.get("item", {}).get("id") == iid and len(bk.get("rows", [])) >= 1,
          "R5.6: the Mushak 6.1 book for one SKU is served from the tables")
    bkcsv = arif.get(f"{BASE}/mushak/6.1", params={"item": iid, "format": "csv"})
    check(bkcsv.status_code == 200 and "text/csv" in bkcsv.headers.get("content-type", "")
          and len(bkcsv.text.strip().splitlines()) == len(bk.get("rows", [])) + 1,
          "R5.6: …and its CSV export carries a header and one line per row")
    m610 = arif.get(f"{BASE}/mushak/6.10").json()
    check(m610.get("limit") == 200_000 and len(m610.get("purchases", [])) >= 1 and len(m610.get("sales", [])) >= 1,
          "R5.6: the Mushak 6.10 register is served too — the purchases and the sales above the ৳2,00,000 limit")
    check(len(arif.get(f"{BASE}/services").json()) == 8 and len(arif.get(f"{BASE}/sale-services").json()) == 6,
          "R5.6: the NBR service codes and the company's own, straight from the bundle")
    if DB_URL:
        counts = lambda d: sum(n.get("values", {}).get("count", 0) for n in d.values() if n.get("kind") == "approvals")
        psql(f"update items set opening = opening + 7 where id = '{iid}'")
        bk2 = arif.get(f"{BASE}/mushak/6.1", params={"item": iid}).json()
        check(round(bk2["closing"]["qty"] - bk["closing"]["qty"], 2) == 7,
              f"…the SKU's opening counter changed in SQL alone moves the book's closing balance — the ledger "
              f"reconciles to the counter, and the counter is a column ({bk['closing']['qty']} → {bk2['closing']['qty']})")
        psql(f"update items set opening = opening - 7 where id = '{iid}'")
        sid = psql("select id from sales where issue_date >= '2026-09-01' and process = 'Approved' and deleted_at is null order by ord limit 1")
        sno = psql(f"select invoice_no from sales where id = '{sid}'")
        k0 = arif.get(f"{BASE}/dashboard").json()["kpis"]["sales"]
        psql(f"update sales set net_total = net_total + 100000 where id = '{sid}'")
        k1 = arif.get(f"{BASE}/dashboard").json()["kpis"]["sales"]
        check(k1 == k0 + 100_000, f"…an invoice's total changed in SQL alone moves the dashboard's KPIs ({k0} → {k1})")
        psql(f"update sales set net_total = net_total - 100000 where id = '{sid}'")
        n0 = {n["id"]: n for n in arif.get(f"{BASE}/notifications").json()["items"]}
        psql(f"update sales set process = 'Created' where id = '{sid}'")
        n1 = {n["id"]: n for n in arif.get(f"{BASE}/notifications").json()["items"]}
        check(counts(n1) == counts(n0) + 1, f"…and the same row left as a draft is one more approval in the notifications ({counts(n0)} → {counts(n1)})")
        psql(f"update sales set process = 'Approved' where id = '{sid}'")
        psql(f"update sales set invoice_no = 'SRCH{TAG[:4]}' where id = '{sid}'")
        check(any(h.get("id") == sid for h in arif.get(f"{BASE}/search", params={"q": f"SRCH{TAG[:4]}"}).json()),
              "…and an invoice's number changed in SQL alone is what the ⌘K search finds it by")
        psql(f"update sales set invoice_no = '{sno}' where id = '{sid}'")

    cust = {"name": f"R5.6 Import {TAG}", "mode": "Local", "bin": "123456789-0123", "mobile": "01711-555012",
            "address": f"House 1, Road 2 — native check {TAG}"}
    # the importer stores a party's name in capitals, and that is what the table and the audit ref carry
    cname = cust["name"].upper()
    imps = int(psql("select count(*) from audit_events where entity = 'import' and action = 'imported'")) if DB_URL else 0
    imp = arif.post(f"{BASE}/import", json={"entity": "customers", "rows": [cust], "dryRun": False})
    check(imp.status_code == 201 and imp.json().get("created") == 1, f"R5.6: the bulk import creates a customer (HTTP {imp.status_code})")
    imp2 = arif.post(f"{BASE}/import", json={"entity": "customers", "rows": [cust], "dryRun": False})
    check(imp2.json().get("duplicates") == 1 and imp2.json().get("created") == 0, "R5.6: …and the same row a second time is a duplicate, not an error")
    bad = arif.post(f"{BASE}/import", json={"entity": "customers", "rows": [dict(cust, bin="1")], "dryRun": False})
    check(bad.json().get("issues") and bad.json().get("created") == 0, "R5.6: …and one bad row refuses the lot (all-or-nothing)")
    if DB_URL:
        check(psql(f"select count(*) from parties where name = '{cname}' and kind = 'customer'") == "1",
              "R5.6: …and the party write-back carries it into the parties table")
        check(psql(f"select count(*) from audit_events where entity = 'customer' and action = 'created' and ref = '{cname}'") == "1"
              and int(psql("select count(*) from audit_events where entity = 'import' and action = 'imported'")) == imps + 1,
              "R5.6: …with one audit event for the party and one for the import itself")

    arif.post(f"{BASE}/notifications/read", json={"all": True})
    check(arif.get(f"{BASE}/notifications").json()["unread"] == 0, "R5.6: marking the notifications read dismisses them")

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
        check(any(u["no"] == ud_body["no"] for u in arif.get(f"{BASE}/vat/uds").json().get("rows", [])),
              "R6.2: the declaration is still there — read from uds, not from the snapshot")
        check(any(x["code"] == f"R5{TAG[:3]}" for x in arif.get(f"{BASE}/units").json()["data"]), "native: unit still there")
        check(arif.get(f"{BASE}/notifications").json()["unread"] == 0, "R5.6: the notifications read before the restart are still read (the user store is in the snapshot)")
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
        dec_after = arif.get(f"{BASE}/vat/return-amendments/{dec_id}").json() if dec_id else {}
        dec_adj = ((dec_after.get("amended") or {}).get("adjustmentIds") or [None])[0]
        check(dec_after.get("status") == "amended" and dec_adj is not None
              and psql(f"select count(*) from vat_adjustments where id = '{dec_adj}' and note = 32 and tax_period = '2026-09' and amount > 0") == "1",
              "R6.6: the amended return and the decreasing adjustment it posted survive a restart")
        rv = arif.post(f"{BASE}/vat/proceeds/batches/{pb_id}/reverse", json={"date": "2026-09-25", "reason": f"Native reversal {TAG}"}) if pb_id else None
        check(rv is not None and rv.status_code == 200 and rv.json().get("status") == "reversed", "R6.6: the batch reverses after a restart")
        check(pb_id is not None
              and psql(f"select count(*) from prc_batches where id = '{pb_id}' and status = 'reversed' and reversed_on = '2026-09-25' and reverse_reason = 'Native reversal {TAG}' and history->-1->>'action' = 'cancelled'") == "1"
              and psql(f"select count(*) from sale_realisations where batch_id = '{pb_id}'") == "0",
              "R6.6: …and the reversal is stamped on the row, its realisations are gone and the history carries the cancellation")
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
            ws = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": time.strftime("%Y-%m-%d"),
                                                      "note": f"R5.3 stale {TAG}", "lines": [{"itemId": iid, "qty": 1}], "process": "Created"})
            check(ws.status_code == 503, f"R5.3: stale instance refuses a native stock-document write (HTTP {ws.status_code})")
            check(psql(f"select count(*) from stock_documents where note like '%R5.3 stale {TAG}%'") == "0",
                  "R5.3: the refused document never reached stock_documents")
            wu = arif.post(f"{BASE}/vat/uds", json={**ud_body, "no": f"BKMEA/UD/2026/SW{TAG}".upper(), "masterLcNo": f"EXP-LC-SW-{TAG}"})
            check(wu.status_code == 503, f"stale instance refuses a native declaration write after a re-seed elsewhere (HTTP {wu.status_code})")
            check(psql(COMPAT_GONE) == "t", "the stale instance has no snapshot to write over the re-seeded data — the table is gone")
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
        ensure_compat_state(); psql(PRE_R52_COLLECTIONS)
        ensure_compat_state(); psql(PRE_R52_TRASH)
        psql("delete from parties")
        psql("delete from items")
        psql("delete from master_items")
        check(counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'customers' and data->'db' ? 'vendors' "
                       "and data->'db' ? 'items' and data->'db' ? 'masterItems'") == "1",
              f"the database is back in the pre-R5.2 shape ({had[0]} parties, {had[2]} SKUs, {had[3]} master items inside the snapshot)")
        restart()
        check(counts() == had, f"the first boot moved every record into the tables (parties {had[0]} incl. {had[1]} deleted, items {had[2]}, master items {had[3]})")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(psql(COMPAT_GONE) == "t", "…and the undo buffer went with the table — the stamped rows are the deleted parties' only copy")
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

        # R5.3: the same upgrade one release later — a database written before the stock documents had tables holds
        # them (lines included) inside compat_state, and the first boot on this code has to move them out without
        # losing a line or a state.
        print("\nR5.3: upgrading a pre-R5.3 database moves the stock documents into their tables")
        stock_counts = lambda: (psql("select count(*) from stock_documents"), psql("select count(*) from stock_document_lines"))
        stock_registers = lambda: {k: arif.get(f"{BASE}/{k}", params={"size": 200}).json() for k in ("transfers", "damage")}
        def stock_boots():
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as f:
                return sum(1 for line in f if "R5.3 upgrade:" in line)
        shad, sbefore, ssplit, sboots = stock_counts(), stock_registers(), held(), stock_boots()
        tlines = psql(f"select count(*) from stock_document_lines where doc_id = '{tid}'")
        ensure_compat_state(); psql(PRE_R53_COLLECTIONS)
        psql("delete from stock_document_lines")
        psql("delete from stock_documents")
        check(stock_counts() == ("0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'transfers' and data->'db' ? 'damages'") == "1",
              f"the database is back in the pre-R5.3 shape ({shad[0]} stock documents, {shad[1]} lines inside the snapshot)")
        restart()
        check(stock_counts() == shad, f"the first boot moved every document into the tables ({shad[0]} documents, {shad[1]} lines)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(stock_registers() == sbefore, "…and serves the same two registers, row for row")
        check(psql(f"select count(*) from stock_documents where id = '{tid}' and process = 'Cancelled'") == "1"
              and psql(f"select count(*) from stock_document_lines where doc_id = '{tid}'") == tlines,
              "a document approved and cancelled before the upgrade kept its state and its lines")
        check(held() == ssplit, "…and the stock derived from them is unchanged — the branch split survived the round trip")
        sboots_after, snow = stock_boots(), stock_counts()
        restart()
        check(stock_counts() == snow and (sboots is None or sboots_after == sboots + 1) and (sboots is None or stock_boots() == sboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        wt = arif.post(f"{BASE}/transfers", json={"fromBranchId": branch, "toBranchId": other, "date": time.strftime("%Y-%m-%d"),
                                                  "lines": [{"itemId": iid, "qty": 1}], "process": "Created"})
        check(wt.status_code == 201 and psql(f"select count(*) from stock_documents where id = '{wt.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({wt.status_code})")

        # … and the invoices, which the same release moved out: a database written before them holds them inside
        # compat_state — lines and proceeds entries included, a draft deleted before the upgrade in the undo buffer.
        print("\nR5.3: upgrading a pre-R5.3 database moves the sales invoices into their tables")
        def sale_counts():
            return (psql("select count(*) from sales"), psql("select count(*) from sale_lines"),
                    psql("select count(*) from sale_realisations"))

        def sale_registers():
            return {"sales": arif.get(f"{BASE}/sales", params={"size": 300, "category": "all"}).json(),
                    "services": arif.get(f"{BASE}/sales", params={"size": 100, "category": "service"}).json(),
                    "customers": arif.get(f"{BASE}/customers", params={"size": 100}).json()}

        gone = arif.post(f"{BASE}/sales", json={**inv_body, "narration": f"R5.3 deleted {TAG}"}).json()
        arif.delete(f"{BASE}/sales/{gone['id']}")
        def sale_shapes():
            return (psql("select count(*) from sales where export_deemed is not null"),
                    psql("select count(*) from sales where category = 'service'"),
                    psql("select count(*) from sale_realisations"))

        scounts, sbefore, ssplit, sboots, sshapes = sale_counts(), sale_registers(), sold_held(), stock_boots(), sale_shapes()
        ensure_compat_state(); psql(PRE_R53_SALES)
        ensure_compat_state(); psql(PRE_R53_SALE_TRASH)
        psql("delete from sale_realisations")
        psql("delete from sale_lines")
        psql("delete from sales")
        check(sale_counts() == ("0", "0", "0") and psql("select count(*) from compat_state where data->'db' ? 'sales'") == "1"
              and psql(SALE_TRASH_LEFT) == "1",
              f"the database is back in the pre-R5.3 shape ({scounts[0]} invoices, {scounts[1]} lines, "
              f"{scounts[2]} proceeds entries inside the snapshot)")
        restart()
        check(sale_counts() == scounts,
              f"the first boot moved every invoice into the tables ({scounts[0]} invoices, {scounts[1]} lines)")
        check(psql(COMPAT_GONE) == "t", "…and dropped the snapshot table with its undo buffer — the rows are the only copy")
        check(sale_registers() == sbefore, "…and serves the same three registers, row for row")
        check(psql(f"select count(*) from sales where id = '{gone['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from sale_lines where sale_id = '{gone['id']}'") == "1",
              "an invoice deleted before the upgrade is still in the undo buffer, with its lines")
        un = arif.post(f"{BASE}/sales/{gone['id']}/restore")
        check(un.status_code == 200 and psql(f"select count(*) from sales where id = '{gone['id']}' and deleted_at is null") == "1",
              f"…and its undo still works afterwards ({un.status_code})")
        check(sale_shapes() == sshapes,
              f"the export headers ({sshapes[0]}), the service sales ({sshapes[1]}) and the proceeds entries "
              f"({sshapes[2]}) came back with their invoices")
        check(sold_held() == ssplit, "…and the stock derived from them is unchanged — the branch split survived the round trip")
        sboots_after, snow = stock_boots(), sale_counts()
        restart()
        check(sale_counts() == snow and (sboots is None or sboots_after == sboots + 1) and (sboots is None or stock_boots() == sboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        ws = arif.post(f"{BASE}/sales", json=inv_body)
        check(ws.status_code == 201 and psql(f"select count(*) from sales where id = '{ws.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({ws.status_code})")
        # … and the purchases, which the same release moved out: a database written before them holds them inside
        # compat_state — lines, Bills of Entry and the duty every import line cleared included, a draft deleted
        # before the upgrade in the undo buffer.
        print("\nR5.3: upgrading a pre-R5.3 database moves the purchases into their tables")
        def purchase_counts():
            return (psql("select count(*) from purchases"), psql("select count(*) from purchase_lines"))

        def purchase_registers():
            return {"purchases": arif.get(f"{BASE}/purchases", params={"size": 300, "category": "all"}).json(),
                    "services": arif.get(f"{BASE}/purchases", params={"size": 100, "category": "service"}).json(),
                    "vendors": arif.get(f"{BASE}/vendors", params={"size": 100}).json()}

        gonep = arif.post(f"{BASE}/purchases", json={**pur_body, "narration": f"R5.3 deleted {TAG}"}).json()
        arif.delete(f"{BASE}/purchases/{gonep['id']}")
        def purchase_shapes():
            return (psql("select count(*) from purchases where boe_no is not null"),
                    psql("select count(*) from purchases where category = 'service'"),
                    psql("select count(*) from purchase_lines where duty_av is not null"),
                    psql("select count(*) from purchase_lines where foregone_total is not null"))

        pcounts, pbefore, psplit, pboots, pshapes = (purchase_counts(), purchase_registers(), held(),
                                                     stock_boots(), purchase_shapes())
        ensure_compat_state(); psql(PRE_R53_PURCHASES)
        ensure_compat_state(); psql(PRE_R53_PURCHASE_TRASH)
        psql("delete from purchase_lines")
        psql("delete from purchases")
        check(purchase_counts() == ("0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'purchases'") == "1"
              and psql(PURCHASE_TRASH_LEFT) == "1",
              f"the database is back in the pre-R5.3 shape ({pcounts[0]} purchases, {pcounts[1]} lines "
              f"inside the snapshot)")
        restart()
        check(purchase_counts() == pcounts,
              f"the first boot moved every purchase into the tables ({pcounts[0]} documents, {pcounts[1]} lines)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table with its undo buffer — the stamped rows are the deleted drafts' only copy")
        check(purchase_registers() == pbefore, "…and serves the same three registers, row for row")
        check(psql(f"select count(*) from purchases where id = '{gonep['id']}' and deleted_at is not null") == "1"
              and psql(f"select count(*) from purchase_lines where purchase_id = '{gonep['id']}'") == "1",
              "a purchase deleted before the upgrade is still in the undo buffer, with its lines")
        unp = arif.post(f"{BASE}/purchases/{gonep['id']}/restore")
        check(unp.status_code == 200
              and psql(f"select count(*) from purchases where id = '{gonep['id']}' and deleted_at is null") == "1",
              f"…and its undo still works afterwards ({unp.status_code})")
        check(purchase_shapes() == pshapes,
              f"the Bills of Entry ({pshapes[0]}), the service purchases ({pshapes[1]}), the duty breakdowns "
              f"({pshapes[2]}) and the bonded entries ({pshapes[3]}) came back with their documents")
        check(held() == psplit, "…and the stock derived from them is unchanged — the branch split survived the round trip")
        pboots_after, pnow = stock_boots(), purchase_counts()
        restart()
        check(purchase_counts() == pnow and (pboots is None or pboots_after == pboots + 1)
              and (pboots is None or stock_boots() == pboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        wp = arif.post(f"{BASE}/purchases", json=pur_body)
        check(wp.status_code == 201 and psql(f"select count(*) from purchases where id = '{wp.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({wp.status_code})")
        # … and the notes, which the same release moved out: a database written before them holds both families
        # inside compat_state. A draft deleted before the upgrade has no place there — the mock removed it for good
        # — so what has to survive the round trip is the id counter, not the row.
        print("\nR5.3: upgrading a pre-R5.3 database moves the credit and debit notes into their tables")
        def note_counts():
            return (psql("select count(*) from notes where kind = 'credit' and deleted_at is null"),
                    psql("select count(*) from notes where kind = 'debit' and deleted_at is null"),
                    psql("select count(*) from note_lines l join notes n on n.id = l.note_id"
                         " where n.deleted_at is null"))

        def note_registers():
            return {"credit": arif.get(f"{BASE}/credit-notes", params={"size": 100}).json(),
                    "debit": arif.get(f"{BASE}/debit-notes", params={"size": 100}).json(),
                    "sales": arif.get(f"{BASE}/sales", params={"size": 300, "category": "all"}).json()}

        goncn = arif.post(f"{BASE}/credit-notes", json={**cn_body, "note": f"R5.3 deleted {TAG}"}).json()
        arif.delete(f"{BASE}/credit-notes/{goncn['id']}")
        ncounts, nbefore, nsplit, nboots = note_counts(), note_registers(), sold_held(), stock_boots()
        ensure_compat_state(); psql(PRE_R53_NOTES)
        psql("delete from note_lines")
        psql("delete from notes")
        check(note_counts() == ("0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'creditNotes'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'debitNotes'") == "1",
              f"the database is back in the pre-R5.3 shape ({ncounts[0]} credit notes, {ncounts[1]} debit notes, "
              f"{ncounts[2]} lines inside the snapshot)")
        restart()
        check(note_counts() == ncounts,
              f"the first boot moved every note into the tables ({ncounts[0]} + {ncounts[1]} notes, {ncounts[2]} lines)")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(note_registers() == nbefore, "…and serves the same registers, row for row")
        check(psql(f"select count(*) from notes where id = '{goncn['id']}'") == "0",
              "a note deleted before the upgrade stays deleted — the mock kept no row for it either")
        after = arif.post(f"{BASE}/credit-notes", json=cn_body).json()
        check(int(after["id"][2:]) > int(goncn["id"][2:]) and after["no"] != goncn["no"],
              f"…but its id and its number stay retired ({goncn['id']} {goncn['no']} → {after['id']} {after['no']})")
        check(sold_held() == nsplit, "…and the stock derived from them is unchanged — the branch split survived the round trip")
        nboots_after, nnow = stock_boots(), note_counts()
        restart()
        check(note_counts() == nnow and (nboots is None or nboots_after == nboots + 1)
              and (nboots is None or stock_boots() == nboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        wn = arif.post(f"{BASE}/debit-notes", json=dn_body)
        check(wn.status_code == 201 and psql(f"select count(*) from notes where id = '{wn.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({wn.status_code})")
        # ── R5.4 ───────────────────────────────────────────────────────────────────────────────────────────────
        # The release after the documents: a database written before the opening entries had a table holds them
        # inside compat_state, the R6.4 bond block of a go-live entry included. A draft deleted before the upgrade
        # has no place there — the mock removed it for good — so what has to survive is the id counter, not the row.
        print("\nR5.4: upgrading a pre-R5.4 database moves the opening stock entries into their table")
        def opening_counts():
            return (psql("select count(*) from opening_entries where deleted_at is null"),
                    psql("select count(*) from opening_entries where bond_boe_no is not null"))

        def opening_registers():
            return {"openings": arif.get(f"{BASE}/opening-stock", params={"size": 200}).json(),
                    "stock": arif.get(f"{BASE}/stock", params={"size": 200}).json(),
                    "items": arif.get(f"{BASE}/items", params={"size": 200}).json()}

        goneo = arif.post(f"{BASE}/opening-stock", json={**os_body, "note": f"R5.4 deleted {TAG}"}).json()
        arif.delete(f"{BASE}/opening-stock/{goneo['id']}")
        def opening_boots():
            """How many boots adopted the opening entries — one `R5.4 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.4 upgrade:")

        ocounts, obefore, osplit, oboots = opening_counts(), opening_registers(), held(), opening_boots()
        ensure_compat_state(); psql(PRE_R54_OPENINGS)
        psql("delete from opening_entries")
        check(opening_counts() == ("0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'openings'") == "1",
              f"the database is back in the pre-R5.4 shape ({ocounts[0]} entries, {ocounts[1]} of them bonded, "
              f"inside the snapshot)")
        restart()
        check(opening_counts() == ocounts, f"the first boot moved every entry into the table ({ocounts[0]} entries)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(opening_registers() == obefore,
              "…and serves the same three registers, row for row — the branch split and the items with them")
        check(psql(f"select count(*) from opening_entries where id = '{goneo['id']}'") == "0",
              "an entry deleted before the upgrade stays deleted — the mock kept no row for it either")
        aftero = arif.post(f"{BASE}/opening-stock", json=os_body).json()
        check(int(aftero["id"][2:]) > int(goneo["id"][2:]) and aftero["no"] != goneo["no"],
              f"…but its id and its number stay retired ({goneo['id']} {goneo['no']} → {aftero['id']} {aftero['no']})")
        check(held() == osplit, "…and the stock derived from them is unchanged")
        oboots_after, onow = opening_boots(), opening_counts()
        restart()
        check(opening_counts() == onow and (oboots is None or oboots_after == oboots + 1)
              and (oboots is None or opening_boots() == oboots_after),
              "a second boot adopts nothing again — the table is the only copy from then on")
        wo = arif.post(f"{BASE}/opening-stock", json=os_body)
        check(wo.status_code == 201 and psql(f"select count(*) from opening_entries where id = '{wo.json().get('id')}'") == "1",
              f"and writes land in the table on the upgraded database ({wo.status_code})")
        # … and the production batches, which the same release moved out: a database written before them holds them
        # inside compat_state, each with the finished goods it produced and the inputs it consumed. A draft deleted
        # before the upgrade has no place there — the mock removed it for good — so what has to survive the round
        # trip is the id counter, not the row.
        print("\nR5.4: upgrading a pre-R5.4 database moves the production batches into their tables")
        def batch_counts():
            return (psql("select count(*) from batches where deleted_at is null"),
                    psql("select count(*) from batch_lines l join batches b on b.id = l.batch_id"
                         " where b.deleted_at is null"),
                    psql("select count(*) from batch_consumption c join batches b on b.id = c.batch_id"
                         " where b.deleted_at is null"),
                    psql("select count(*) from batches where mode = 'contractual' and received_at is not null"))

        def batch_registers():
            return {"batches": arif.get(f"{BASE}/production/batches", params={"size": 200}).json(),
                    "lots": arif.get(f"{BASE}/production/lots", params={"all": 1}).json(),
                    "workOrders": arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json(),
                    "subcon": arif.get(f"{BASE}/production/subcontract", params={"from": "2025-01-01", "to": tdate}).json(),
                    "stock": arif.get(f"{BASE}/stock", params={"size": 200}).json(),
                    "ledger": arif.get(f"{BASE}/items/{bgid}/ledger").json()}

        def batch_boots():
            """How many boots adopted the R5.4 collections — one `R5.4 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.4 upgrade:")

        goneb = arif.post(f"{BASE}/production/batches", json={**batch_body, "remark": f"R5.4 deleted {TAG}"}).json()
        arif.delete(f"{BASE}/production/batches/{goneb['id']}")
        bcounts, bbefore, bsplit, bboots = batch_counts(), batch_registers(), bfg_stock(bgid, binp), batch_boots()
        ensure_compat_state(); psql(PRE_R54_BATCHES)
        psql("delete from batch_consumption")
        psql("delete from batch_lines")
        psql("delete from batches")
        check(batch_counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'batches'") == "1",
              f"the database is back in the pre-R5.4 shape ({bcounts[0]} batches, {bcounts[1]} lines, "
              f"{bcounts[2]} consumed inputs, {bcounts[3]} receipts inside the snapshot)")
        restart()
        check(batch_counts() == bcounts,
              f"the first boot moved every batch into the tables ({bcounts[0]} batches, {bcounts[1]} lines)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(batch_registers() == bbefore,
              "…and serves the same six registers, row for row — the lots, the work orders' progress, the "
              "subcontracting register, the derived stock and one SKU's ledger with them")
        check(psql(f"select count(*) from batches where id = '{goneb['id']}'") == "0",
              "a batch deleted before the upgrade stays deleted — the mock kept no row for it either")
        afterb = arif.post(f"{BASE}/production/batches", json=batch_body).json()
        check(int(afterb["id"][2:]) > int(goneb["id"][2:]) and afterb["no"] != goneb["no"],
              f"…but its id and its number stay retired ({goneb['id']} {goneb['no']} → {afterb['id']} {afterb['no']})")
        arif.delete(f"{BASE}/production/batches/{afterb['id']}")
        check(bfg_stock(bgid, binp) == bsplit, "…and the stock derived from them is unchanged")
        bboots_after, bnow = batch_boots(), batch_counts()
        restart()
        check(batch_counts() == bnow and (bboots is None or bboots_after == bboots + 1)
              and (bboots is None or batch_boots() == bboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        wb = arif.post(f"{BASE}/production/batches", json=batch_body)
        check(wb.status_code == 201 and psql(f"select count(*) from batches where id = '{wb.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({wb.status_code})")
        arif.delete(f"{BASE}/production/batches/{wb.json()['id']}")
        # … and the price declarations with the production configuration, which the next release moved out: a
        # database written before them holds the declarations inside compat_state — each with its inputs and its cost
        # heads — and the configuration as one object beside them. A draft deleted before the upgrade has no place
        # there, so what has to survive the round trip is the id counter, not the row; its version, on the other
        # hand, is free again exactly as it was before.
        print("\nR5.5: upgrading a pre-R5.5 database moves the price declarations into their tables")
        def pd_counts():
            return (psql("select count(*) from boms where deleted_at is null"),
                    psql("select count(*) from bom_inputs i join boms b on b.id = i.bom_id"
                         " where b.deleted_at is null"),
                    psql("select count(*) from bom_costs c join boms b on b.id = c.bom_id"
                         " where b.deleted_at is null"),
                    psql("select count(*) from production_config"))

        def pd_registers():
            return {"boms": arif.get(f"{BASE}/production/boms", params={"size": 100}).json(),
                    "one": arif.get(f"{BASE}/production/boms/{pdNewId}").json(),
                    "csv": arif.get(f"{BASE}/production/boms", params={"format": "csv"}).text,
                    "config": arif.get(f"{BASE}/production/config").json(),
                    "batches": arif.get(f"{BASE}/production/batches", params={"size": 200}).json(),
                    "lots": arif.get(f"{BASE}/production/lots", params={"all": 1}).json(),
                    "bond": arif.get(f"{BASE}/vat/bond-uds").json()}

        def pd_boots():
            """How many boots adopted the R5.5 collections — one `R5.5 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.5 upgrade:")

        pdGone = arif.post(f"{BASE}/production/boms", json={**pdBody, "itemId": pdFg2["itemId"]}).json()
        arif.delete(f"{BASE}/production/boms/{pdGone.get('id')}")
        pdc, pdbefore, pdboots = pd_counts(), pd_registers(), pd_boots()
        ensure_compat_state(); psql(PRE_R55_BOMS)
        psql("delete from bom_costs")
        psql("delete from bom_inputs")
        psql("delete from boms")
        psql("delete from production_config")
        check(pd_counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'boms'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'productionConfig'") == "1",
              f"the database is back in the pre-R5.5 shape ({pdc[0]} declarations, {pdc[1]} inputs, {pdc[2]} cost "
              f"heads and the configuration inside the snapshot)")
        restart()
        check(pd_counts() == pdc and psql("select count(*) from boms") == pdc[0],
              f"the first boot moved every live declaration into the tables ({pdc[0]} of them, with {pdc[1]} inputs "
              f"and {pdc[2]} cost heads) and the configuration into its one row — a stamped draft left nothing to "
              f"adopt, so no row came back")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(pd_registers() == pdbefore,
              "…and serves the same registers, row for row — the declarations, one with its versions, the CSV, the "
              "configuration, and the batch, lot and bond registers that read them")
        check(psql(f"select count(*) from boms where id = '{pdGone['id']}'") == "0",
              "a declaration deleted before the upgrade stays deleted — the mock kept no row for it either")
        pdRefiled = arif.post(f"{BASE}/production/boms", json={**pdBody, "itemId": pdFg2["itemId"]}).json()
        check(pdRefiled.get("no") and pdRefiled["no"] == pdGone.get("no")
              and int(str(pdRefiled.get("id"))[3:]) > int(str(pdGone.get("id"))[3:]),
              f"…but its version is free again while its id stays retired ({pdGone.get('id')} → "
              f"{pdRefiled.get('id')}, both {pdRefiled.get('no')})")
        if pdRefiled.get("id"):
            arif.delete(f"{BASE}/production/boms/{pdRefiled['id']}")
        pdAfter = arif.post(f"{BASE}/production/batches", json=pdBatch)
        pdAfterLine = (pdAfter.json().get("lines") or [{}])[0] if pdAfter.status_code == 201 else {}
        check(pdAfter.status_code == 201 and pdAfterLine.get("bomId") == pdNewId
              and pdAfterLine.get("unitCost") == pdApproved.get("unitCost"),
              "…and a batch is still priced from the adopted declaration, through the mirror the module writes")
        if pdAfter.status_code == 201:
            arif.delete(f"{BASE}/production/batches/{pdAfter.json()['id']}")
        pdboots_after, pdnow = pd_boots(), pd_counts()
        restart()
        check(pd_counts() == pdnow and (pdboots is None or pdboots_after == pdboots + 1)
              and (pdboots is None or pd_boots() == pdboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        pdUp = admin.put(f"{BASE}/production/config", json={"procedure": "workOrder", "consumption": "actual"})
        check(pdUp.status_code == 200
              and psql("select procedure || '/' || consumption from production_config") == "workOrder/actual",
              f"and writes land in the tables on the upgraded database ({pdUp.status_code})")
        admin.put(f"{BASE}/production/config", json={"procedure": "directStock", "consumption": "standard"})
        # … and the work orders, which the same release moved out: a database written before them holds them inside
        # compat_state, each with the goods it asks for and the progress the approved batches had made on it. A draft
        # deleted before the upgrade has no place there, so what has to survive the round trip is the id counter and
        # the number in the audit trail, not the row.
        print("\nR5.5: upgrading a pre-R5.5 database moves the work orders into their tables")
        def wk_counts():
            return (psql("select count(*) from work_orders where deleted_at is null"),
                    psql("select count(*) from work_order_lines l join work_orders w on w.id = l.work_order_id"
                         " where w.deleted_at is null"),
                    psql("select count(*) from work_orders where status = 'completed'"),
                    psql("select coalesce(trim_scale(sum(issued)), 0) || '/' || coalesce(trim_scale(sum(received)), 0)"
                         " || '/' || coalesce(trim_scale(sum(damaged)), 0) from work_order_lines"))

        def wk_registers():
            wkDrawnNow = [w for w in arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json()["data"]
                          if w["status"] in ("partial", "completed")]
            return {"workOrders": arif.get(f"{BASE}/production/work-orders", params={"size": 50}).json(),
                    "one": arif.get(f"{BASE}/production/work-orders/{wkDrawnNow[0]['id']}").json(),
                    "csv": arif.get(f"{BASE}/production/work-orders", params={"format": "csv"}).text,
                    "batches": arif.get(f"{BASE}/production/batches", params={"size": 200}).json(),
                    "lots": arif.get(f"{BASE}/production/lots", params={"all": 1}).json(),
                    "subcon": arif.get(f"{BASE}/production/subcontract", params={"from": "2025-01-01", "to": tdate}).json(),
                    "boms": arif.get(f"{BASE}/production/boms", params={"size": 100}).json()}

        def wk_boots():
            """How many boots adopted the work orders — one `R5.5 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.5 upgrade:")

        wkGone = arif.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created",
                                                                   "requisitionNo": f"REQ-26-{TAG}e"}).json()
        arif.delete(f"{BASE}/production/work-orders/{wkGone.get('id')}")
        wkc, wkbefore, wkboots = wk_counts(), wk_registers(), wk_boots()
        ensure_compat_state(); psql(PRE_R55_WORK_ORDERS)
        psql("delete from work_order_lines")
        psql("delete from work_orders")
        check(wk_counts() == ("0", "0", "0", "0/0/0")
              and psql("select count(*) from compat_state where data->'db' ? 'workOrders'") == "1",
              f"the database is back in the pre-R5.5 shape ({wkc[0]} work orders and {wkc[1]} lines inside the "
              f"snapshot, the two tables empty)")
        restart()
        check(wk_counts() == wkc,
              f"the first boot moved every work order into the tables ({wkc[0]} of them, with {wkc[1]} lines and "
              f"{wkc[3]} issued/received/rejected)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(wk_registers() == wkbefore,
              "…and serves the same registers, row for row — the work orders, one with its batches, the CSV, and the "
              "batch, lot, subcontracting and declaration registers that read them")
        check(psql(f"select count(*) from work_orders where id = '{wkGone['id']}'") == "0",
              "a work order deleted before the upgrade stays deleted — the mock kept no row for it either")
        wkAfter = arif.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created",
                                                                    "requisitionNo": f"REQ-26-{TAG}f"}).json()
        check(wkAfter.get("id") and wkGone.get("id") and int(wkAfter["id"][2:]) > int(wkGone["id"][2:])
              and wkAfter.get("no") != wkGone.get("no"),
              f"…but its id and its number stay retired ({wkGone.get('id')} {wkGone.get('no')} → "
              f"{wkAfter.get('id')} {wkAfter.get('no')})")
        if wkAfter.get("id"):
            arif.delete(f"{BASE}/production/work-orders/{wkAfter['id']}")
        wkBatch = arif.post(f"{BASE}/production/batches", json={**wkChallan, "remark": f"R5.5 drill {TAG}",
                                                                "lines": [{"itemId": wkFg, "issueQty": 3}]})
        check(wkBatch.status_code == 201,
              f"and a batch can still be created on the upgraded database ({wkBatch.status_code})")
        if wkBatch.status_code == 201:
            arif.delete(f"{BASE}/production/batches/{wkBatch.json()['id']}")
        wkboots_after, wknow = wk_boots(), wk_counts()
        restart()
        check(wk_counts() == wknow and (wkboots is None or wkboots_after == wkboots + 1)
              and (wkboots is None or wk_boots() == wkboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        wkWrite = arif.post(f"{BASE}/production/work-orders", json={**wkBody, "process": "Created",
                                                                    "requisitionNo": f"REQ-26-{TAG}g"})
        check(wkWrite.status_code == 201
              and psql(f"select count(*) from work_orders where id = '{wkWrite.json().get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({wkWrite.status_code})")
        if wkWrite.json().get("id"):
            arif.delete(f"{BASE}/production/work-orders/{wkWrite.json()['id']}")
        # … and accounting, which the next release moved out: a database written before it holds the accounts, the
        # receipts and the payments with their allocations and the configuration inside compat_state. A draft deleted
        # before the upgrade has no place there, so what has to survive the round trip is the id counter and the
        # number in the audit trail, not the row.
        print("\nR5.6: upgrading a pre-R5.6 database moves accounting into their tables")
        def ay_counts():
            return (psql("select count(*) from money_accounts"),
                    psql("select count(*) from money_docs where deleted_at is null"),
                    psql("select count(*) from money_allocations a join money_docs m on m.id = a.doc_id"
                         " where m.deleted_at is null"),
                    psql("select count(*) from accounting_config"))

        def ay_registers():
            return {"accounts": arif.get(f"{BASE}/accounting/accounts", params={"size": 100}).json(),
                    "receipts": arif.get(f"{BASE}/accounting/receipts", params={"size": 100}).json(),
                    "payments": arif.get(f"{BASE}/accounting/payments", params={"size": 100}).json(),
                    "config": arif.get(f"{BASE}/accounting/config").json(),
                    "sales": arif.get(f"{BASE}/sales", params={"size": 200, "category": "all"}).json(),
                    "statement": arif.get(f"{BASE}/accounting/statement",
                                          params={"kind": "customer", "party": ayParty["id"]}).json()}

        def ay_boots():
            """How many boots adopted the accounting collections — one `R5.6 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.6 upgrade:")

        # its own fixtures: the main section's invoice may have been settled by the suites that ran since
        ayDrillParty, ayDrillInv = None, None
        for ayCand in ay_parties("customers")[:14]:
            ayOpenD = arif.get(f"{BASE}/accounting/open-invoices", params={"kind": "receipt", "party": ayCand["id"]}).json()
            if ayOpenD and ayOpenD[0]["due"] >= 600:
                ayDrillParty, ayDrillInv = ayCand, ayOpenD[0]
                break
        check(ayDrillParty is not None, "R5.6: a customer is left with an invoice the drill can settle")
        # a live bank account of its own: the one the checks above used was deactivated on purpose
        ayDrillBank = [a for a in arif.get(f"{BASE}/accounting/accounts", params={"size": 100}).json()["data"]
                       if a["kind"] == "bank" and a["active"]][0]["id"]
        ayDrill = {**ayRec, "partyId": ayDrillParty["id"], "accountId": ayDrillBank, "amount": 500,
                   "allocations": [{"docId": ayDrillInv["id"], "amount": 500}]} if ayDrillParty else ayRec
        ayDrillPaid = float(psql(f"select paid from sales where id = '{ayDrillInv['id']}'")) if ayDrillParty else None
        ayGoneR = arif.post(f"{BASE}/accounting/receipts", json={**ayDrill, "amount": 25,
                                                                 "allocations": [{"docId": ayDrillInv["id"], "amount": 25}]})
        ayGoneDoc = ayGoneR.json() if ayGoneR.status_code == 201 else {}
        check(ayGoneR.status_code == 201,
              f"R5.6: the drill can draft a receipt ({ayGoneR.status_code} "
              f"{json.dumps(ayGoneR.json().get('errors'))[:120] if ayGoneR.status_code != 201 else ayGoneDoc.get('no')})")
        if ayGoneDoc.get("id"):
            arif.delete(f"{BASE}/accounting/receipts/{ayGoneDoc['id']}")
        ayc, aybefore, ayboots = ay_counts(), ay_registers(), ay_boots()
        ensure_compat_state(); psql(PRE_R56_ACCOUNTING)
        psql("delete from money_allocations")
        psql("delete from money_docs")
        psql("delete from money_accounts")
        psql("delete from accounting_config")
        check(ay_counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'moneyAccounts'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'moneyDocs'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'accountingConfig'") == "1",
              f"the database is back in the pre-R5.6 shape ({ayc[0]} accounts, {ayc[1]} documents and {ayc[2]} "
              f"allocations inside the snapshot, the four tables empty)")
        restart()
        check(ay_counts() == ayc,
              f"the first boot moved every account, receipt and payment into the tables ({ayc[0]} accounts, "
              f"{ayc[1]} documents, {ayc[2]} allocations and the configuration)")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(ay_registers() == aybefore,
              "…and serves the same registers, row for row — the accounts with their balances, both money registers "
              "with their allocations, the configuration, the invoices they settled and a customer's statement")
        check(psql(f"select count(*) from money_docs where id = '{ayGoneDoc.get('id')}'") == "0",
              "a receipt deleted before the upgrade stays deleted — the mock kept no row for it either")
        ayAfter = arif.post(f"{BASE}/accounting/receipts", json={**ayDrill, "amount": 25,
                                                                "allocations": [{"docId": ayDrillInv["id"], "amount": 25}]})
        aya = ayAfter.json() if ayAfter.status_code == 201 else {}
        check(ayAfter.status_code == 201 and str(aya.get("id", "")) > str(ayGoneDoc.get("id", ""))
              and aya.get("no") != ayGoneDoc.get("no"),
              f"…but its id and its number stay retired ({ayGoneDoc.get('id')} {ayGoneDoc.get('no')} → "
              f"{aya.get('id')} {aya.get('no')})")
        if aya.get("id"):
            arif.delete(f"{BASE}/accounting/receipts/{aya['id']}")
        # the decisive one: a receipt on the upgraded database still settles its invoice
        aySettleR = arif.post(f"{BASE}/accounting/receipts", json=ayDrill)
        aySettle = aySettleR.json() if aySettleR.status_code == 201 else {}
        check(aySettleR.status_code == 201
              and psql(f"select trim_scale(allocated) from money_docs where id = '{aySettle.get('id')}'") == "500"
              and psql(f"select count(*) from money_allocations where doc_id = '{aySettle.get('id')}'") == "1",
              f"…and a receipt written on the upgraded database is stored with its allocation ({aySettleR.status_code})")
        if aySettle.get("id"):
            arif.patch(f"{BASE}/accounting/receipts/{aySettle['id']}", json={"process": "Approved"})
            check(float(psql(f"select paid from sales where id = '{ayDrillInv['id']}'")) == jr2(ayDrillPaid + 500),
                  f"…and approving it settles the invoice on the sales row, in the table it adopted "
                  f"({ayDrillPaid} → {jr2(ayDrillPaid + 500)})")
            arif.patch(f"{BASE}/accounting/receipts/{aySettle['id']}",
                       json={"process": "Cancelled", "reason": f"R5.6 drill {TAG}"})
            check(float(psql(f"select paid from sales where id = '{ayDrillInv['id']}'")) == ayDrillPaid,
                  "…and cancelling it gives the settlement back")
        ayboots_after, aynow = ay_boots(), ay_counts()
        restart()
        check(ay_counts() == aynow and (ayboots is None or ayboots_after == ayboots + 1)
              and (ayboots is None or ay_boots() == ayboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        ayWrite = admin.put(f"{BASE}/accounting/config",
                            json={"closedUpTo": ayCfg0.get("closedUpTo"), "allowAdvance": True, "autoAllocate": True})
        check(ayWrite.status_code == 200
              and psql("select count(*) from accounting_config where allow_advance") == "1",
              f"and writes land in the tables on the upgraded database ({ayWrite.status_code})")

        # … and the NBR VAT documents, which the same release moved out: a database written before it holds the
        # treasury deposits, the VDS certificates and the VAT adjustments inside compat_state. A draft deleted before
        # the upgrade has no place there either, so what has to survive the round trip is the id counter and the
        # number in the audit trail, not the row.
        print("\nR5.6: upgrading a pre-R5.6 database moves the VAT documents into their tables")

        def vd_counts():
            return (psql("select count(*) from treasury_deposits where deleted_at is null"),
                    psql("select count(*) from vds_entries where deleted_at is null"),
                    psql("select count(*) from vat_adjustments where deleted_at is null"))

        def vd_registers():
            return {"treasury": arif.get(f"{BASE}/vat/treasury", params={"size": 200}).json(),
                    "vds": arif.get(f"{BASE}/vat/vds", params={"size": 200}).json(),
                    "adjustments": arif.get(f"{BASE}/vat/adjustments", params={"size": 200}).json(),
                    "eligible": arif.get(f"{BASE}/vat/vds/eligible", params={"mode": "purchase"}).json(),
                    "sd": arif.get(f"{BASE}/vat/sd-eligible").json()}

        def vd_boots():
            """How many boots adopted a VAT collection — one `R5.6 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return fh.read().count("R5.6 upgrade:")

        # its own fixtures: the main section's invoice has had a certificate written against it by now, and the
        # demo's may have been withheld by the suites that ran before this one
        vdDrillPur = arif.post(f"{BASE}/purchases", json={**pur_body, "issueDate": vdDate, "challanDate": vdDate,
                                                          "challanNo": f"VDS{TAG}-drill",
                                                          "process": "Approved", "category": "service",
                                                          "lines": [{"itemId": sv["id"], "qty": 1, "price": 5000,
                                                                     "sdRate": 0, "vatRate": 10, "vds": True}]})
        vdDrillPool = [e for e in arif.get(f"{BASE}/vat/vds/eligible", params={"mode": "purchase"}).json()
                       if e["id"] == vdDrillPur.json().get("id") and e["remaining"] >= 100]
        vdDrillPick = vdDrillPool[0] if vdDrillPool else None
        check(vdDrillPick is not None,
              f"R5.6: a purchase is left with VAT the drill can withhold ({vdDrillPur.status_code} "
              f"{vdDrillPur.json().get('invoiceNo')})")
        vdDrillBody = ({"mode": "purchase", "docId": vdDrillPick["id"] if vdDrillPick else "", "amount": 100,
                        "certificateNo": f"R56-drill-{TAG}", "certificateDate": vdDate, "process": "Created"}
                       if vdDrillPick else {})
        # a deposit created and deleted before the rewind: what must survive is the id it claimed
        vdGoneD = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-drill"})
        vdGoneDoc = vdGoneD.json() if vdGoneD.status_code == 201 else {}
        check(vdGoneD.status_code == 201,
              f"R5.6: the drill can draft a deposit ({vdGoneD.status_code} "
              f"{json.dumps(vdGoneD.json().get('errors'))[:120] if vdGoneD.status_code != 201 else vdGoneDoc.get('no')})")
        if vdGoneDoc.get("id"):
            arif.delete(f"{BASE}/vat/treasury/{vdGoneDoc['id']}")
        vdc, vdbefore, vdboots = vd_counts(), vd_registers(), vd_boots()
        ensure_compat_state(); psql(PRE_R56_VAT)
        psql("delete from vat_adjustments")
        psql("delete from vds_entries")
        psql("delete from treasury_deposits")
        check(vd_counts() == ("0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'treasury'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'vds'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'adjustments'") == "1",
              f"the database is back in the pre-R5.6 shape ({vdc[0]} deposits, {vdc[1]} certificates and "
              f"{vdc[2]} adjustments inside the snapshot, the three tables empty)")
        restart()
        check(vd_counts() == vdc,
              f"the first boot moved every deposit, certificate and adjustment into the tables ({vdc[0]} deposits, "
              f"{vdc[1]} certificates, {vdc[2]} adjustments)")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(vd_registers() == vdbefore,
              "…and serves the same registers, row for row — the three of them, the invoices a certificate may still "
              "be written against, and the SD-on-exports register that reads the adjustments")
        check(psql(f"select count(*) from treasury_deposits where id = '{vdGoneDoc.get('id')}'") == "0",
              "a deposit deleted before the upgrade stays deleted — the mock kept no row for it either")
        vdAfter = arif.post(f"{BASE}/vat/treasury", json={**vdTBody, "challanNo": f"R56-{TAG}-drill"})
        vdaf = vdAfter.json() if vdAfter.status_code == 201 else {}
        check(vdAfter.status_code == 201 and str(vdaf.get("id", "")) > str(vdGoneDoc.get("id", ""))
              and vdaf.get("no") != vdGoneDoc.get("no"),
              f"…but its id and its number stay retired ({vdGoneDoc.get('id')} {vdGoneDoc.get('no')} → "
              f"{vdaf.get('id')} {vdaf.get('no')})")
        if vdaf.get("id"):
            arif.delete(f"{BASE}/vat/treasury/{vdaf['id']}")
        # the decisive one: a certificate approved on the upgraded database still settles its purchase
        if vdDrillPick:
            vdDrillPaid = float(psql(f"select paid from purchases where id = '{vdDrillPick['id']}'"))
            vdSettleR = arif.post(f"{BASE}/vat/vds", json=vdDrillBody)
            vdSettle = vdSettleR.json() if vdSettleR.status_code == 201 else {}
            check(vdSettleR.status_code == 201
                  and psql(f"select trim_scale(amount) from vds_entries where id = '{vdSettle.get('id')}'") == "100",
                  f"…and a certificate written on the upgraded database is stored with the VAT it withholds "
                  f"({vdSettleR.status_code})")
            if vdSettle.get("id"):
                arif.patch(f"{BASE}/vat/vds/{vdSettle['id']}", json={"process": "Approved"})
                check(float(psql(f"select paid from purchases where id = '{vdDrillPick['id']}'")) == jr2(vdDrillPaid + 100)
                      and psql(f"select trim_scale(settled) from vds_entries where id = '{vdSettle['id']}'") == "100",
                      f"…and approving it settles the purchase on the row, in the table it adopted "
                      f"({vdDrillPaid} → {jr2(vdDrillPaid + 100)})")
                arif.patch(f"{BASE}/vat/vds/{vdSettle['id']}", json={"process": "Cancelled", "reason": f"R5.6 drill {TAG}"})
                check(float(psql(f"select paid from purchases where id = '{vdDrillPick['id']}'")) == vdDrillPaid,
                      "…and cancelling it gives the settlement back")
        vdboots_after, vdnow = vd_boots(), vd_counts()
        restart()
        check(vd_counts() == vdnow and (vdboots is None or vdboots_after == vdboots + 1)
              and (vdboots is None or vd_boots() == vdboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        vdWrite = arif.post(f"{BASE}/vat/adjustments", json={**vdABody, "reference": f"R56-{TAG}-drill"})
        vdw = vdWrite.json() if vdWrite.status_code == 201 else {}
        check(vdWrite.status_code == 201
              and psql(f"select count(*) from vat_adjustments where id = '{vdw.get('id')}' and deleted_at is null") == "1",
              f"and writes land in the tables on the upgraded database ({vdWrite.status_code})")
        if vdw.get("id"):
            arif.delete(f"{BASE}/vat/adjustments/{vdw['id']}")

        # … and the Mushak 9.1 return itself, the last family this release moved: a database written before it
        # holds one return per tax period inside compat_state — the period being its id — and the NBR settings
        # beside it, with `vat_returns` and `vat_settings` empty. The return is the document the period lock every
        # other family checks comes from, so what has to survive the round trip is not only the register but the
        # lock, the compliance centre and every note sub-form behind a submitted period's computation.
        print("\nR5.6: upgrading a pre-R5.6 database moves the returns and the NBR settings into their tables")

        def ret_counts():
            return (psql("select count(*) from vat_returns"), psql("select count(*) from vat_settings"))

        def ret_registers():
            filed = [p for p in arif.get(f"{BASE}/vat/periods").json() if p.get("returnId")][0]["period"]
            return {"returns": arif.get(f"{BASE}/vat/returns", params={"size": 200}).json(),
                    "returnsCsv": arif.get(f"{BASE}/vat/returns", params={"size": 200, "format": "csv"}).text,
                    "periods": arif.get(f"{BASE}/vat/periods").json(),
                    "compliance": arif.get(f"{BASE}/vat/compliance").json(),
                    "complianceFiled": arif.get(f"{BASE}/vat/compliance", params={"period": filed}).json(),
                    "settings": arif.get(f"{BASE}/vat/settings").json(),
                    "view": arif.get(f"{BASE}/vat/returns/{filed}").json(),
                    "note30": arif.get(f"{BASE}/vat/returns/{filed}/notes/30").json(),
                    "note58": arif.get(f"{BASE}/vat/returns/{filed}/notes/58").json()}

        rc, rbefore, rboots = ret_counts(), ret_registers(), vd_boots()
        ensure_compat_state(); psql(PRE_R56_RETURNS)
        psql("delete from vat_returns")
        psql("delete from vat_settings")
        check(ret_counts() == ("0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'returns'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'vatSettings'") == "1",
              f"the database is back in the pre-R5.6 shape ({rc[0]} returns and the settings inside the snapshot, "
              f"both tables empty)")
        restart()
        check(ret_counts() == rc,
              f"the first boot moved every return into vat_returns and the settings into vat_settings "
              f"({rc[0]} returns)")
        check(psql(COMPAT_GONE) == "t"
              and psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(ret_registers() == rbefore,
              "…and serves the same answers: the register with its CSV, the tax periods, the compliance centre "
              "for the open period and for a filed one, the NBR settings, one return with its computation, and "
              "the note sub-forms behind two of them")
        check(psql("select count(*) from vat_returns r join (select period, submission_date, ack_no, snapshot "
                   "from vat_returns) x on x.period = r.period where r.status = 'submitted' and r.snapshot is null") == "0"
              and psql("select count(*) from vat_returns where status = 'submitted' and ack_no is null") == "0",
              "…with every filed return still carrying the computation it was filed with")
        # The decisive one: the lock is a row. While the return for a period is submitted, a deposit dated into
        # that period is refused; put the row's own columns back to a draft in SQL alone — the in-memory copies
        # left stale on purpose, so only a restart can tell — and the same body is accepted. Nothing else about
        # the period changed, which is what makes it the table the lock reads and not the snapshot.
        lockPeriod, lockNo = "2026-08", f"R56-{TAG}-lock"
        lockBody = {**vdTBody, "challanNo": lockNo, "taxPeriod": lockPeriod}
        check(arif.post(f"{BASE}/vat/treasury", json=lockBody).json().get("errors", {}).get("taxPeriod")
              == ["periodLocked"],
              "the lock reads vat_returns: a deposit in a period whose return is submitted is refused with the "
              "mock's own 422")
        lockSnap = psql(f"select snapshot::text from vat_returns where period = '{lockPeriod}'").replace("'", "''")
        lockAck = psql(f"select ack_no from vat_returns where period = '{lockPeriod}'").replace("'", "''")
        lockSub = psql(f"select to_char(submission_date, 'YYYY-MM-DD') from vat_returns where period = "
                       f"'{lockPeriod}'")
        psql(f"update vat_returns set status = 'draft', snapshot = null, ack_no = null, submission_date = null "
             f"where period = '{lockPeriod}'")
        restart()
        lockFree = arif.post(f"{BASE}/vat/treasury", json=lockBody)
        check(lockFree.status_code == 201,
              f"…and the same body is accepted the moment the row stops being a submitted return "
              f"({lockFree.status_code} {json.dumps(lockFree.json().get('errors'))[:120]})")
        if lockFree.status_code == 201:
            arif.delete(f"{BASE}/vat/treasury/{lockFree.json()['id']}")
        psql(f"""update vat_returns set status = 'submitted', snapshot = '{lockSnap}'::jsonb, ack_no = '{lockAck}',
                 submission_date = '{lockSub}' where period = '{lockPeriod}'""")
        restart()
        check(psql(f"select status from vat_returns where period = '{lockPeriod}'") == "submitted"
              and arif.post(f"{BASE}/vat/treasury", json=lockBody).json().get("errors", {}).get("taxPeriod")
              == ["periodLocked"],
              "…and putting the row back locks the period again")
        # a return filed on the upgraded database: a draft for the oldest period that has none (a return is filed
        # in order, so that is the only one the register will take), then a settings write
        rUnfiled = [p for p in arif.get(f"{BASE}/vat/periods").json() if not p.get("returnId")]
        if rUnfiled:
            rOpen = rUnfiled[-1]["period"]
            rWrite = arif.post(f"{BASE}/vat/returns", json={"period": rOpen})
            rw = rWrite.json() if rWrite.status_code == 201 else {}
            check(rWrite.status_code == 201 and rw.get("status") == "draft"
                  and psql(f"select count(*) from vat_returns where period = '{rOpen}' and status = 'draft'") == "1",
                  f"a return started on the upgraded database is a row in vat_returns ({rWrite.status_code} "
                  f"{rw.get('period')})")
            if rWrite.status_code == 201:
                arif.delete(f"{BASE}/vat/returns/{rOpen}")
                check(psql(f"select count(*) from vat_returns where period = '{rOpen}'") == "0",
                      "…and deleting the draft takes the row with it")
        else:
            skipped("a return started on the upgraded database (every tax period has one)")
        rSet = arif.get(f"{BASE}/vat/settings").json()
        rSetWrite = admin.put(f"{BASE}/vat/settings", json={"zoneCode": rSet["zoneCode"],
                                                            "profile": rSet.get("profile")})
        check(rSetWrite.status_code == 200
              and psql("select count(*) from vat_settings where id = 1 and updated_by is not null") == "1",
              f"and the settings write lands in the one row ({rSetWrite.status_code})")
        rboots_after, rnow = vd_boots(), ret_counts()
        restart()
        check(ret_counts() == rnow and (rboots is None or rboots_after == rboots + 1)
              and (rboots is None or vd_boots() == rboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")

        # … and the first of the R6 registers, one release later: a database written before this slice holds every
        # Utilization Declaration inside compat_state — the head with its inputs and its amendment certificates —
        # and no row in `uds` / `ud_lines`. What has to survive the round trip is the register with its usage and
        # its bond watch-list, the amendments, the id a deleted declaration claimed, and the in-memory copy the
        # RMG export register still reads.
        print("\nR6.2: upgrading a pre-R6.2 database moves the declarations into their tables")

        def ud_counts():
            return (psql("select count(*) from uds where deleted_at is null"),
                    psql("select count(*) from ud_lines l join uds u on u.id = l.ud_id where u.deleted_at is null"),
                    psql("select count(*) from uds u where u.deleted_at is null and u.amendments is not null"),
                    psql("select count(*) from uds where deleted_at is not null"))

        def ud_registers():
            return {"uds": arif.get(f"{BASE}/vat/uds").json(),
                    "udsCsv": arif.get(f"{BASE}/vat/uds", params={"format": "csv"}).text,
                    "one": arif.get(f"{BASE}/vat/uds/ud2").json(),
                    "fit": arif.post(f"{BASE}/vat/uds/fit", json={"customerId": "c10", "issueDate": tdate,
                                                                 "udNo": "BKMEA/UD/2026/08812",
                                                                 "lines": [{"itemId": "i21", "qty": 1000}]}).json(),
                    "exports": arif.get(f"{BASE}/vat/exports").json()}

        def ud_boots():
            """How many boots adopted the declarations — one `R6.2 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return sum(1 for line in fh if "R6.2 upgrade:" in line)

        udGone = arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}drill"})
        udGoneDoc = udGone.json() if udGone.status_code == 201 else {}
        check(udGone.status_code == 201,
              f"R6.2: the drill can draft a declaration ({udGone.status_code} "
              f"{json.dumps(udGone.json().get('errors'))[:120] if udGone.status_code != 201 else udGoneDoc.get('no')})")
        if udGoneDoc.get("id"):
            arif.delete(f"{BASE}/vat/uds/{udGoneDoc['id']}")
        udc, udbefore, udboots = ud_counts(), ud_registers(), ud_boots()
        ensure_compat_state(); psql(PRE_R62_UDS)
        psql("delete from ud_lines")
        psql("delete from uds")
        check(ud_counts()[:3] == ("0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'uds'") == "1",
              f"the database is back in the pre-R6.2 shape ({udc[0]} declarations, {udc[1]} inputs and "
              f"{udc[2]} amendment histories inside the snapshot, both tables empty)")
        restart()
        check(ud_counts()[:3] == udc[:3],  # the fourth count is the deleted rows: the snapshot keeps none of them
              f"the first boot moved every declaration into the tables ({udc[0]} declarations, {udc[1]} inputs, "
              f"{udc[2]} with amendments)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(ud_registers() == udbefore,
              "…and serves the same answers: the register with its CSV, one declaration with its usage, the fit "
              "question and the RMG export register that reads the declarations from memory")
        check(psql(f"select count(*) from uds where id = '{udGoneDoc.get('id')}'") == "0",
              "a declaration deleted before the upgrade stays deleted — the mock kept no row for it either")
        udAfter = arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}drill"})
        udaf = udAfter.json() if udAfter.status_code == 201 else {}
        check(udAfter.status_code == 201 and str(udaf.get("id", "")) > str(udGoneDoc.get("id", "")),
              f"…but its id stays retired ({udGoneDoc.get('id')} → {udaf.get('id')})")
        if udaf.get("id"):
            arif.delete(f"{BASE}/vat/uds/{udaf['id']}")
        udboots_after, udnow = ud_boots(), ud_counts()
        restart()
        check(ud_counts()[:3] == udnow[:3] and (udboots is None or udboots_after == udboots + 1)
              and (udboots is None or ud_boots() == udboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        udWrite = arif.post(f"{BASE}/vat/uds", json={**udBody, "no": f"{udNo}after"})
        udw = udWrite.json() if udWrite.status_code == 201 else {}
        check(udWrite.status_code == 201
              and psql(f"select count(*) from uds where id = '{udw.get('id')}' and deleted_at is null") == "1"
              and psql(f"select count(*) from ud_lines where ud_id = '{udw.get('id')}'") == "2",
              f"and writes land in the tables on the upgraded database ({udWrite.status_code})")
        if udw.get("id"):
            arif.delete(f"{BASE}/vat/uds/{udw['id']}")

        # … and the second of the R6 registers: a database written before this slice holds our own UDs / UP inside
        # compat_state — the head with its inputs and garments as arrays, the settlement travelling with it — and
        # no row in `bond_uds` / `bond_ud_inputs` / `bond_ud_garments`. What has to survive the round trip is the
        # register with its statements and its totals, one UD frozen as settled, and the in-memory copy the bond
        # register still links its lots through.
        print("\nR6.5: upgrading a pre-R6.5 database moves the own UDs into their tables")

        def bu_counts():
            return (psql("select count(*) from bond_uds where deleted_at is null"),
                    psql("select count(*) from bond_ud_inputs l join bond_uds u on u.id = l.ud_id where u.deleted_at is null"),
                    psql("select count(*) from bond_ud_garments g join bond_uds u on u.id = g.ud_id where u.deleted_at is null"),
                    psql("select count(*) from bond_uds where deleted_at is null and settlement is not null"))

        def bu_registers():
            return {"uds": arif.get(f"{BASE}/vat/bond-uds").json(),
                    "udsCsv": arif.get(f"{BASE}/vat/bond-uds", params={"format": "csv"}).text,
                    "one": arif.get(f"{BASE}/vat/bond-uds/bu1").json(),
                    "settled": arif.get(f"{BASE}/vat/bond-uds", params={"state": "settled"}).json(),
                    "bond": arif.get(f"{BASE}/vat/bond").json()}

        def bu_boots():
            """How many boots adopted the own UDs — one `R6.5 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return sum(1 for line in fh if "R6.5 upgrade:" in line)

        buc, bubefore, buboots = bu_counts(), bu_registers(), bu_boots()
        ensure_compat_state(); psql(PRE_R65_BOND_UDS)
        psql("delete from bond_ud_garments")
        psql("delete from bond_ud_inputs")
        psql("delete from bond_uds")
        check(bu_counts() == ("0", "0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'bondUds'") == "1",
              f"the database is back in the pre-R6.5 shape ({buc[0]} own UDs, {buc[1]} inputs, {buc[2]} garments and "
              f"{buc[3]} settlements inside the snapshot, all three tables empty)")
        restart()
        check(bu_counts() == buc,
              f"the first boot moved every own UD into the tables ({buc[0]} own UDs, {buc[1]} inputs, "
              f"{buc[2]} garments, {buc[3]} settled)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(bu_registers() == bubefore,
              "…and serves the same answers: the register with its CSV, one settled UD, the settled state's own "
              "and the bond register that links its lots through the in-memory copy")
        buboots_after, bunow = bu_boots(), bu_counts()
        restart()
        check(bu_counts() == bunow and (buboots is None or buboots_after == buboots + 1)
              and (buboots is None or bu_boots() == buboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        buWrite = arif.post(f"{BASE}/vat/bond-uds", json={"kind": "UP", "issuer": "Customs", "no": f"CUS/UP/2026/A{TAG}".upper(),
                                                          "date": "2026-08-01", "expiry": "2026-09-01",
                                                          "masterLcNo": f"EXP-LC-A-{TAG}",
                                                          "inputs": [{"itemId": "i9", "qty": 100}],
                                                          "garments": [{"itemId": "i18", "qty": 300}]})
        buw = buWrite.json() if buWrite.status_code == 201 else {}
        check(buWrite.status_code == 201
              and psql(f"select count(*) from bond_uds where id = '{buw.get('id')}' and deleted_at is null") == "1"
              and psql(f"select count(*) from bond_ud_inputs where ud_id = '{buw.get('id')}'") == "1"
              and psql(f"select count(*) from bond_ud_garments where ud_id = '{buw.get('id')}'") == "1",
              f"and writes land in the tables on the upgraded database ({buWrite.status_code})")

        # …and the R6.6 pair: a database written before this slice holds the Mushak 9.3 / 9.4 applications inside
        # compat_state and no rows in `late_filings` / `return_amendments`. What has to survive the round trip is
        # both registers with their CSVs and totals, one application frozen as amended with the adjustment its
        # decrease posted, and the return view that reads the applications through the mirror.
        print("\nR6.6: upgrading a pre-R6.6 database moves the 9.3 / 9.4 applications into their tables")

        def ra_counts():
            return (psql("select count(*) from late_filings where deleted_at is null"),
                    psql("select count(*) from return_amendments where deleted_at is null"),
                    psql("select count(*) from return_amendments where status = 'amended' and amended->'adjustmentIds' is not null"))

        def ra_registers():
            """Both registers, the CSVs and one of each — with the drill's own draft filtered out, so the sides
            compare (the before-side cannot have it; the after-side must not depend on it)."""
            lf = arif.get(f"{BASE}/vat/late-filings").json()
            lf["rows"] = [r for r in lf.get("rows", []) if r.get("id") != DRILL_LF_ID]
            am = arif.get(f"{BASE}/vat/return-amendments").json()
            return {"lf": lf,
                    "lfOne": arif.get(f"{BASE}/vat/late-filings/lf1").json(),
                    "am": am,
                    "amCsv": arif.get(f"{BASE}/vat/return-amendments", params={"format": "csv"}).text,
                    "amOne": arif.get(f"{BASE}/vat/return-amendments/{dec_id}").json() if dec_id else None,
                    "compliance": arif.get(f"{BASE}/vat/compliance", params={"period": "2026-08"}).json()}

        def ra_boots():
            """How many boots adopted the applications — one `R6.6 upgrade:` line each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return sum(1 for line in fh if "R6.6 upgrade:" in line)

        rac, rabefore, raboots = ra_counts(), ra_registers(), ra_boots()
        ensure_compat_state(); psql(PRE_R66_RETURN_APPS)
        psql("delete from return_amendments")
        psql("delete from late_filings")
        check(ra_counts() == ("0", "0", "0")
              and psql("select count(*) from compat_state where data->'db' ? 'lateFilings'") == "1"
              and psql("select count(*) from compat_state where data->'db' ? 'returnAmendments'") == "1",
              f"the database is back in the pre-R6.6 shape ({rac[0]} 9.3 and {rac[1]} 9.4 applications inside the "
              f"snapshot, both tables empty, one synthetic draft beside them)")
        restart()
        check(ra_counts() == (str(int(rac[0]) + 1), rac[1], rac[2]),
              f"the first boot moved every application into the tables ({rac[0]} 9.3 + the drill's own draft, "
              f"{rac[1]} 9.4, {rac[2]} amended with a decreasing adjustment)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(ra_registers() == rabefore,
              "…and serves the same answers: both registers, the 9.4 CSV, one of each and the compliance centre "
              "that reads the applications through the mirror")
        raboots_after, ranow = ra_boots(), ra_counts()
        restart()
        check(ra_counts() == ranow and (raboots is None or raboots_after == raboots + 1)
              and (raboots is None or ra_boots() == raboots_after),
              "a second boot adopts nothing again — the tables are the only copy from then on")
        # the synthetic draft came along: edit it (the period's return is already submitted, so the rules refuse),
        # try to file it (the same refusal), then delete it — the three write paths against an old-code draft.
        drPut = arif.put(f"{BASE}/vat/late-filings/{DRILL_LF_ID}", json={"period": "2025-12", "reasonKind": "documents",
                                                                         "reason": "Editing the drill's draft once the tables own the family.", "requestedDate": "2026-01-22"})
        drFile = arif.post(f"{BASE}/vat/late-filings/{DRILL_LF_ID}/action", json={"action": "file", "date": "2026-01-12", "ref": "CVAT/DRILL/1"})
        drDel = arif.delete(f"{BASE}/vat/late-filings/{DRILL_LF_ID}")
        check(drPut.status_code == 422 and drPut.json().get("errors", {}).get("period") == ["alreadySubmitted"]
              and drFile.status_code == 422 and drFile.json().get("errors", {}).get("period") == ["alreadySubmitted"]
              and drDel.status_code == 200
              and psql(f"select count(*) from late_filings where id = '{DRILL_LF_ID}' and deleted_at is not null and status = 'draft'") == "1",
              "and the drill's draft runs the ported write paths: the rules refuse the edit and the filing "
              "(the return is submitted), and the delete stamps the row — the id retires with it")
        raWrite = arif.post(f"{BASE}/vat/return-amendments", json={"period": "2026-02", "reasonKind": "clerical", "description": f"Native check {TAG} on the upgraded database — transposed digits", "noAudit": True,
                                                                   "corrections": [{"note": 1, "field": "value", "to": 1234.56, "explanation": "Transposed digits"}]})
        raw = raWrite.json() if raWrite.status_code == 201 else {}
        check(raWrite.status_code == 201
              and psql(f"select count(*) from return_amendments where id = '{raw.get('id')}' and deleted_at is null") == "1",
              f"and writes land in the tables on the upgraded database ({raWrite.status_code})")

        # …and the proceeds register: a database written before the port holds the bank PRC batches inside
        # compat_state and no rows in `prc_batches`. What has to survive the round trip is the register with its
        # overview, both of its CSVs, one batch by number (reversed, with its lines and history), the realisations
        # on the invoices, and the write paths against the drill's own synthetic batch.
        print("\nR6.6: upgrading a pre-R6.6 database moves the PRC batches into their table")

        def pv_counts():
            return (psql("select count(*) from prc_batches where deleted_at is null"),
                    psql("select count(*) from sale_realisations where batch_id is not null"))

        def pv_registers():
            """The proceeds surface — with the drill's own batch filtered out, so the sides compare (the
            before-side cannot have it; the after-side must not depend on it)."""
            ov = arif.get(f"{BASE}/vat/proceeds").json()
            ov["batches"] = [b for b in ov.get("batches", []) if b.get("id") != DRILL_PB_ID]
            bs = arif.get(f"{BASE}/vat/proceeds/batches").json()
            bs["rows"] = [r for r in bs.get("rows", []) if r.get("id") != DRILL_PB_ID]
            sid = psql("select sale_id from sale_realisations where batch_id = 'pb1' limit 1")
            return {"ov": ov,
                    "ovCsv": arif.get(f"{BASE}/vat/proceeds", params={"format": "csv"}).text,
                    "sample": arif.get(f"{BASE}/vat/proceeds/sample").text,
                    "bs": bs,
                    "one": arif.get(f"{BASE}/vat/proceeds/batches/PB-09260004").json(),
                    "invoice": arif.get(f"{BASE}/sales/{sid}").json() if sid else None}

        def pv_boots():
            """How many boots adopted the batches — one `R6.6 upgrade:` line mentioning them each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return sum(1 for line in fh if "R6.6 upgrade:" in line and "PRC batches" in line)

        pvc, pvbefore, pvboots = pv_counts(), pv_registers(), pv_boots()
        ensure_compat_state(); psql(PRE_R66B_PRC_BATCHES)
        psql("delete from prc_batches")
        check(pv_counts() == ("0", pvc[1])
              and psql("select count(*) from compat_state where data->'db' ? 'prcBatches'") == "1",
              f"the database is back in the pre-port shape ({pvc[0]} PRC batches inside the snapshot, the table "
              f"empty, one synthetic batch beside them, the realisations untouched where they already were)")
        restart()
        check(pv_counts() == (str(int(pvc[0]) + 1), pvc[1]),
              f"the first boot moved every batch into the table ({pvc[0]} batches + the drill's own, "
              f"{pvc[1]} realisations kept where they were)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(pv_registers() == pvbefore,
              "…and serves the same answers: the overview, both CSVs, the register, the reversed batch by "
              "number and the realisations on its invoice")
        pvboots_after, pvnow = pv_boots(), pv_counts()
        restart()
        check(pv_counts() == pvnow and (pvboots is None or pvboots_after == pvboots + 1)
              and (pvboots is None or pv_boots() == pvboots_after),
              "a second boot adopts nothing again — the table is the only copy from then on")
        # the synthetic batch came along: fetch it by id, then reverse it — both write paths against a batch the
        # old code could have left behind (its one line has no allocations, so the reversal only stamps the row)
        drGet = arif.get(f"{BASE}/vat/proceeds/batches/{DRILL_PB_ID}")
        drRv = arif.post(f"{BASE}/vat/proceeds/batches/{DRILL_PB_ID}/reverse", json={"date": "2026-09-25", "reason": "Upgrade drill"})
        check(drGet.status_code == 200 and drGet.json().get("no") == "PB-09269999" and drGet.json().get("status") == "posted"
              and drRv.status_code == 200 and drRv.json().get("status") == "reversed"
              and psql(f"select count(*) from prc_batches where id = '{DRILL_PB_ID}' and status = 'reversed' and reversed_on = '2026-09-25' and history->-1->>'action' = 'cancelled'") == "1",
              "and the drill's batch runs the ported write paths: fetched by id, reversed and stamped")
        tgt2 = next((o for o in arif.get(f"{BASE}/vat/proceeds").json().get("open", []) if o.get("outstandingFc", 0) >= 2), None)
        pvWrite = arif.post(f"{BASE}/vat/proceeds/batches", json={"fileName": f"drill-{TAG}.csv", "rows": [{"line": 2, "date": "2026-09-25", "prcNo": f"PRC/DRILLW/{TAG}", "currency": tgt2["currency"], "fcAmount": 1, "rate": tgt2["rate"],
                                                            "allocations": [{"saleId": tgt2["saleId"], "fcAmount": 1, "basis": "manual"}]}]}) if tgt2 else None
        pvw = pvWrite.json() if pvWrite is not None and pvWrite.status_code == 201 else {}
        check(pvWrite is not None and pvWrite.status_code == 201
              and psql(f"select count(*) from prc_batches where id = '{pvw.get('id')}' and deleted_at is null") == "1"
              and psql(f"select count(*) from sale_realisations where batch_id = '{pvw.get('id')}'") == "1",
              f"and writes land in the table on the upgraded database ({pvWrite.status_code if pvWrite is not None else '-'})")

        # …and the drawback claims — the last compat documents. A database written before the port holds them
        # inside compat_state and no rows in `drawback_claims`. What has to survive the round trip is the
        # register with its totals and its CSV, one claim by number (paid, with its history), the bond view's
        # "on a claim" state that reads them through the mirror, and the write paths against the drill's own
        # synthetic draft.
        print("\nR6.5: upgrading a pre-port database moves the drawback claims into their table")

        def cl_counts():
            return (psql("select count(*) from drawback_claims where deleted_at is null"),
                    psql("select count(*) from audit_events where entity = 'drawbackClaim'"))

        def cl_registers():
            """The claim surface — with the drill's own draft filtered out, so the sides compare."""
            reg = arif.get(f"{BASE}/vat/drawback-claims").json()
            reg["rows"] = [r for r in reg.get("rows", []) if r.get("id") != DRILL_CLAIM_ID]
            filed = arif.get(f"{BASE}/vat/drawback-claims", params={"status": "filed"}).json()
            filed["rows"] = [r for r in filed.get("rows", []) if r.get("id") != DRILL_CLAIM_ID]
            return {"reg": reg, "filed": filed,
                    "csv": "\n".join(l for l in arif.get(f"{BASE}/vat/drawback-claims", params={"format": "csv"}).text.splitlines() if "DBK-09269999" not in l),
                    "one": arif.get(f"{BASE}/vat/drawback-claims/DBK-11250001").json(),
                    "bond": arif.get(f"{BASE}/vat/bond", params={"view": "drawback"}).json()}

        def cl_boots():
            """How many boots adopted the claims — one `R6.5 upgrade:` line mentioning them each."""
            if not API_LOG or not os.path.exists(API_LOG):
                return None
            with open(API_LOG, encoding="utf-8", errors="replace") as fh:
                return sum(1 for line in fh if "R6.5 upgrade:" in line and "drawback claims" in line)

        clc, clbefore, clboots = cl_counts(), cl_registers(), cl_boots()
        ensure_compat_state(); psql(PRE_R65B_CLAIMS)
        psql("delete from drawback_claims")
        check(cl_counts() == ("0", clc[1])
              and psql("select count(*) from compat_state where data->'db' ? 'drawbackClaims'") == "1",
              f"the database is back in the pre-port shape ({clc[0]} drawback claims inside the snapshot, the "
              f"table empty, one synthetic draft beside them, the audit trail untouched where it was)")
        restart()
        check(cl_counts() == (str(int(clc[0]) + 1), clc[1]),
              f"the first boot moved every claim into the table ({clc[0]} claims + the drill's own draft)")
        check(psql(COMPAT_GONE) == "t",
              "…and dropped the snapshot table — the rows are the only copy")
        check(cl_registers() == clbefore,
              "…and serves the same answers: the register and its totals, the filed filter, the CSV, the paid "
              "claim by number and the bond view's drawback state that reads the claims through the mirror")
        clboots_after, clnow = cl_boots(), cl_counts()
        restart()
        check(cl_counts() == clnow and (clboots is None or clboots_after == clboots + 1)
              and (clboots is None or cl_boots() == clboots_after),
              "a second boot adopts nothing again — the table is the only copy from then on")
        # the synthetic draft came along: file it (its line's window is open), then delete a fresh draft —
        # both write paths against a claim the old code could have left behind
        drFile = arif.post(f"{BASE}/vat/drawback-claims/{DRILL_CLAIM_ID}/action", json={"action": "file", "date": "2026-09-25", "ref": "DEDO/DRILL/1"})
        check(drFile.status_code == 200 and drFile.json().get("status") == "filed"
              and psql(f"select count(*) from drawback_claims where id = '{DRILL_CLAIM_ID}' and status = 'filed' and dedo_ref = 'DEDO/DRILL/1' and history->-1->>'action' = 'submitted'") == "1",
              "and the drill's draft runs the ported write paths: filed with the DEDO reference, stamped on the row")
        clRows = arif.get(f"{BASE}/vat/bond", params={"view": "drawback"}).json().get("drawback", {}).get("rows", [])
        clFree = next((r["saleId"] for r in clRows if r.get("state") != "lapsed" and not r.get("claim")), None)
        clWrite = arif.post(f"{BASE}/vat/drawback-claims", json={"saleIds": [clFree]}) if clFree else None
        clw = clWrite.json() if clWrite is not None and clWrite.status_code == 201 else {}
        check(clWrite is not None and clWrite.status_code == 201
              and psql(f"select count(*) from drawback_claims where id = '{clw.get('id')}' and deleted_at is null") == "1",
              f"and writes land in the table on the upgraded database ({clWrite.status_code if clWrite is not None else '-'})")
        clDel = arif.delete(f"{BASE}/vat/drawback-claims/{clw.get('id')}") if clw.get("id") else None
        check(clDel is not None and clDel.status_code == 200
              and psql(f"select count(*) from drawback_claims where id = '{clw.get('id')}' and deleted_at is not null") == "1"
              and all(r.get("id") != clw.get("id") for r in arif.get(f"{BASE}/vat/drawback-claims").json().get("rows", [])),
              "…and a deleted draft is stamped, not removed — the register no longer lists it, and its exports are claimable again")

        # ── R7.1: the NBR tariff import ───────────────────────────────────────────────────────────
        print("\nR7.1: the NBR tariff import")
        before = admin.get(f"{BASE}/tariff").json()
        bad = admin.post(f"{BASE}/tariff/import", json={"fiscalYear": "2098-99", "dryRun": True, "rows": [
            {"hsCode": "123", "description": "bad HS code"},
            {"hsCode": "61091000", "description": "T-shirts, singlets and other vests, knitted, of cotton", "cd": 25, "vat": 15, "ait": 5, "rd": 3},
            {"hsCode": "61091000", "description": "duplicate HS in the file", "cd": 25, "vat": 15},
            {"hsCode": "61109100", "description": "x"},
        ]})
        badj = bad.json()
        check(bad.status_code == 200 and badj.get("dryRun") is True and badj.get("valid") == 1
              and {x["field"] for x in badj.get("issues", [])} == {"hsCode", "description"}
              and psql("select value from meta where key = 'tariff_fy'") == "2026-27",
              "R7.1: a dry run reports every issue (bad HS, duplicate, short description) and applies nothing")
        check(admin.post(f"{BASE}/tariff/import", json={"fiscalYear": "2098-99", "dryRun": False, "rows": [
            {"hsCode": "1", "description": "x"}]}).status_code == 422,
              "R7.1: an apply with any issue is refused (all-or-nothing)")
        check(session("kamal").post(f"{BASE}/tariff/import", json={"fiscalYear": "2098-99", "dryRun": True, "rows": [
            {"hsCode": "61091000", "description": "T-shirts, knitted, of cotton"}]}).status_code == 403,
              "R7.1: the import needs master.edit (an operator is refused)")
        sample = admin.get(f"{BASE}/tariff/sample")
        check(sample.status_code == 200 and sample.text.startswith("hsCode,description,cd,sd,vat,ait,rd,at")
              and len(sample.text.strip().splitlines()) == 3, "R7.1: the template CSV carries the header and two example lines")
        good = [{"hsCode": "61091000", "description": "T-shirts, singlets and other vests, knitted, of cotton", "cd": 25, "sd": 0, "vat": 15, "ait": 5, "rd": 3, "at": 0},
                {"hsCode": "52062300", "description": "Woven fabrics of synthetic staple fibres, dyed", "cd": 10, "sd": 0, "vat": 15, "ait": 5, "rd": 3, "at": 0}]
        ap = admin.post(f"{BASE}/tariff/import", json={"fiscalYear": "2098-99", "dryRun": False, "rows": good})
        apj = ap.json()
        check(ap.status_code == 201 and apj.get("applied") == 2 and apj.get("activeFy") == "2098-99"
              and apj.get("summary", {}).get("added") == 2 and apj.get("summary", {}).get("removed") == 0,
              f"R7.1: a clean file replaces its fiscal year and makes it the active one "
              f"(got {ap.status_code}: {json.dumps(apj)[:180]})")
        tl = admin.get(f"{BASE}/tariff").json()
        check(tl.get("fy") == "2098-99" and tl.get("total") == 2, "R7.1: the register now serves the imported year")
        hs = admin.get(f"{BASE}/tariff", params={"hs": "61091000"}).json()
        check(hs.get("tti") == 52.2 and hs.get("chapter") == "61", "R7.1: an HS lookup answers with the computed TTI (NBR method)")
        if DB_URL:
            check(psql("select count(*) from tariff_lines where fy = '2098-99'") == "2"
                  and psql("select count(*) from tariff_lines where fy = '2026-27'") == str(before.get("total")),
                  "R7.1: the year's rows are rows in tariff_lines — the old year kept beside the new")
            check(psql("select value from meta where key = 'tariff_fy'") == "2098-99",
                  "R7.1: meta.tariff_fy switched — no snapshot anywhere")
        again = admin.post(f"{BASE}/tariff/import", json={"fiscalYear": "2098-99", "dryRun": True, "rows": good}).json()
        check(again.get("summary", {}).get("added") == 0 and again.get("summary", {}).get("unchanged") == 2
              and again.get("summary", {}).get("removed") == 0,
              "R7.1: re-importing the same file previews as unchanged")
        auditT = admin.get(f"{BASE}/audit", params={"entity": "tariff", "size": 5}).json()
        check(auditT.get("total", 0) >= 1 and (auditT.get("data") or [{}])[0].get("action") == "imported",
              "R7.1: the import is one audit event on the audit trail (entity tariff)")
        # a smaller file for the OLD year: its rows replace (the omitted 65 are removed), and the year switches back
        back = admin.post(f"{BASE}/tariff/import", json={"fiscalYear": "2026-27", "dryRun": False, "rows": [
            {"hsCode": "52052300", "description": "Woven fabrics of synthetic staple fibres, combed, dyed", "cd": 5, "vat": 15, "ait": 5, "rd": 0}]}).json()
        check(back.get("activeFy") == "2026-27" and back.get("summary", {}).get("removed") == before.get("total") - 1
              and admin.get(f"{BASE}/tariff", params={"hs": "52052300"}).json().get("cd") == 5,
              "R7.1: re-importing an older year replaces its rows and switches the app back to it")

        # ── the finale: compat_state itself is gone ───────────────────────────────────────────────
        print("\nFinale: the compat snapshot — read ids on the user's row, the table dropped")
        check(psql(COMPAT_GONE) == "t", "the drained snapshot table is gone after the boots above")

        # marking notifications read is a write to the user's own row now — no snapshot involved
        nn = arif.get(f"{BASE}/notifications").json()
        nid = next((x["id"] for x in nn.get("items", []) if not x.get("read")), None)
        unread = nn.get("unread", 0)
        rr = arif.post(f"{BASE}/notifications/read", json={"ids": [nid]}) if nid else None
        check(rr is not None and rr.status_code == 200 and rr.json().get("unread") == unread - 1,
              "marking a notification read answers with one fewer unread")
        check(nid is not None and psql(f"select count(*) from users where username = 'arif' and notif_read ? '{nid}'") == "1",
              "…and the read id lands on the user's own row")
        restart()
        check(arif.get(f"{BASE}/notifications").json().get("unread") == unread - 1,
              "…and survives the restart — users.notif_read is the durable copy")

        # a database written before the finale carries the read ids inside compat_state and no notif_read
        # column. Rewind both — drop the column, un-apply 0023, put the read ids back in the snapshot — and
        # the next boot has to run the migration again, lift the ids out onto the rows, and drop the table.
        aid = psql("select id from users where username = 'arif'")
        # everything arif has already read rides along in the rewound snapshot — the pre-finale writer saved
        # the whole map after every request, so a drill that keeps only the ids it cares about would let
        # notifications the suite read earlier pop back up as unread and fail the round-trip check below
        have = json.loads(psql("select notif_read::text from users where username = 'arif'") or "[]")
        check(int(psql("select count(*) from drizzle.__drizzle_migrations")) == 24, "24 migrations have run on this database")
        last = psql("select hash from drizzle.__drizzle_migrations order by created_at desc limit 1")
        psql(f"delete from drizzle.__drizzle_migrations where hash = '{last}'")
        psql("alter table users drop column notif_read")
        ensure_compat_state()
        ids = [*have, "finale:migrated"]
        psql("update compat_state set data = jsonb_set(data, '{notifRead}', "
             f"jsonb_build_object('{aid}', jsonb_build_object('ids', '{json.dumps(ids)}'::jsonb))) where key = 'main'")
        restart()
        check(psql("select count(*) from information_schema.columns where table_name = 'users' and column_name = 'notif_read'") == "1",
              "the rewound boot re-ran the 0023 migration: the column is back")
        check(psql(f"select count(*) from users where username = 'arif' and notif_read ? 'finale:migrated'") == "1"
              and psql(f"select count(*) from users where username = 'arif' and notif_read ? '{nid}'") == "1",
              "…and it lifted the read ids out of the rewound snapshot onto the row")
        check(psql(COMPAT_GONE) == "t", "…and the boot dropped the drained table after adopting it")
        nn3 = arif.get(f"{BASE}/notifications").json()
        check(nn3.get("unread") == unread - 1,
              f"…nothing lost on the upgrade: the read ids survived the round trip "
              f"(unread {nn3.get('unread')} vs {unread - 1}, ids {psql('select notif_read::text from users where username = ' + chr(39) + 'arif' + chr(39))})")

        # a backup taken before the finale still carries compat_state. Restoring it must land its rows,
        # lift the read ids onto the users' rows (the pre-finale users have no notif_read column), and end
        # with the child boot dropping the table again — the same drain, from the backup path.
        restore_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "dist", "restore.js")
        old = json.loads(_gz.decompress(admin.get(f"{BASE}/backups/{bid}").content))
        adm_id = psql("select id from users where username = 'admin'")
        for u in old["tables"].get("users", []):
            u.pop("notif_read", None)
        old["tables"]["compat_state"] = [{"key": "main", "updated_at": "2026-01-01T00:00:00.000Z",
                                          "data": {"db": {}, "notifRead": {adm_id: {"ids": ["finale:restore"]}}}}]
        blob = _gz.compress(json.dumps(old).encode())
        # the blob is too big for a single argv string (the kernel caps one at 128 KB) — feed it as a file
        sql_path = f"/tmp/finale_backup_{TAG}.sql"
        with open(sql_path, "w") as fh:
            fh.write("insert into backups (kind, slot, by, size, sha256, tables, data) values "
                     f"('manual', 'finale-drill-{TAG}', 'drill', {len(blob)}, '{hashlib.sha256(blob).hexdigest()}', '{{}}', "
                     f"'\\x{blob.hex()}'::bytea)")
        subprocess.run(["psql", DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-f", sql_path], check=True, capture_output=True)
        os.remove(sql_path)
        obid = "bk" + psql("select max(id) from backups")
        ftarget = DB_URL.split("?")[0].rsplit("/", 1)[0] + f"/dizivat_finale_{TAG}"
        fr = subprocess.run(["node", restore_js, "--source", DB_URL, "--id", obid, "--target", ftarget, "--create",
                             "--admin-password", f"Finale-{TAG}-pw", "--boot"], capture_output=True, text=True, timeout=600)
        check(fr.returncode == 0, "restoring a backup that still carries compat_state passes"
              + ("" if fr.returncode == 0 else " — " + (fr.stderr or fr.stdout)[-300:]))
        tgt = lambda q: subprocess.run(["psql", ftarget, "-At", "-c", q], capture_output=True, text=True, check=True).stdout.strip()
        check(tgt("select count(*) from users where notif_read ? 'finale:restore'") == "1",
              "the restored copy lifted the backup's read ids onto the users' rows")
        check(tgt(COMPAT_GONE) == "t", "…and its boot dropped the drained compat_state the backup still carried")
        psql(f"delete from backups where slot = 'finale-drill-{TAG}'")
        subprocess.run(["psql", DB_URL.split("?")[0].rsplit("/", 1)[0] + "/postgres", "-At", "-c",
                        f"drop database if exists dizivat_finale_{TAG}"], capture_output=True)
        check(psql(f"select count(*) from pg_database where datname = 'dizivat_finale_{TAG}'") == "0",
              "…and the drill database is cleaned up")

    else:
        skipped("restart checks (API_RESTART_CMD not set)")

    print(f"\n{ok} passed, {fail} failed, {skip} skipped")
    if fail:
        annotate("error", "api_native", f"{fail} of {ok + fail} checks failed")
    return fail == 0


if __name__ == "__main__":
    try:
        sys.exit(0 if run() else 1)
    except SystemExit:
        raise  # the suite's own verdict, not a crash
    except BaseException as e:  # a crash must be as readable as a failed check
        import traceback
        tb = traceback.format_exc()
        print(tb)
        annotate("error", f"api_native crashed: {type(e).__name__}", tb[-1800:])
        sys.exit(1)
