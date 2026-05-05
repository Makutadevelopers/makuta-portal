-- 001_seed_users.sql
-- Makuta Accounts Module users
--
-- After migration 021 each user owns an array of sites. Ramana and Madhu used
-- to have two logins each (one per site they handled); they now have a single
-- login that covers both sites.

INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'Raju S', 'raju@makuta.in', '$2b$12$0i5rkv0VF23RVQZtTgAMbeiepEnyFHbH7lCCAnWBHtRc7Vh67ilpa', 'ho', '{}', 'Head Accountant', true, now(), now());
INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', 'Harsha', 'harsha@makuta.in', '$2b$12$tekkvzC7bCUYr2mQ1c51w.VMvl5AsGry6mjsCm0piZyq/CnYCH5vm', 'mgmt', '{}', 'Managing Director', true, now(), now());
INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f', 'Ramana', 'ramana@makuta.in', '$2b$12$lYRAxpQOpXGmDmH5quj.neFmy65HhhkF4SZ44wFcw70joLoimaa8a', 'site', ARRAY['Nirvana','Aruna Arcade'], 'Site Accountant', true, now(), now());
INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80', 'Veerandhar', 'veerandhar@makuta.in', '$2b$12$bVtPEZhf/kdH8s/7YR/66eFYPKOypWUcahrKTXMZtqVvKs3s2m6Pm', 'site', ARRAY['Taranga'], 'Site Accountant', true, now(), now());
INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('e5f6a7b8-c9d0-4e1f-aa3b-4c5d6e7f8091', 'Madhu', 'madhu@makuta.in', '$2b$12$aYuXiBkM6WXRbC4zVsGFuOPlGdLYE.qqomKXSkNt3UbTYo3ma5082', 'site', ARRAY['Horizon','Green Wood Villas'], 'Site Accountant', true, now(), now());
INSERT INTO users (id, name, email, password_hash, role, sites, title, is_active, created_at, updated_at) VALUES ('18c9d0e1-f2a3-4b4c-9d6e-7f8091021324', 'Thanug', 'thanug@makuta.in', '$2b$12$jKqSdFCIiTlWenzXniiu3ONfLUrkPsyv2OQNrD9j4nZBpSd0LiRm2', 'site', ARRAY['Office'], 'Site Accountant', true, now(), now());
