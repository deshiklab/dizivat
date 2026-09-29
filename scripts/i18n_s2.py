"""Sprint 2 catalog additions (en + bn). Deep-merges into src/messages/*.json. Idempotent."""
import json

EN = {
 "roles": {"admin": "Administrator", "approver": "Approver", "operator": "Operator", "viewer": "Viewer"},
 "auth": {
  "noAccessTitle": "You don't have access to this page", "noAccessHint": "Your role doesn't include this action. Ask an administrator if you need it.", "goBack": "Go back",
  "brandPanel": "About DiziVAT", "tagline": "VAT management for Bangladesh manufacturers",
  "hero": "Mushak-ready sales, purchases and stock — in one place.",
  "feature": {"f1": "Mushak 6.3 invoices with VAT, SD and VDS computed for you", "f2": "Input-tax rebate tracked per purchase line for the 9.1 return", "f3": "Every approval and cancellation recorded with who, when and why"},
  "title": "Sign in", "subtitle": "Use your {company} account.",
  "username": "Username", "password": "Password", "forgot": "Forgot? Contact your administrator",
  "showPassword": "Show password", "hidePassword": "Hide password", "capsLock": "Caps Lock is on.",
  "remember": "Keep me signed in for 7 days", "signIn": "Sign in", "signingIn": "Signing in…",
  "required": "Enter your username and password.",
  "invalid": "Incorrect username or password.",
  "invalidLeft": "Incorrect username or password. {count, plural, one {# attempt} other {# attempts}} left before a 1-minute lock.",
  "locked": "Too many failed attempts. Try again in {s} s.",
  "expired": "Your session has ended. Sign in again to continue where you left off.",
  "network": "Couldn't reach the server. Check your connection and try again.",
  "demoTitle": "Demo accounts — click to fill (password: {pw})",
  "footer": "Prototype build · mock data · no real records are changed"
 },
 "cancel": {
  "title": "Cancel {no}?", "bodyApproved": "The document is approved: its stock movement will be reversed and it will drop out of the VAT return. This cannot be undone.",
  "bodyDraft": "The draft will be marked cancelled and kept for the audit trail.",
  "common": "Common reasons", "reason": "Reason for cancellation", "hint": "Shown on the document and in its history.",
  "min": "Enter at least {n} characters.", "keep": "Keep document", "confirm": "Cancel document",
  "preset": {"wrongParty": "Issued to the wrong party — to be re-issued to the correct one.", "wrongQty": "Wrong quantity or price entered — to be re-issued.", "returned": "Goods returned by the buyer before delivery was completed.", "duplicate": "Duplicate entry of an existing document."},
  "presetShort": {"wrongParty": "Wrong party", "wrongQty": "Wrong qty/price", "returned": "Goods returned", "duplicate": "Duplicate"}
 },
 "docs": {
  "approved": "{no} approved", "cancelled": "{no} cancelled", "restored": "{no} restored", "deleted": "Draft {no} deleted", "undo": "Undo",
  "deleteTitle": "Delete draft {no}?", "deleteBody": "The draft is removed from lists. You can undo right after.", "deleteConfirm": "Delete draft", "keep": "Keep it",
  "cancelledBy": "Cancelled by {by} on {when}", "cancelledPlain": "Cancelled", "reason": "Reason",
  "draftNote": "Draft — not yet in stock or the VAT return. Approve it to post.",
  "history": "History", "noHistory": "No recorded activity.",
  "action": {"created": "Created", "edited": "Edited", "approved": "Approved", "cancelled": "Cancelled", "deleted": "Deleted", "restored": "Restored"},
  "edit": "Edit", "delete": "Delete", "approve": "Approve", "cancel": "Cancel…",
  "notFound": "Document not found", "back": "Back to list", "openDoc": "Open document",
  "notEditableTitle": "{no} can't be edited", "notEditableHint": "Only drafts can be edited. Cancel an approved document and issue a new one instead."
 },
 "common": {"edit": "Edit", "delete": "Delete", "deleteDraft": "Delete draft", "close": "Close"},
 "sales": {"editTitle": "Edit {no}", "editSub": "Changes are recorded in the document history.", "draftOnlyHint": "Your role can save drafts; an approver will review and approve them.", "saveChanges": "Save changes"},
 "purchases": {"editTitle": "Edit {no}", "cancelPurchase": "Cancel purchase", "addVendor": "Add new vendor"},
 "shell": {"newCustomer": "New customer", "newVendor": "New vendor"},
 "table": {"viewDeleted": "View “{name}” deleted", "undo": "Undo"},
 "validation": {"bin": "Enter the 13-digit BIN as 000000000-0000.", "nid": "Enter a 10, 13 or 17-digit NID.", "mobile": "Enter a Bangladeshi mobile number, e.g. 01711-000000.", "email": "Enter a valid email address.", "reasonMin": "Enter at least 10 characters."},
 "items": {"ledger": "Stock ledger", "ledgerFor": "Stock ledger for {name}"},
 "ledger": {
  "title": "Stock ledger — {name}", "titlePlain": "Stock ledger", "notFound": "Item not found",
  "opening": "Opening (1 Jul)", "in": "Received", "out": "Issued", "closing": "Closing stock",
  "filter": "Filter movements", "filterBy": {"all": "All", "purchase": "Purchases", "sale": "Sales", "production": "Production", "other": "Opening & damage"},
  "editItem": "Edit item",
  "col": {"date": "Date", "type": "Movement", "ref": "Reference / party", "in": "In", "out": "Out", "balance": "Balance"},
  "type": {"opening": "Opening", "purchase": "Purchase", "sale": "Sale", "prodReceive": "Production in", "prodIssue": "Issued to production", "damage": "Damage / wastage"},
  "summaryRow": "Monthly summary", "monthly": "Monthly total", "empty": "No movements of this type.",
  "footer": "{n} movements; approved documents only.", "summaryNote": "Production and damage rows are monthly totals until the Production module ships (R3)."
 },
 "parties": {
  "created": "{name} added", "updated": "{name} updated", "fixErrors": "Please fix the highlighted fields.",
  "deactivated": "{name} deactivated — hidden from new documents", "activated": "{name} reactivated", "restored": "{name} restored",
  "deleted": "{name} deleted", "undo": "Undo",
  "inUse": "{name} is used on {count, plural, one {# document} other {# documents}} and can't be deleted. Deactivate it instead.",
  "deactivate": "Deactivate", "activate": "Reactivate",
  "deleteTitle": "Delete {name}?", "deleteBody": "It has no documents. You can undo right after.", "deleteConfirm": "Delete",
  "active": "Active", "inactive": "Inactive", "searchPlaceholder": "Search name, BIN, mobile, address…",
  "col": {"name": "Name", "mode": "Type", "bin": "BIN / ref.", "mobile": "Mobile", "address": "Address", "status": "Status"},
  "facet": {"mode": "Type", "status": "Status", "balance": "Balance"},
  "views": {"inactive": "Inactive"},
  "field": {"mode": "Registration type", "name": "Legal name", "bin": "BIN", "foreignRef": "Foreign reference", "nid": "NID (optional)", "country": "Country", "contact": "Contact person", "mobile": "Mobile / phone", "email": "Email", "address": "Address", "active": "Active"},
  "hint": {"name": "As printed on the trade licence; stored in capitals.", "bin": "13 digits, e.g. 000731906-0203.", "foreignRef": "Importer/exporter reference, e.g. EXP-AE-2024-118.", "nid": "Owner's NID — 10, 13 or 17 digits.", "address": "Default delivery address on invoices."},
  "modeLocked": "Type can't change once documents exist — it decides their VAT treatment.",
  "modeHint": {"Local": "VAT-registered in Bangladesh (has a BIN).", "Foreign": "Outside Bangladesh — exports are zero-rated; imports carry TTI.", "NonRegistered": "Not VAT-registered — no input-tax rebate on purchases."},
  "error": {"customerMode": "Customers must be Local or Foreign.", "modeLocked": "Type can't change once documents exist."},
  "nonRegNote": "Purchases from non-registered vendors carry no rebateable VAT (Mushak 6.2 still records them).",
  "customer": {
   "title": "Customers", "subtitle": "Buyers on your Mushak 6.3 invoices", "new": "New customer",
   "summary": "{count} customers · turnover {turnover} · receivable {due}",
   "newTitle": "New customer", "editTitle": "Edit customer", "viewTitle": "Customer", "newSub": "Appears in the customer picker on sales invoices.",
   "foreignNote": "Invoices to foreign customers are zero-rated exports (0% VAT, no VDS).",
   "activeHint": "Inactive customers can't be picked on new invoices; history is kept.",
   "docs": "Invoices", "turnover": "Turnover", "due": "Receivable", "last": "Last invoice", "viewDocs": "View invoices",
   "balance": {"due": "Receivable", "clear": "Settled"},
   "views": {"top": "Top by turnover", "due": "With receivable", "foreign": "Export customers"}
  },
  "vendor": {
   "title": "Vendors", "subtitle": "Suppliers on your purchases and imports", "new": "New vendor",
   "summary": "{count} vendors · purchases {turnover} · payable {due}",
   "newTitle": "New vendor", "editTitle": "Edit vendor", "viewTitle": "Vendor", "newSub": "Appears in the vendor picker on purchases.",
   "foreignNote": "Foreign vendors are for imports (bill of entry); local purchases need a Local or Non-registered vendor.",
   "activeHint": "Inactive vendors can't be picked on new purchases; history is kept.",
   "docs": "Purchases", "turnover": "Purchased", "due": "Payable", "last": "Last purchase", "viewDocs": "View purchases",
   "balance": {"due": "Payable", "clear": "Settled"},
   "views": {"top": "Top by purchases", "due": "With payable", "foreign": "Import vendors"}
  }
 }
}

