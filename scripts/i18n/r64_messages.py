"""R6.4 message additions (en + bn): bond consumption register + duty drawback. Deep-merges into src/messages/{en,bn}.json."""
import json, sys
from pathlib import Path

EN = {
 "nav": {"bondRegister": "Bond consumption register"},
 "comp": {"r": {"bond": "Bond consumption register", "bondHint": "Bonded inputs vs exports, BoE ageing, duty drawback"}},
 "imports": {
  "field": {"bonded": "Imported under bond (IM-7 warehousing entry)"},
  "hint": {"bonded": "Duty and VAT are suspended under the customs bond: nothing is payable or creditable now, and the goods must leave the bond inside exports within 24 months. The assessed duty is kept as duty foregone in the bond register."},
  "sum": {"foregone": "Duty foregone (under bond)"},
  "bondedHint": "Bonded entry: the duty stack is assessed for the bond register only — the landed cost is the assessable value and no input tax is claimed (Mushak 9.1 note 11).",
  "bondedBadge": "Under bond · duty foregone ৳ {amount}",
 },
 "bond": {
  "title": "Bond consumption register",
  "subtitle": "Inputs warehoused under the customs bond against their use in exports through the input–output coefficient (BOM), each Bill of Entry aged against the bonding period, and the duty drawback still open on duty-paid inputs (Customs Act s.114).",
  "error": "Could not load the bond register",
  "daysLeft": "{days} days left",
  "daysAgo": "{days} days ago",
  "boeAttention": "Bills of Entry need attention",
  "noCoefficient": "{n, plural, one {# export line has} other {# export lines have}} no approved BOM on the export date, so its input consumption is not counted: {items}.",
  "csv": {"register": "Register CSV", "lots": "Bills of Entry CSV", "drawback": "Drawback CSV"},
  "licence": {
   "title": "Bond licence", "no": "Licence", "expiry": "Valid until",
   "note": "Renew the licence every two years. A direct garment exporter needs no annual entitlement: imports follow each UD and its master LC, and the Bond Commissionerate settles the UD after export and audits this register every year.",
   "state": {"valid": "Valid", "expiring": "Renewal due", "expired": "Expired", "missing": "Not recorded"},
  },
  "totals": {
   "secured": "Duty secured by the bond", "securedHint": "On the bonded balance of {n, plural, one {# input} other {# inputs}}",
   "atRisk": "Duty at risk", "atRiskHint": "{n, plural, one {# input} other {# inputs}} short of the book balance, plus Bills of Entry past the extension",
   "boe": "Bills of Entry to act on", "boeHint": "{expiring} expiring · {extension} in extension · {overdue} overdue",
   "drawback": "Drawback still claimable", "drawbackHint": "৳ {amount} must be claimed within 30 days",
  },
  "range": {"title": "Period", "from": "From", "to": "To", "apply": "Apply", "reset": "Reset", "asOfToday": "Balances as of today, compared with stock on hand.", "asOf": "Balances as of {date}. Stock on hand is only compared when the period ends today."},
  "tab": {"register": "Register", "boe": "Bills of Entry", "drawback": "Duty drawback"},
  "reg": {
   "table": "Bond register by input", "item": "Input", "opening": "Bonded opening", "bondedIn": "Bonded receipts", "exportUse": "Used in exports (bonded)",
   "closing": "Bonded balance", "physical": "Stock on hand", "duty": "Duty on balance", "status": "Status",
   "metBy": "of {total} consumed · {paid} duty-paid · {local} local",
   "unsourced": "{qty} not covered by any receipt",
   "shortfall": "Short by {qty}", "atRisk": "At risk",
   "state": {"ok": "In balance", "shortfall": "Shortfall", "overUsed": "Over-consumed", "idle": "Not bonded"},
   "empty": "No bonded inputs", "emptyHint": "Mark an import as \"Imported under bond\" to start the register.",
   "note": "Consumption = exports (direct and deemed) × the gross quantity of each input in the BOM in force on the export date. Exports use bonded stock first (oldest Bill of Entry first), then duty-paid imports, then local stock. A shortfall means the bond book shows more than the stock on hand — the Bond Commissionerate charges full duty on it at the audit. Duty-paid and local inputs are listed too (s.114(3)).",
  },
  "boe": {
   "table": "Bonded Bills of Entry", "boe": "Bill of Entry", "item": "Input", "qty": "Bonded", "consumed": "Consumed", "balance": "Balance", "duty": "Duty on balance",
   "of": "of", "due": "Bonding period ends", "status": "Status", "carried": "{no} (go-live)",
   "extensionUntil": "Extension needed — latest {date}", "overdueSince": "Duty payable since {date}",
   "state": {"open": "Open", "expiring": "Expiring", "extension": "In extension", "overdue": "Overdue", "cleared": "Cleared"},
   "empty": "No bonded Bills of Entry", "emptyHint": "Bonded imports and go-live carry-forwards appear here.",
   "note": "Bonded goods must be exported within {months} months of the Bill of Entry; the Commissioner can extend this by at most {ext} months. A Bill of Entry turns amber {days} days before the end. After the extension the duty on the balance is payable.",
  },
  "db": {
   "table": "Duty drawback by export", "export": "Export", "inputs": "Duty-paid inputs consumed", "inputsSummary": "{n} import lines",
   "cd": "CD", "rd": "RD", "total": "Claimable", "deadline": "Claim by", "status": "Status", "deemed": "deemed export",
   "claimable": "Claimable (open)", "expiring": "Expiring within {days} days", "lapsed": "Lapsed — not claimed in time",
   "state": {"open": "Open", "expiring": "Expiring", "lapsed": "Lapsed"},
   "empty": "No drawback", "emptyHint": "Exports that consumed duty-paid imported inputs appear here.",
   "note": "Customs duty and regulatory duty paid on imported inputs that went into an export are refundable as duty drawback: claim on Mushak-22 at the Duty Exemption & Drawback Office (DEDO) within {months} months of the export. VAT and AT are already input credit in the return, SD on exported inputs is taken back through Mushak 9.1 note 40, and AIT is an income-tax advance, so none of them is counted here.",
  },
 },
}

