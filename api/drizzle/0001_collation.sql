-- Natural, case-insensitive ordering ("Item 2" < "Item 10", "apple" < "Banana"): the same order as the
-- frontend's localeCompare(…, { numeric: true }), so server-sorted lists look exactly like the mock's.
CREATE COLLATION IF NOT EXISTS "natural" (provider = icu, locale = 'und-u-kn-true');
