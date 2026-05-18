-- Collapse the "Taranga Kukatpally" site variant into the canonical "Taranga".
-- A bulk-import CSV had "Taranga Kukatpally" in the Site Location column,
-- creating a phantom site on the overview dashboard with 43 invoices that
-- actually belong to Taranga. normaliseSiteName() only handles case/whitespace
-- so these rows passed through unchanged.

UPDATE invoices SET site = 'Taranga'
  WHERE LOWER(TRIM(site)) = 'taranga kukatpally';
