"""R6.5 message additions (en + bn): own UD / UP bond settlement + duty-drawback claims. Deep-merges into src/messages/{en,bn}.json."""
import json, sys
from pathlib import Path

EN = {
 "comp": {"r": {"bondHint": "Bonded inputs vs exports, UD settlement, drawback claims"}},
 "audit": {"entity": {"bondUd": "Own UD / UP", "drawbackClaim": "Drawback claim"}},
 "validation": {
  "unknownUd": "No UD / UP with this number is on file — add it under Bond consumption → UD settlement",
  "settledUd": "This UD / UP is already settled — documents can no longer be added to it",
 },
 "imports": {"field": {"udNo": "Imported against our UD / UP"}, "noUd": "Not linked to a UD / UP"},
 "rmg": {
  "ownUdNo": "Shipped under our UD / UP",
  "ownUdHint": "The bonded inputs of this order are settled against it after export.",
  "ownUdNone": "Not linked",
 },
 "bond": {
  "tab": {"uds": "UD settlement", "claims": "Drawback claims"},
  "reg": {"clearedOut": "{qty} cleared on duty at UD settlement"},
  "boe": {"cleared": "{qty} cleared on duty"},
  "db": {"claimed": "On drawback claims", "pick": "Select", "pickOne": "Select export {no} for a claim"},
 },
 "budr": {
  "crumb": "UD settlement",
  "error": "Could not load the UD settlement register",
  "intro": "Our own UDs (BGMEA / BKMEA) and UPs (Bond Commissionerate): what each brought in under bond, what its exports consumed and what is left to settle.",
  "csv": "Settlement CSV", "new": "New UD / UP", "table": "Our UDs and UPs",
  "tot": {"ready": "Ready to settle", "inProgress": "In progress", "dutyOnBalance": "Duty on balances to settle", "dutyPaid": "Duty paid at settlement ({n, plural, one {# UD} other {# UDs}} settled)"},
  "col": {"ud": "UD / UP", "shipped": "Shipped", "inputs": "Bonded inputs", "duty": "Duty on balance", "status": "Status"},
  "expiry": "Expires {date}",
  "lineSummary": "{imp} in · {used} used · {bal} left {uom}",
  "excess": "{qty} {uom} imported beyond the UD",
  "paid": "Duty paid",
  "state": {"inProgress": "In progress", "ready": "Ready to settle", "settled": "Settled"},
  "warn": {"excessImport": "Imports beyond the UD", "noCoefficient": "Export without a BOM", "draftExports": "Draft exports", "expired": "Expired", "overShipped": "Shipped beyond the order"},
  "warnLong": {
   "excessImport": "More was imported than the UD permits — the excess attracts full duty unless the UD is amended.",
   "noCoefficient": "An export under this UD has no approved BOM on its date, so its input consumption is not counted.",
   "draftExports": "{drafts, plural, one {# draft export invoice quotes} other {# draft export invoices quote}} this UD — approve or cancel before settlement.",
   "expired": "The UD expired on {date}; settle it with the Bond Commissionerate.",
   "overShipped": "More garments were shipped than the order lists.",
  },
  "issuer": {"BGMEA": "BGMEA", "BKMEA": "BKMEA", "Customs": "Bond Commissionerate"},
  "kind": {"UD": "Utilization Declaration (UD)", "UP": "Utilization Permission (UP)"},
  "empty": "No UDs or UPs yet", "emptyHint": "Add the UD of each export order to settle its bonded inputs after shipment.",
  "note": "Customs settles each UD after the last shipment (or expiry): inputs imported against it vs its exports × the BOM coefficient. A balance is carried to another UD or cleared on payment of duty; imports beyond the UD quantity attract duty.",
  "back": "Back to UD settlement", "notFound": "UD / UP not found",
  "detailSub": "{kind} · {issuer} · export LC {lc} · {buyer}",
  "edit": "Edit", "settle": "Record settlement",
  "notReady": "Shipped {pct} % of the order. The UD can be settled after the last shipment or once it expires on {date}.",
  "warnings": "Warnings",
  "shipments": "Order and shipments", "deemed": "deemed",
  "settledTitle": "Settled on {date}", "settledRef": "Bond Commissionerate ref. {ref} · recorded by {by}", "paymentRef": "duty paid under {ref}",
  "clearedOnDuty": "{qty} {uom} cleared on duty (৳ {amount})", "carriedTo": "{qty} {uom} carried to {to}",
  "dutyPaidTotal": "Duty paid on settlement:",
  "tabStatement": "Settlement statement", "tabHistory": "History",
  "settleTitle": "Settle {no}",
  "settleBody": "Dispose of every left-over balance: clear it on payment of duty and / or carry it to another of our open UDs that lists the input. The statement is frozen when you save.",
  "settleBodyNothing": "Nothing is left over — the exports consumed all the inputs brought in under this UD. Record the Bond Commissionerate's settlement.",
  "settledToast": "{no} settled",
  "f": {
   "date": "Settlement date", "bondRef": "Bond Commissionerate reference", "bondRefHint": "Settlement letter / memo number",
   "lineLegend": "{name} — balance {qty} {uom}", "dutyPaidQty": "Clear on duty", "dutyHint": "Duty ৳ {amount}", "carryQty": "Carry forward", "carryTo": "To UD / UP",
   "noTargets": "No open UD lists this input", "none": "—", "paymentRef": "Customs payment reference", "dutyTotal": "Duty payable on the cleared balance", "note": "Note",
   "kind": "Type", "issuer": "Issued by", "no": "UD / UP no.", "masterLc": "Export LC / sales contract", "udDate": "Date", "expiry": "Expiry", "buyer": "Buyer", "lcValue": "Export LC value (USD)",
   "garments": "Garments to export", "inputs": "Inputs to import under bond", "lineItem": "{what} line {n} item", "lineQty": "{what} line {n} quantity", "removeLine": "Remove {what} line {n}",
   "addLine": "Add line", "pickItem": "Pick an item", "searchItem": "Search items",
  },
  "newTitle": "New UD / UP", "editTitle": "Edit {no}", "formSub": "Our own UD (BGMEA / BKMEA) or UP (Bond Commissionerate) for one export order.",
  "created": "{no} added", "saved": "{no} saved",
  "err": {
   "notReady": "Not ready: settle after the last shipment or once the UD expires", "draftExports": "Draft export invoices quote this UD — approve or cancel them first",
   "afterToday": "Cannot be after today", "beforeUd": "Cannot be before the UD date", "unknownLine": "Not an input of this UD",
   "mustEqualBalance": "Cleared + carried must equal the balance", "noBalance": "Nothing is left over on this input", "carryTarget": "Pick another open UD that lists this input",
   "duplicate": "Already used", "udInUse": "Documents quote this number — it cannot change", "unknownInput": "Pick a raw material, consumable or packing item",
   "unknownGarment": "Pick a finished good", "expiryBeforeDate": "Expiry cannot be before the date", "required": "Required", "positive": "Must be more than 0",
   "atLeastOneLine": "Add at least one line", "min0": "Cannot be negative",
  },
 },
 "claims": {
  "crumb": "Drawback claims",
  "error": "Could not load the drawback claims",
  "selection": "Drawback claim", "selectHint": "Tick open exports to put them on a drawback claim.",
  "selected": "{n, plural, one {# export} other {# exports}} selected · ৳ {amount}",
  "clear": "Clear", "create": "Create claim",
  "created": "Draft claim {no} created", "createFailed": "Could not create the claim: {why}",
  "filter": "Filter by status", "all": "All", "csv": "Claims CSV", "table": "Drawback claims",
  "tot": {"draft": "Drafts", "pending": "Filed, awaiting DEDO", "sanctioned": "Sanctioned, awaiting refund", "refunded": "Refunded", "disallowed": "Disallowed by DEDO"},
  "col": {"claim": "Claim", "exports": "Exports", "claimed": "Claimed", "filed": "Filed", "sanctioned": "Sanctioned", "refunded": "Refunded", "status": "Status"},
  "status": {"draft": "Draft", "filed": "Filed", "sanctioned": "Sanctioned", "paid": "Refunded", "rejected": "Rejected"},
  "fileBy": "File by {date} ({days} days)", "lapsedSince": "Window closed {date}",
  "disallowed": "Disallowed",
  "empty": "No drawback claims", "emptyHint": "Select open exports on the Duty drawback tab to start a claim.",
  "note": "Claim within {months} months of each export at the Duty Exemption & Drawback Office (Mushak-22). A rejected claim frees its exports to be claimed again while their window is open.",
  "back": "Back to claims", "notFound": "Claim not found",
  "detailTitle": "Drawback claim {no}", "detailSub": "{n, plural, one {# export} other {# exports}} · ৳ {amount} claimed (customs + regulatory duty)",
  "summary": "Claim summary", "cdRd": "CD ৳ {cd} · RD ৳ {rd}",
  "rejectedOn": "Rejected on {date}:", "disallowedWhy": "Reason for the disallowance:",
  "tabStatement": "Claim statement", "tabHistory": "History",
  "delete": "Delete draft", "deleteTitle": "Delete {no}?", "deleteBody": "The exports go back to the drawback list; the claim number is not reused.", "deleted": "{no} deleted",
  "action": {"file": "File with DEDO", "sanction": "Record sanction", "pay": "Record refund", "reject": "Record rejection"},
  "done": {"file": "{no} filed", "sanction": "Sanction recorded on {no}", "pay": "Refund recorded on {no}", "reject": "{no} marked rejected"},
  "dialog": {
   "file": {"title": "File {no} with DEDO", "body": "Every export on the claim must still be inside its 6-month window on the filing date.", "date": "Filing date", "ref": "DEDO reference / diary no."},
   "sanction": {"title": "Sanction of {no}", "body": "Record what the Drawback Office sanctioned. Give the reason if it is less than claimed.", "date": "Sanction date", "ref": "Sanction order no.", "amount": "Sanctioned amount (৳)", "amountHint": "Claimed ৳ {amount}", "reason": "Reason for the disallowed part"},
   "pay": {"title": "Refund of {no}", "body": "Record the refund received from the Drawback Office.", "date": "Received on", "ref": "Payment / cheque / EFT reference", "amount": "Amount received (৳)"},
   "reject": {"title": "Rejection of {no}", "body": "Record DEDO's rejection. The exports become claimable again while their window is open.", "date": "Rejection date", "reason": "Reason given by DEDO"},
  },
  "err": {
   "notClaimable": "has no duty-paid inputs to claim", "lapsed": "the 6-month claim window has closed", "alreadyClaimed": "is already on another claim", "duplicate": "is listed twice",
   "afterToday": "Cannot be after today", "beforePrevious": "Cannot be before the previous step", "aboveClaimed": "Cannot exceed the amount claimed",
   "aboveSanctioned": "Cannot exceed the amount sanctioned", "required": "Required",
  },
 },
}

