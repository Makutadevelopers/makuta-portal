-- Normalise invoices.site to the canonical capitalisation so the dashboard
-- doesn't show "Nirvana" and "nirvana" as separate rows.  Only rewrites
-- variants that are a case-insensitive match for a known canonical name —
-- genuinely unknown sites (e.g. typos like "Villa No -140 Honer Homes")
-- are left as-is for HO to clean manually.

UPDATE invoices SET site = 'Nirvana'
  WHERE LOWER(TRIM(site)) = 'nirvana' AND site <> 'Nirvana';

UPDATE invoices SET site = 'Taranga'
  WHERE LOWER(TRIM(site)) = 'taranga' AND site <> 'Taranga';

UPDATE invoices SET site = 'Horizon'
  WHERE LOWER(TRIM(site)) = 'horizon' AND site <> 'Horizon';

UPDATE invoices SET site = 'Green Wood Villas'
  WHERE LOWER(TRIM(site)) = 'green wood villas' AND site <> 'Green Wood Villas';

UPDATE invoices SET site = 'Aruna Arcade'
  WHERE LOWER(TRIM(site)) = 'aruna arcade' AND site <> 'Aruna Arcade';

UPDATE invoices SET site = 'Office'
  WHERE LOWER(TRIM(site)) = 'office' AND site <> 'Office';