BN = {
 "nav": {"bondRegister": "বন্ড ব্যবহার রেজিস্টার"},
 "comp": {"r": {"bond": "বন্ড ব্যবহার রেজিস্টার", "bondHint": "বন্ডেড কাঁচামাল বনাম রপ্তানি, বিল অব এন্ট্রির মেয়াদ, শুল্ক প্রত্যর্পণ"}},
 "imports": {
  "field": {"bonded": "বন্ডের অধীনে আমদানি (IM-7 ওয়্যারহাউসিং এন্ট্রি)"},
  "hint": {"bonded": "শুল্ক ও ভ্যাট কাস্টমস বন্ডের অধীনে স্থগিত থাকে: এখন কিছু পরিশোধযোগ্য বা রেয়াতযোগ্য নয়, এবং পণ্য ২৪ মাসের মধ্যে রপ্তানির মাধ্যমে বন্ড থেকে বের হতে হবে। নিরূপিত শুল্ক বন্ড রেজিস্টারে অপরিশোধিত (স্থগিত) শুল্ক হিসেবে থাকে।"},
  "sum": {"foregone": "স্থগিত শুল্ক (বন্ডের অধীনে)"},
  "bondedHint": "বন্ডেড এন্ট্রি: শুল্ক শুধু বন্ড রেজিস্টারের জন্য নিরূপিত — পণ্যের ব্যয় হলো নিরূপিত মূল্য এবং কোনো উপকরণ কর রেয়াত নেওয়া হয় না (মূসক ৯.১ নোট ১১)।",
  "bondedBadge": "বন্ডের অধীনে · স্থগিত শুল্ক ৳ {amount}",
 },
 "bond": {
  "title": "বন্ড ব্যবহার রেজিস্টার",
  "subtitle": "কাস্টমস বন্ডের অধীনে রাখা কাঁচামাল এবং ইনপুট-আউটপুট সহগ (বিওএম) অনুযায়ী রপ্তানিতে তার ব্যবহার, বন্ডিং মেয়াদ অনুযায়ী প্রতিটি বিল অব এন্ট্রির বয়স, এবং শুল্ক-পরিশোধিত কাঁচামালের অনাদায়ী শুল্ক প্রত্যর্পণ (কাস্টমস আইন ধারা ১১৪)।",
  "error": "বন্ড রেজিস্টার লোড করা যায়নি",
  "daysLeft": "আর {days} দিন",
  "daysAgo": "{days} দিন আগে",
  "boeAttention": "বিল অব এন্ট্রিতে মনোযোগ প্রয়োজন",
  "noCoefficient": "{n}টি রপ্তানি লাইনের রপ্তানির তারিখে কোনো অনুমোদিত বিওএম নেই, তাই সেগুলোর কাঁচামাল ব্যবহার গণনা হয়নি: {items}।",
  "csv": {"register": "রেজিস্টার CSV", "lots": "বিল অব এন্ট্রি CSV", "drawback": "প্রত্যর্পণ CSV"},
  "licence": {
   "title": "বন্ড লাইসেন্স", "no": "লাইসেন্স", "expiry": "মেয়াদ",
   "note": "প্রতি দুই বছরে লাইসেন্স নবায়ন করুন। সরাসরি পোশাক রপ্তানিকারকের বার্ষিক প্রাপ্যতা (এনটাইটেলমেন্ট) লাগে না: আমদানি হয় প্রতিটি ইউডি ও তার মাস্টার এলসি অনুযায়ী, রপ্তানির পর বন্ড কমিশনারেট ইউডি নিষ্পত্তি করে এবং প্রতি বছর এই রেজিস্টার নিরীক্ষা করে।",
   "state": {"valid": "বৈধ", "expiring": "নবায়ন প্রয়োজন", "expired": "মেয়াদোত্তীর্ণ", "missing": "লিপিবদ্ধ নেই"},
  },
  "totals": {
   "secured": "বন্ডে সুরক্ষিত শুল্ক", "securedHint": "{n}টি কাঁচামালের বন্ডেড স্থিতির উপর",
   "atRisk": "ঝুঁকিতে থাকা শুল্ক", "atRiskHint": "{n}টি কাঁচামাল বই-স্থিতির চেয়ে কম, এবং বর্ধিত মেয়াদ পেরোনো বিল অব এন্ট্রি",
   "boe": "ব্যবস্থা নিতে হবে এমন বিল অব এন্ট্রি", "boeHint": "{expiring}টি মেয়াদ শেষের পথে · {extension}টি বর্ধিত মেয়াদে · {overdue}টি মেয়াদোত্তীর্ণ",
   "drawback": "এখনো দাবিযোগ্য প্রত্যর্পণ", "drawbackHint": "৳ {amount} ৩০ দিনের মধ্যে দাবি করতে হবে",
  },
  "range": {"title": "সময়কাল", "from": "হতে", "to": "পর্যন্ত", "apply": "প্রয়োগ", "reset": "রিসেট", "asOfToday": "আজকের স্থিতি, মজুদের সাথে তুলনা করা।", "asOf": "{date} তারিখের স্থিতি। সময়কাল আজ শেষ হলেই কেবল মজুদের সাথে তুলনা হয়।"},
  "tab": {"register": "রেজিস্টার", "boe": "বিল অব এন্ট্রি", "drawback": "শুল্ক প্রত্যর্পণ"},
  "reg": {
   "table": "কাঁচামাল অনুযায়ী বন্ড রেজিস্টার", "item": "কাঁচামাল", "opening": "বন্ডেড প্রারম্ভিক", "bondedIn": "বন্ডেড প্রাপ্তি", "exportUse": "রপ্তানিতে ব্যবহৃত (বন্ডেড)",
   "closing": "বন্ডেড স্থিতি", "physical": "হাতে মজুদ", "duty": "স্থিতির উপর শুল্ক", "status": "অবস্থা",
   "metBy": "মোট {total} ব্যবহৃত · {paid} শুল্ক-পরিশোধিত · {local} স্থানীয়",
   "unsourced": "{qty} কোনো প্রাপ্তি দিয়ে আচ্ছাদিত নয়",
   "shortfall": "{qty} ঘাটতি", "atRisk": "ঝুঁকিতে",
   "state": {"ok": "সমন্বিত", "shortfall": "ঘাটতি", "overUsed": "অতিরিক্ত ব্যবহার", "idle": "বন্ডেড নয়"},
   "empty": "কোনো বন্ডেড কাঁচামাল নেই", "emptyHint": "রেজিস্টার শুরু করতে কোনো আমদানিকে \"বন্ডের অধীনে আমদানি\" হিসেবে চিহ্নিত করুন।",
   "note": "ব্যবহার = রপ্তানি (সরাসরি ও প্রচ্ছন্ন) × রপ্তানির তারিখে কার্যকর বিওএম-এ প্রতিটি কাঁচামালের মোট পরিমাণ। রপ্তানিতে প্রথমে বন্ডেড মজুদ (পুরোনো বিল অব এন্ট্রি আগে), তারপর শুল্ক-পরিশোধিত আমদানি, তারপর স্থানীয় মজুদ ব্যবহৃত হয়। ঘাটতি মানে বন্ড বইয়ে হাতে থাকা মজুদের চেয়ে বেশি দেখাচ্ছে — নিরীক্ষায় বন্ড কমিশনারেট এর উপর পূর্ণ শুল্ক আদায় করে। শুল্ক-পরিশোধিত ও স্থানীয় কাঁচামালও তালিকাভুক্ত (ধারা ১১৪(৩))।",
  },
  "boe": {
   "table": "বন্ডেড বিল অব এন্ট্রি", "boe": "বিল অব এন্ট্রি", "item": "কাঁচামাল", "qty": "বন্ডেড", "consumed": "ব্যবহৃত", "balance": "স্থিতি", "duty": "স্থিতির উপর শুল্ক",
   "of": "মোট", "due": "বন্ডিং মেয়াদ শেষ", "status": "অবস্থা", "carried": "{no} (চালুকালীন)",
   "extensionUntil": "মেয়াদ বৃদ্ধি প্রয়োজন — সর্বশেষ {date}", "overdueSince": "{date} থেকে শুল্ক পরিশোধযোগ্য",
   "state": {"open": "চলমান", "expiring": "মেয়াদ শেষের পথে", "extension": "বর্ধিত মেয়াদে", "overdue": "মেয়াদোত্তীর্ণ", "cleared": "নিষ্পন্ন"},
   "empty": "কোনো বন্ডেড বিল অব এন্ট্রি নেই", "emptyHint": "বন্ডেড আমদানি ও চালুকালীন জের এখানে দেখা যাবে।",
   "note": "বিল অব এন্ট্রির {months} মাসের মধ্যে বন্ডেড পণ্য রপ্তানি করতে হবে; কমিশনার সর্বোচ্চ {ext} মাস বাড়াতে পারেন। মেয়াদ শেষের {days} দিন আগে বিল অব এন্ট্রি হলুদ হয়। বর্ধিত মেয়াদের পর স্থিতির উপর শুল্ক পরিশোধযোগ্য।",
  },
  "db": {
   "table": "রপ্তানি অনুযায়ী শুল্ক প্রত্যর্পণ", "export": "রপ্তানি", "inputs": "ব্যবহৃত শুল্ক-পরিশোধিত কাঁচামাল", "inputsSummary": "{n}টি আমদানি লাইন",
   "cd": "সিডি", "rd": "আরডি", "total": "দাবিযোগ্য", "deadline": "দাবির শেষ তারিখ", "status": "অবস্থা", "deemed": "প্রচ্ছন্ন রপ্তানি",
   "claimable": "দাবিযোগ্য (চলমান)", "expiring": "{days} দিনের মধ্যে মেয়াদ শেষ", "lapsed": "তামাদি — সময়মতো দাবি করা হয়নি",
   "state": {"open": "চলমান", "expiring": "মেয়াদ শেষের পথে", "lapsed": "তামাদি"},
   "empty": "কোনো প্রত্যর্পণ নেই", "emptyHint": "শুল্ক-পরিশোধিত আমদানিকৃত কাঁচামাল ব্যবহার করা রপ্তানি এখানে দেখা যাবে।",
   "note": "রপ্তানিতে ব্যবহৃত আমদানিকৃত কাঁচামালের উপর পরিশোধিত কাস্টমস শুল্ক ও রেগুলেটরি শুল্ক শুল্ক প্রত্যর্পণ হিসেবে ফেরতযোগ্য: রপ্তানির {months} মাসের মধ্যে শুল্ক রেয়াত ও প্রত্যর্পণ পরিদপ্তরে (ডেডো) মূসক-২২ ফরমে দাবি করুন। ভ্যাট ও এটি রিটার্নে উপকরণ কর রেয়াত হিসেবে নেওয়া হয়, রপ্তানিকৃত কাঁচামালের সম্পূরক শুল্ক মূসক ৯.১ নোট ৪০-এ ফেরত নেওয়া হয়, এবং এআইটি আয়করের অগ্রিম — তাই এগুলো এখানে গণনা হয় না।",
  },
 },
}

def merge(dst, src, path=""):
    for k, v in src.items():
        if isinstance(v, dict):
            if k in dst and not isinstance(dst[k], dict): sys.exit(f"conflict at {path}.{k}")
            merge(dst.setdefault(k, {}), v, f"{path}.{k}")
        else:
            dst[k] = v

def keys(o, p=""):
    out = set()
    for k, v in o.items():
        out |= keys(v, f"{p}.{k}") if isinstance(v, dict) else {f"{p}.{k}"}
    return out

assert keys(EN) == keys(BN), (keys(EN) ^ keys(BN))
root = Path(__file__).resolve().parents[2] / "src/messages"
for name, add in (("en", EN), ("bn", BN)):
    f = root / f"{name}.json"
    d = json.loads(f.read_text())
    merge(d, add)
    f.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
en, bn = (json.loads((root / f"{n}.json").read_text()) for n in ("en", "bn"))
diff = keys(en) ^ keys(bn)
print("parity ok" if not diff else f"parity diff: {sorted(diff)[:20]}")