BN = {
 "comp": {"r": {"bondHint": "বন্ডেড উপকরণ বনাম রপ্তানি, ইউডি নিষ্পত্তি, ড্র-ব্যাক দাবি"}},
 "audit": {"entity": {"bondUd": "নিজস্ব ইউডি / ইউপি", "drawbackClaim": "ড্র-ব্যাক দাবি"}},
 "validation": {
  "unknownUd": "এই নম্বরের কোনো ইউডি / ইউপি নথিতে নেই — বন্ড ভোগ → ইউডি নিষ্পত্তিতে যোগ করুন",
  "settledUd": "এই ইউডি / ইউপি ইতিমধ্যে নিষ্পত্তি হয়েছে — এতে আর দলিল যোগ করা যাবে না",
 },
 "imports": {"field": {"udNo": "আমাদের যে ইউডি / ইউপির বিপরীতে আমদানি"}, "noUd": "কোনো ইউডি / ইউপির সাথে যুক্ত নয়"},
 "rmg": {
  "ownUdNo": "আমাদের যে ইউডি / ইউপির অধীনে চালান",
  "ownUdHint": "রপ্তানির পর এই অর্ডারের বন্ডেড উপকরণ এর বিপরীতে নিষ্পত্তি হবে।",
  "ownUdNone": "যুক্ত নয়",
 },
 "bond": {
  "tab": {"uds": "ইউডি নিষ্পত্তি", "claims": "ড্র-ব্যাক দাবি"},
  "reg": {"clearedOut": "ইউডি নিষ্পত্তিতে শুল্ক পরিশোধে খালাস {qty}"},
  "boe": {"cleared": "শুল্ক পরিশোধে খালাস {qty}"},
  "db": {"claimed": "ড্র-ব্যাক দাবিতে অন্তর্ভুক্ত", "pick": "বাছাই", "pickOne": "দাবির জন্য রপ্তানি {no} বাছাই করুন"},
 },
 "budr": {
  "crumb": "ইউডি নিষ্পত্তি",
  "error": "ইউডি নিষ্পত্তি রেজিস্টার লোড করা যায়নি",
  "intro": "আমাদের নিজস্ব ইউডি (বিজিএমইএ / বিকেএমইএ) ও ইউপি (বন্ড কমিশনারেট): প্রতিটির অধীনে বন্ডে কী আনা হয়েছে, রপ্তানিতে কত ভোগ হয়েছে এবং কত নিষ্পত্তি বাকি।",
  "csv": "নিষ্পত্তি CSV", "new": "নতুন ইউডি / ইউপি", "table": "আমাদের ইউডি ও ইউপি",
  "tot": {"ready": "নিষ্পত্তির জন্য প্রস্তুত", "inProgress": "চলমান", "dutyOnBalance": "নিষ্পত্তিযোগ্য অবশিষ্টের শুল্ক", "dutyPaid": "নিষ্পত্তিতে পরিশোধিত শুল্ক ({n, plural, other {# টি ইউডি}} নিষ্পত্তি)"},
  "col": {"ud": "ইউডি / ইউপি", "shipped": "চালান হয়েছে", "inputs": "বন্ডেড উপকরণ", "duty": "অবশিষ্টের শুল্ক", "status": "অবস্থা"},
  "expiry": "মেয়াদ শেষ {date}",
  "lineSummary": "{imp} আনা · {used} ভোগ · {bal} অবশিষ্ট {uom}",
  "excess": "ইউডির অতিরিক্ত আমদানি {qty} {uom}",
  "paid": "পরিশোধিত শুল্ক",
  "state": {"inProgress": "চলমান", "ready": "নিষ্পত্তির জন্য প্রস্তুত", "settled": "নিষ্পত্তি হয়েছে"},
  "warn": {"excessImport": "ইউডির অতিরিক্ত আমদানি", "noCoefficient": "বিওএম ছাড়া রপ্তানি", "draftExports": "খসড়া রপ্তানি", "expired": "মেয়াদোত্তীর্ণ", "overShipped": "অর্ডারের বেশি চালান"},
  "warnLong": {
   "excessImport": "ইউডির অনুমোদনের চেয়ে বেশি আমদানি হয়েছে — ইউডি সংশোধন না হলে অতিরিক্ত অংশে পূর্ণ শুল্ক প্রযোজ্য।",
   "noCoefficient": "এই ইউডির একটি রপ্তানির তারিখে অনুমোদিত বিওএম নেই, তাই এর উপকরণ ভোগ গণনা হয়নি।",
   "draftExports": "{drafts, plural, other {# টি খসড়া রপ্তানি চালান}} এই ইউডি উল্লেখ করেছে — নিষ্পত্তির আগে অনুমোদন বা বাতিল করুন।",
   "expired": "ইউডির মেয়াদ {date} তারিখে শেষ হয়েছে; বন্ড কমিশনারেটে নিষ্পত্তি করুন।",
   "overShipped": "অর্ডারের চেয়ে বেশি পোশাক চালান হয়েছে।",
  },
  "issuer": {"BGMEA": "বিজিএমইএ", "BKMEA": "বিকেএমইএ", "Customs": "বন্ড কমিশনারেট"},
  "kind": {"UD": "ইউটিলাইজেশন ডিক্লারেশন (ইউডি)", "UP": "ইউটিলাইজেশন পারমিশন (ইউপি)"},
  "empty": "এখনো কোনো ইউডি বা ইউপি নেই", "emptyHint": "চালানের পর বন্ডেড উপকরণ নিষ্পত্তির জন্য প্রতিটি রপ্তানি অর্ডারের ইউডি যোগ করুন।",
  "note": "শেষ চালানের (বা মেয়াদ শেষের) পর কাস্টমস প্রতিটি ইউডি নিষ্পত্তি করে: এর বিপরীতে আমদানিকৃত উপকরণ বনাম রপ্তানি × বিওএম সহগ। অবশিষ্ট অংশ অন্য ইউডিতে স্থানান্তর হয় বা শুল্ক পরিশোধে খালাস হয়; ইউডির অতিরিক্ত আমদানিতে শুল্ক প্রযোজ্য।",
  "back": "ইউডি নিষ্পত্তিতে ফিরুন", "notFound": "ইউডি / ইউপি পাওয়া যায়নি",
  "detailSub": "{kind} · {issuer} · রপ্তানি এলসি {lc} · {buyer}",
  "edit": "সম্পাদনা", "settle": "নিষ্পত্তি লিপিবদ্ধ করুন",
  "notReady": "অর্ডারের {pct} % চালান হয়েছে। শেষ চালানের পর বা {date} তারিখে মেয়াদ শেষ হলে ইউডি নিষ্পত্তি করা যাবে।",
  "warnings": "সতর্কতা",
  "shipments": "অর্ডার ও চালান", "deemed": "প্রচ্ছন্ন",
  "settledTitle": "{date} তারিখে নিষ্পত্তি", "settledRef": "বন্ড কমিশনারেট সূত্র {ref} · লিপিবদ্ধ করেছেন {by}", "paymentRef": "শুল্ক পরিশোধ {ref}",
  "clearedOnDuty": "শুল্ক পরিশোধে খালাস {qty} {uom} (৳ {amount})", "carriedTo": "{to}-এ স্থানান্তর {qty} {uom}",
  "dutyPaidTotal": "নিষ্পত্তিতে পরিশোধিত শুল্ক:",
  "tabStatement": "নিষ্পত্তি বিবরণী", "tabHistory": "ইতিহাস",
  "settleTitle": "{no} নিষ্পত্তি",
  "settleBody": "প্রতিটি অবশিষ্ট অংশের ব্যবস্থা নিন: শুল্ক পরিশোধে খালাস এবং / অথবা উপকরণটি তালিকাভুক্ত আমাদের অন্য চলমান ইউডিতে স্থানান্তর। সংরক্ষণ করলে বিবরণী স্থির হয়ে যাবে।",
  "settleBodyNothing": "কিছুই অবশিষ্ট নেই — এই ইউডির অধীনে আনা সব উপকরণ রপ্তানিতে ভোগ হয়েছে। বন্ড কমিশনারেটের নিষ্পত্তি লিপিবদ্ধ করুন।",
  "settledToast": "{no} নিষ্পত্তি হয়েছে",
  "f": {
   "date": "নিষ্পত্তির তারিখ", "bondRef": "বন্ড কমিশনারেট সূত্র", "bondRefHint": "নিষ্পত্তি পত্র / স্মারক নম্বর",
   "lineLegend": "{name} — অবশিষ্ট {qty} {uom}", "dutyPaidQty": "শুল্ক পরিশোধে খালাস", "dutyHint": "শুল্ক ৳ {amount}", "carryQty": "স্থানান্তর", "carryTo": "যে ইউডি / ইউপিতে",
   "noTargets": "কোনো চলমান ইউডিতে এই উপকরণ নেই", "none": "—", "paymentRef": "কাস্টমস পরিশোধ সূত্র", "dutyTotal": "খালাসকৃত অংশে প্রদেয় শুল্ক", "note": "মন্তব্য",
   "kind": "ধরন", "issuer": "ইস্যুকারী", "no": "ইউডি / ইউপি নম্বর", "masterLc": "রপ্তানি এলসি / বিক্রয় চুক্তি", "udDate": "তারিখ", "expiry": "মেয়াদ", "buyer": "ক্রেতা", "lcValue": "রপ্তানি এলসির মূল্য (USD)",
   "garments": "রপ্তানিযোগ্য পোশাক", "inputs": "বন্ডে আমদানিযোগ্য উপকরণ", "lineItem": "{what} সারি {n} পণ্য", "lineQty": "{what} সারি {n} পরিমাণ", "removeLine": "{what} সারি {n} বাদ দিন",
   "addLine": "সারি যোগ করুন", "pickItem": "পণ্য বাছাই করুন", "searchItem": "পণ্য খুঁজুন",
  },
  "newTitle": "নতুন ইউডি / ইউপি", "editTitle": "{no} সম্পাদনা", "formSub": "একটি রপ্তানি অর্ডারের জন্য আমাদের নিজস্ব ইউডি (বিজিএমইএ / বিকেএমইএ) বা ইউপি (বন্ড কমিশনারেট)।",
  "created": "{no} যোগ হয়েছে", "saved": "{no} সংরক্ষিত",
  "err": {
   "notReady": "প্রস্তুত নয়: শেষ চালানের পর বা ইউডির মেয়াদ শেষে নিষ্পত্তি করুন", "draftExports": "খসড়া রপ্তানি চালান এই ইউডি উল্লেখ করেছে — আগে অনুমোদন বা বাতিল করুন",
   "afterToday": "আজকের পরে হতে পারে না", "beforeUd": "ইউডির তারিখের আগে হতে পারে না", "unknownLine": "এই ইউডির উপকরণ নয়",
   "mustEqualBalance": "খালাস + স্থানান্তর অবশিষ্টের সমান হতে হবে", "noBalance": "এই উপকরণে কিছু অবশিষ্ট নেই", "carryTarget": "উপকরণটি তালিকাভুক্ত অন্য একটি চলমান ইউডি বাছাই করুন",
   "duplicate": "ইতিমধ্যে ব্যবহৃত", "udInUse": "দলিলে এই নম্বর উল্লেখ আছে — পরিবর্তন করা যাবে না", "unknownInput": "কাঁচামাল, ভোগ্য বা মোড়ক পণ্য বাছাই করুন",
   "unknownGarment": "তৈরি পণ্য বাছাই করুন", "expiryBeforeDate": "মেয়াদ তারিখের আগে হতে পারে না", "required": "আবশ্যক", "positive": "০-এর বেশি হতে হবে",
   "atLeastOneLine": "অন্তত একটি সারি যোগ করুন", "min0": "ঋণাত্মক হতে পারে না",
  },
 },
 "claims": {
  "crumb": "ড্র-ব্যাক দাবি",
  "error": "ড্র-ব্যাক দাবি লোড করা যায়নি",
  "selection": "ড্র-ব্যাক দাবি", "selectHint": "ড্র-ব্যাক দাবিতে অন্তর্ভুক্ত করতে খোলা রপ্তানিগুলো টিক দিন।",
  "selected": "{n, plural, other {# টি রপ্তানি}} বাছাই · ৳ {amount}",
  "clear": "মুছুন", "create": "দাবি তৈরি করুন",
  "created": "খসড়া দাবি {no} তৈরি হয়েছে", "createFailed": "দাবি তৈরি করা যায়নি: {why}",
  "filter": "অবস্থা অনুযায়ী ছাঁকুন", "all": "সব", "csv": "দাবি CSV", "table": "ড্র-ব্যাক দাবি",
  "tot": {"draft": "খসড়া", "pending": "দাখিলকৃত, ডেডোর অপেক্ষায়", "sanctioned": "মঞ্জুর, ফেরতের অপেক্ষায়", "refunded": "ফেরত পাওয়া", "disallowed": "ডেডো কর্তৃক নামঞ্জুর"},
  "col": {"claim": "দাবি", "exports": "রপ্তানি", "claimed": "দাবিকৃত", "filed": "দাখিল", "sanctioned": "মঞ্জুর", "refunded": "ফেরত", "status": "অবস্থা"},
  "status": {"draft": "খসড়া", "filed": "দাখিলকৃত", "sanctioned": "মঞ্জুর", "paid": "ফেরত পাওয়া", "rejected": "প্রত্যাখ্যাত"},
  "fileBy": "{date}-এর মধ্যে দাখিল করুন ({days} দিন)", "lapsedSince": "সময়সীমা শেষ {date}",
  "disallowed": "নামঞ্জুর",
  "empty": "কোনো ড্র-ব্যাক দাবি নেই", "emptyHint": "দাবি শুরু করতে শুল্ক ড্র-ব্যাক ট্যাবে খোলা রপ্তানি বাছাই করুন।",
  "note": "প্রতিটি রপ্তানির {months} মাসের মধ্যে শুল্ক রেয়াত ও প্রত্যর্পণ পরিদপ্তরে (ডেডো, মূসক-২২) দাবি করুন। প্রত্যাখ্যাত দাবির রপ্তানি সময়সীমার মধ্যে আবার দাবি করা যায়।",
  "back": "দাবিতে ফিরুন", "notFound": "দাবি পাওয়া যায়নি",
  "detailTitle": "ড্র-ব্যাক দাবি {no}", "detailSub": "{n, plural, other {# টি রপ্তানি}} · ৳ {amount} দাবিকৃত (কাস্টমস + রেগুলেটরি শুল্ক)",
  "summary": "দাবির সারসংক্ষেপ", "cdRd": "সিডি ৳ {cd} · আরডি ৳ {rd}",
  "rejectedOn": "{date} তারিখে প্রত্যাখ্যাত:", "disallowedWhy": "নামঞ্জুরের কারণ:",
  "tabStatement": "দাবির বিবরণী", "tabHistory": "ইতিহাস",
  "delete": "খসড়া মুছুন", "deleteTitle": "{no} মুছবেন?", "deleteBody": "রপ্তানিগুলো ড্র-ব্যাক তালিকায় ফিরে যাবে; দাবি নম্বর পুনরায় ব্যবহার হবে না।", "deleted": "{no} মুছে ফেলা হয়েছে",
  "action": {"file": "ডেডোতে দাখিল", "sanction": "মঞ্জুরি লিপিবদ্ধ", "pay": "ফেরত লিপিবদ্ধ", "reject": "প্রত্যাখ্যান লিপিবদ্ধ"},
  "done": {"file": "{no} দাখিল হয়েছে", "sanction": "{no}-এ মঞ্জুরি লিপিবদ্ধ", "pay": "{no}-এ ফেরত লিপিবদ্ধ", "reject": "{no} প্রত্যাখ্যাত হিসেবে চিহ্নিত"},
  "dialog": {
   "file": {"title": "{no} ডেডোতে দাখিল", "body": "দাখিলের তারিখে দাবির প্রতিটি রপ্তানি ৬ মাসের সময়সীমার মধ্যে থাকতে হবে।", "date": "দাখিলের তারিখ", "ref": "ডেডো সূত্র / ডায়েরি নম্বর"},
   "sanction": {"title": "{no}-এর মঞ্জুরি", "body": "প্রত্যর্পণ দপ্তর যা মঞ্জুর করেছে তা লিপিবদ্ধ করুন। দাবির চেয়ে কম হলে কারণ দিন।", "date": "মঞ্জুরির তারিখ", "ref": "মঞ্জুরি আদেশ নম্বর", "amount": "মঞ্জুরকৃত অর্থ (৳)", "amountHint": "দাবিকৃত ৳ {amount}", "reason": "নামঞ্জুর অংশের কারণ"},
   "pay": {"title": "{no}-এর ফেরত", "body": "প্রত্যর্পণ দপ্তর থেকে পাওয়া ফেরত লিপিবদ্ধ করুন।", "date": "প্রাপ্তির তারিখ", "ref": "পরিশোধ / চেক / ইএফটি সূত্র", "amount": "প্রাপ্ত অর্থ (৳)"},
   "reject": {"title": "{no}-এর প্রত্যাখ্যান", "body": "ডেডোর প্রত্যাখ্যান লিপিবদ্ধ করুন। সময়সীমার মধ্যে রপ্তানিগুলো আবার দাবিযোগ্য হবে।", "date": "প্রত্যাখ্যানের তারিখ", "reason": "ডেডোর দেওয়া কারণ"},
  },
  "err": {
   "notClaimable": "দাবিযোগ্য শুল্ক-পরিশোধিত উপকরণ নেই", "lapsed": "৬ মাসের দাবির সময়সীমা শেষ", "alreadyClaimed": "ইতিমধ্যে অন্য দাবিতে আছে", "duplicate": "দুবার তালিকাভুক্ত",
   "afterToday": "আজকের পরে হতে পারে না", "beforePrevious": "আগের ধাপের আগে হতে পারে না", "aboveClaimed": "দাবিকৃত অর্থের বেশি হতে পারে না",
   "aboveSanctioned": "মঞ্জুরকৃত অর্থের বেশি হতে পারে না", "required": "আবশ্যক",
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
