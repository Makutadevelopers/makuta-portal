-- 025_create_categories.sql
-- Moves invoice categories out of the static PURPOSES array in
-- client/src/utils/constants.ts and into a database table so any signed-in
-- user can add a new category from the UI without a deploy. Names are
-- compared case-insensitively (UNIQUE INDEX ON LOWER(name)) so "hardware",
-- "Hardware" and "HARDWARE" all collapse to a single category.

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_lower
  ON categories (LOWER(name));

-- Seed with the existing static PURPOSES list so the dropdown is identical
-- to today's behaviour at deploy time. Future categories get appended via
-- POST /api/categories.
INSERT INTO categories (name) VALUES
  ('Material'), ('Steel'), ('Cement'), ('Bricks'), ('Aggregates'),
  ('Hardware'), ('Tiles'), ('Plumbing Material'), ('Electrical Material'),
  ('Scaffolding'), ('Admixtures'), ('Granite'), ('Misc'), ('RMC Service'),
  ('Painting Materials'), ('Doors'), ('Advertisement'), ('Water Proofing'),
  ('Consultant'), ('Fire Fighting'), ('Contractor'), ('Machinery'),
  ('Loan'), ('Miwan Shuttering'), ('Tax'), ('Sales Refund'), ('Lifts'),
  ('Security Service'), ('Diesel'), ('Ms Sections & Tubes & Pipes'),
  ('CP & Sanitary'), ('Windows'), ('General Supplies'), ('Electrical')
ON CONFLICT DO NOTHING;
