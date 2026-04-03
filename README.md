# Makuta Developers — Invoice & Payment Portal

Multi-role invoice and payment management portal for a real estate company.

## Roles
| Role | Login | Access |
|---|---|---|
| Head Accountant | ho   | Full access — invoices, payments, vendors, audit |
| Managing Director | mgmt | Read-only executive dashboard |
| Site Accountant | site | Own site only — enter invoices, view expenditure |

## Quick start (local dev)
```bash
# 1. Start local PostgreSQL
docker-compose up -d

# 2. Install dependencies
cd client && npm install && cd ..
cd server && npm install && cd ..

# 3. Copy env file
cp .env.example .env
# Edit .env — set DB_HOST=localhost, DB_PASSWORD=localdevpassword

# 4. Run migrations
cd server && npm run db:migrate

# 5. Generate password hashes + seed database
node src/db/seeds/generatePasswordHashes.js
# Paste hashes into src/db/seeds/001_seed_users.sql
npm run db:seed

# 6. Start dev servers
npm run dev
```

## Tech stack
- **Frontend:** React 18 + TypeScript + Tailwind CSS + Vite
- **Backend:**  Node.js + Express + TypeScript
- **Database:** PostgreSQL (local: Docker, prod: AWS RDS ap-south-1)
- **Storage:**  AWS S3 (invoice attachments)
- **Auth:**     JWT (8h) + bcrypt
- **Hosting:**  AWS EC2 + CloudFront + Route 53