BN = {
 "roles": {"admin": "অ্যাডমিনিস্ট্রেটর", "approver": "অনুমোদনকারী", "operator": "অপারেটর", "viewer": "দর্শক"},
 "auth": {
  "noAccessTitle": "এই পাতায় আপনার প্রবেশাধিকার নেই", "noAccessHint": "আপনার ভূমিকায় এই কাজটি অন্তর্ভুক্ত নয়। প্রয়োজনে অ্যাডমিনিস্ট্রেটরকে বলুন।", "goBack": "ফিরে যান",
  "brandPanel": "DiziVAT সম্পর্কে", "tagline": "বাংলাদেশের উৎপাদকদের জন্য ভ্যাট ব্যবস্থাপনা",
  "hero": "মূসক-উপযোগী বিক্রয়, ক্রয় ও মজুদ — এক জায়গায়।",
  "feature": {"f1": "ভ্যাট, এসডি ও ভিডিএস স্বয়ংক্রিয় হিসাবসহ মূসক ৬.৩ চালান", "f2": "৯.১ রিটার্নের জন্য প্রতিটি ক্রয় লাইনে উপকরণ কর রেয়াত", "f3": "প্রতিটি অনুমোদন ও বাতিল — কে, কখন, কেন — সংরক্ষিত"},
  "title": "সাইন ইন", "subtitle": "আপনার {company} অ্যাকাউন্ট ব্যবহার করুন।",
  "username": "ইউজারনেম", "password": "পাসওয়ার্ড", "forgot": "ভুলে গেছেন? অ্যাডমিনিস্ট্রেটরের সাথে যোগাযোগ করুন",
  "showPassword": "পাসওয়ার্ড দেখান", "hidePassword": "পাসওয়ার্ড লুকান", "capsLock": "ক্যাপস লক চালু আছে।",
  "remember": "৭ দিন সাইন ইন রাখুন", "signIn": "সাইন ইন", "signingIn": "সাইন ইন হচ্ছে…",
  "required": "ইউজারনেম ও পাসওয়ার্ড লিখুন।",
  "invalid": "ইউজারনেম বা পাসওয়ার্ড ভুল।",
  "invalidLeft": "ইউজারনেম বা পাসওয়ার্ড ভুল। ১ মিনিটের লকের আগে আর {count, plural, other {#টি চেষ্টা}} বাকি।",
  "locked": "অনেকবার ভুল চেষ্টা হয়েছে। {s} সেকেন্ড পরে আবার চেষ্টা করুন।",
  "expired": "আপনার সেশন শেষ হয়েছে। যেখানে ছিলেন সেখান থেকে চালিয়ে যেতে আবার সাইন ইন করুন।",
  "network": "সার্ভারে পৌঁছানো যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।",
  "demoTitle": "ডেমো অ্যাকাউন্ট — ক্লিক করলে পূরণ হবে (পাসওয়ার্ড: {pw})",
  "footer": "প্রোটোটাইপ বিল্ড · নমুনা ডেটা · কোনো প্রকৃত রেকর্ড পরিবর্তন হয় না"
 },
 "cancel": {
  "title": "{no} বাতিল করবেন?", "bodyApproved": "ডকুমেন্টটি অনুমোদিত: এর মজুদ চলাচল উল্টে যাবে এবং এটি ভ্যাট রিটার্ন থেকে বাদ যাবে। এটি ফেরানো যাবে না।",
  "bodyDraft": "খসড়াটি বাতিল হিসেবে চিহ্নিত হবে এবং অডিটের জন্য সংরক্ষিত থাকবে।",
  "common": "সাধারণ কারণ", "reason": "বাতিলের কারণ", "hint": "ডকুমেন্টে ও তার ইতিহাসে দেখানো হবে।",
  "min": "অন্তত {n}টি অক্ষর লিখুন।", "keep": "ডকুমেন্ট রাখুন", "confirm": "ডকুমেন্ট বাতিল করুন",
  "preset": {"wrongParty": "ভুল পক্ষকে ইস্যু করা হয়েছে — সঠিক পক্ষকে পুনরায় ইস্যু করা হবে।", "wrongQty": "ভুল পরিমাণ বা দর লেখা হয়েছে — পুনরায় ইস্যু করা হবে।", "returned": "সরবরাহ সম্পন্ন হওয়ার আগে ক্রেতা পণ্য ফেরত দিয়েছেন।", "duplicate": "বিদ্যমান ডকুমেন্টের দ্বৈত এন্ট্রি।"},
  "presetShort": {"wrongParty": "ভুল পক্ষ", "wrongQty": "ভুল পরিমাণ/দর", "returned": "পণ্য ফেরত", "duplicate": "দ্বৈত এন্ট্রি"}
 },
 "docs": {
  "approved": "{no} অনুমোদিত হয়েছে", "cancelled": "{no} বাতিল হয়েছে", "restored": "{no} পুনরুদ্ধার হয়েছে", "deleted": "খসড়া {no} মুছে ফেলা হয়েছে", "undo": "পূর্বাবস্থা",
  "deleteTitle": "খসড়া {no} মুছবেন?", "deleteBody": "খসড়াটি তালিকা থেকে সরানো হবে। সাথে সাথে পূর্বাবস্থায় ফেরানো যাবে।", "deleteConfirm": "খসড়া মুছুন", "keep": "রেখে দিন",
  "cancelledBy": "{when} তারিখে {by} বাতিল করেছেন", "cancelledPlain": "বাতিল", "reason": "কারণ",
  "draftNote": "খসড়া — এখনো মজুদ বা ভ্যাট রিটার্নে যুক্ত হয়নি। পোস্ট করতে অনুমোদন দিন।",
  "history": "ইতিহাস", "noHistory": "কোনো কার্যক্রম নথিভুক্ত নেই।",
  "action": {"created": "তৈরি", "edited": "সম্পাদিত", "approved": "অনুমোদিত", "cancelled": "বাতিল", "deleted": "মুছে ফেলা", "restored": "পুনরুদ্ধার"},
  "edit": "সম্পাদনা", "delete": "মুছুন", "approve": "অনুমোদন", "cancel": "বাতিল…",
  "notFound": "ডকুমেন্ট পাওয়া যায়নি", "back": "তালিকায় ফিরুন", "openDoc": "ডকুমেন্ট খুলুন",
  "notEditableTitle": "{no} সম্পাদনা করা যাবে না", "notEditableHint": "শুধু খসড়া সম্পাদনা করা যায়। অনুমোদিত ডকুমেন্ট বাতিল করে নতুন ইস্যু করুন।"
 },
 "common": {"edit": "সম্পাদনা", "delete": "মুছুন", "deleteDraft": "খসড়া মুছুন", "close": "বন্ধ"},
 "sales": {"editTitle": "{no} সম্পাদনা", "editSub": "পরিবর্তনগুলো ডকুমেন্টের ইতিহাসে নথিভুক্ত হয়।", "draftOnlyHint": "আপনার ভূমিকায় খসড়া সংরক্ষণ করা যায়; অনুমোদনকারী পর্যালোচনা করে অনুমোদন দেবেন।", "saveChanges": "পরিবর্তন সংরক্ষণ"},
 "purchases": {"editTitle": "{no} সম্পাদনা", "cancelPurchase": "ক্রয় বাতিল", "addVendor": "নতুন সরবরাহকারী যোগ করুন"},
 "shell": {"newCustomer": "নতুন গ্রাহক", "newVendor": "নতুন সরবরাহকারী"},
 "table": {"viewDeleted": "ভিউ “{name}” মুছে ফেলা হয়েছে", "undo": "পূর্বাবস্থা"},
 "validation": {"bin": "১৩ অঙ্কের বিআইএন ০০০০০০০০০-০০০০ আকারে লিখুন।", "nid": "১০, ১৩ বা ১৭ অঙ্কের এনআইডি লিখুন।", "mobile": "বাংলাদেশি মোবাইল নম্বর লিখুন, যেমন 01711-000000।", "email": "সঠিক ইমেইল ঠিকানা লিখুন।", "reasonMin": "অন্তত ১০টি অক্ষর লিখুন।"},
 "items": {"ledger": "মজুদ খতিয়ান", "ledgerFor": "{name}-এর মজুদ খতিয়ান"},
 "ledger": {
  "title": "মজুদ খতিয়ান — {name}", "titlePlain": "মজুদ খতিয়ান", "notFound": "পণ্য পাওয়া যায়নি",
  "opening": "প্রারম্ভিক (১ জুলাই)", "in": "প্রাপ্ত", "out": "প্রদত্ত", "closing": "সমাপনী মজুদ",
  "filter": "চলাচল ফিল্টার", "filterBy": {"all": "সব", "purchase": "ক্রয়", "sale": "বিক্রয়", "production": "উৎপাদন", "other": "প্রারম্ভিক ও ক্ষতি"},
  "editItem": "পণ্য সম্পাদনা",
  "col": {"date": "তারিখ", "type": "চলাচল", "ref": "রেফারেন্স / পক্ষ", "in": "আগত", "out": "নির্গত", "balance": "স্থিতি"},
  "type": {"opening": "প্রারম্ভিক", "purchase": "ক্রয়", "sale": "বিক্রয়", "prodReceive": "উৎপাদন থেকে প্রাপ্ত", "prodIssue": "উৎপাদনে প্রদত্ত", "damage": "ক্ষতি / অপচয়"},
  "summaryRow": "মাসিক সারসংক্ষেপ", "monthly": "মাসিক মোট", "empty": "এই ধরনের কোনো চলাচল নেই।",
  "footer": "{n}টি চলাচল; শুধু অনুমোদিত ডকুমেন্ট।", "summaryNote": "উৎপাদন মডিউল (R3) চালু না হওয়া পর্যন্ত উৎপাদন ও ক্ষতির সারি মাসিক মোট।"
 },
 "parties": {
  "created": "{name} যোগ হয়েছে", "updated": "{name} হালনাগাদ হয়েছে", "fixErrors": "চিহ্নিত ঘরগুলো ঠিক করুন।",
  "deactivated": "{name} নিষ্ক্রিয় — নতুন ডকুমেন্টে দেখাবে না", "activated": "{name} পুনরায় সক্রিয়", "restored": "{name} পুনরুদ্ধার হয়েছে",
  "deleted": "{name} মুছে ফেলা হয়েছে", "undo": "পূর্বাবস্থা",
  "inUse": "{name} {count, plural, other {#টি ডকুমেন্টে}} ব্যবহৃত, তাই মোছা যাবে না। এর বদলে নিষ্ক্রিয় করুন।",
  "deactivate": "নিষ্ক্রিয় করুন", "activate": "পুনরায় সক্রিয় করুন",
  "deleteTitle": "{name} মুছবেন?", "deleteBody": "এর কোনো ডকুমেন্ট নেই। সাথে সাথে পূর্বাবস্থায় ফেরানো যাবে।", "deleteConfirm": "মুছুন",
  "active": "সক্রিয়", "inactive": "নিষ্ক্রিয়", "searchPlaceholder": "নাম, বিআইএন, মোবাইল, ঠিকানা খুঁজুন…",
  "col": {"name": "নাম", "mode": "ধরন", "bin": "বিআইএন / রেফ.", "mobile": "মোবাইল", "address": "ঠিকানা", "status": "অবস্থা"},
  "facet": {"mode": "ধরন", "status": "অবস্থা", "balance": "স্থিতি"},
  "views": {"inactive": "নিষ্ক্রিয়"},
  "field": {"mode": "নিবন্ধনের ধরন", "name": "আইনগত নাম", "bin": "বিআইএন", "foreignRef": "বৈদেশিক রেফারেন্স", "nid": "এনআইডি (ঐচ্ছিক)", "country": "দেশ", "contact": "যোগাযোগকারী", "mobile": "মোবাইল / ফোন", "email": "ইমেইল", "address": "ঠিকানা", "active": "সক্রিয়"},
  "hint": {"name": "ট্রেড লাইসেন্সে যেমন ছাপা; বড় হাতের অক্ষরে সংরক্ষিত।", "bin": "১৩ অঙ্ক, যেমন 000731906-0203।", "foreignRef": "আমদানিকারক/রপ্তানিকারক রেফারেন্স, যেমন EXP-AE-2024-118।", "nid": "মালিকের এনআইডি — ১০, ১৩ বা ১৭ অঙ্ক।", "address": "চালানে ডিফল্ট সরবরাহ ঠিকানা।"},
  "modeLocked": "ডকুমেন্ট থাকলে ধরন বদলানো যায় না — এটি তাদের ভ্যাট প্রয়োগ নির্ধারণ করে।",
  "modeHint": {"Local": "বাংলাদেশে ভ্যাট-নিবন্ধিত (বিআইএন আছে)।", "Foreign": "বাংলাদেশের বাইরে — রপ্তানি শূন্য-হারযুক্ত; আমদানিতে টিটিআই প্রযোজ্য।", "NonRegistered": "ভ্যাট-নিবন্ধিত নয় — ক্রয়ে উপকরণ কর রেয়াত নেই।"},
  "error": {"customerMode": "গ্রাহক স্থানীয় বা বৈদেশিক হতে হবে।", "modeLocked": "ডকুমেন্ট থাকলে ধরন বদলানো যায় না।"},
  "nonRegNote": "অনিবন্ধিত সরবরাহকারীর কাছ থেকে ক্রয়ে রেয়াতযোগ্য ভ্যাট নেই (মূসক ৬.২-তে তবুও লিপিবদ্ধ হয়)।",
  "customer": {
   "title": "গ্রাহক", "subtitle": "আপনার মূসক ৬.৩ চালানের ক্রেতাগণ", "new": "নতুন গ্রাহক",
   "summary": "{count} গ্রাহক · টার্নওভার {turnover} · প্রাপ্য {due}",
   "newTitle": "নতুন গ্রাহক", "editTitle": "গ্রাহক সম্পাদনা", "viewTitle": "গ্রাহক", "newSub": "বিক্রয় চালানের গ্রাহক তালিকায় দেখাবে।",
   "foreignNote": "বৈদেশিক গ্রাহকের চালান শূন্য-হারযুক্ত রপ্তানি (০% ভ্যাট, ভিডিএস নেই)।",
   "activeHint": "নিষ্ক্রিয় গ্রাহককে নতুন চালানে বাছাই করা যায় না; ইতিহাস সংরক্ষিত থাকে।",
   "docs": "চালান", "turnover": "টার্নওভার", "due": "প্রাপ্য", "last": "শেষ চালান", "viewDocs": "চালান দেখুন",
   "balance": {"due": "প্রাপ্য আছে", "clear": "পরিশোধিত"},
   "views": {"top": "টার্নওভার অনুযায়ী শীর্ষ", "due": "প্রাপ্য আছে", "foreign": "রপ্তানি গ্রাহক"}
  },
  "vendor": {
   "title": "সরবরাহকারী", "subtitle": "আপনার ক্রয় ও আমদানির সরবরাহকারীগণ", "new": "নতুন সরবরাহকারী",
   "summary": "{count} সরবরাহকারী · ক্রয় {turnover} · প্রদেয় {due}",
   "newTitle": "নতুন সরবরাহকারী", "editTitle": "সরবরাহকারী সম্পাদনা", "viewTitle": "সরবরাহকারী", "newSub": "ক্রয়ের সরবরাহকারী তালিকায় দেখাবে।",
   "foreignNote": "বৈদেশিক সরবরাহকারী আমদানির (বিল অব এন্ট্রি) জন্য; স্থানীয় ক্রয়ে স্থানীয় বা অনিবন্ধিত সরবরাহকারী লাগবে।",
   "activeHint": "নিষ্ক্রিয় সরবরাহকারীকে নতুন ক্রয়ে বাছাই করা যায় না; ইতিহাস সংরক্ষিত থাকে।",
   "docs": "ক্রয়", "turnover": "ক্রয়কৃত", "due": "প্রদেয়", "last": "শেষ ক্রয়", "viewDocs": "ক্রয় দেখুন",
   "balance": {"due": "প্রদেয় আছে", "clear": "পরিশোধিত"},
   "views": {"top": "ক্রয় অনুযায়ী শীর্ষ", "due": "প্রদেয় আছে", "foreign": "আমদানি সরবরাহকারী"}
  }
 }
}

def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict): merge(dst.setdefault(k, {}), v)
        else: dst[k] = v

def flat(d, p=""):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict): out.update(flat(v, f"{p}{k}."))
        else: out[p + k] = v
    return out

for lang, add in (("en", EN), ("bn", BN)):
    path = f"src/messages/{lang}.json"
    d = json.load(open(path, encoding="utf-8"))
    merge(d, add)
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")
e, b = flat(json.load(open("src/messages/en.json"))), flat(json.load(open("src/messages/bn.json")))
print("en", len(e), "bn", len(b), "missing in bn:", sorted(set(e) - set(b))[:10], "missing in en:", sorted(set(b) - set(e))[:10])
