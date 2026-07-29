# CloudFront CDN Runbook — `invoice.makutadevelopers.com`

**Goal:** cut the India↔us-east-1 latency that dominates load time. Measured baseline:
cold TLS+connect ≈ 0.6–0.9 s, every request pays ~250 ms each way. Backend itself is
fast (invoice-list query 16 ms, API response sub-ms). The fix is an edge in front of the
origin, not any app change.

**What CloudFront buys us**
- Static assets (`/assets/*`, already `Cache-Control: immutable`) served from an edge
  POP in India → tens of ms instead of a trans-oceanic fetch.
- TLS terminated at the edge near the user; CloudFront keeps a warm, reused connection to
  the Virginia origin → shaves handshake/setup off **every** `/api` call too.
- HTTP/2/3 to the client at the edge.

> Origin today: the CRM's public nginx fronts both `portal-web` (UI) and `portal-api`
> (`/api/*`) at `invoice.makutadevelopers.com` on EC2 `52.3.199.149`.

---

## Prerequisites
- AWS console (or CLI) access with CloudFront + ACM + Route 53 (or your DNS) permissions.
- Control of DNS for `makutadevelopers.com`.
- The origin must remain reachable by a hostname CloudFront can target (see Step 1).

## Step 1 — Give the origin a stable hostname
CloudFront needs an origin domain that is **not** the same name it serves.
- Create `origin.invoice.makutadevelopers.com` → A record to `52.3.199.149` (the EC2 box).
- Confirm nginx answers for that Host header (add it to `server_name` in
  `infra/prod/invoice.makutadevelopers.com.conf` if it filters by host), then redeploy nginx.
- Verify: `curl -I https://origin.invoice.makutadevelopers.com/api/health` → 200.

## Step 2 — TLS cert for the public name
- In **ACM us-east-1** (CloudFront requires us-east-1 certs) request a public cert for
  `invoice.makutadevelopers.com`.
- Validate via DNS (add the CNAME ACM gives you). Wait for **Issued**.

## Step 3 — Create the distribution
- **Origin domain:** `origin.invoice.makutadevelopers.com`
- **Origin protocol:** HTTPS only (or match origin); **Origin Shield:** optional (us-east-1).
- **Alternate domain name (CNAME):** `invoice.makutadevelopers.com`
- **Custom SSL cert:** the ACM cert from Step 2.
- **Default cache behavior** (this is the catch-all → treat as dynamic):
  - Viewer protocol policy: **Redirect HTTP→HTTPS**
  - Allowed methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
  - Cache policy: **CachingDisabled**
  - Origin request policy: **AllViewer** (forward all headers/cookies/query — critical so
    the JWT `Authorization` header reaches the API).

## Step 4 — Add a cache behavior for static assets
- **Path pattern:** `/assets/*`
  - Methods: GET, HEAD
  - Cache policy: **CachingOptimized** (respects the origin's `immutable` max-age)
  - Compress objects automatically: **Yes** (brotli/gzip at the edge)
- (Optional) same for other purely-static paths: `/favicon*`, `/*.svg`, `/*.png`.
- **Do NOT cache** `/` (index.html is already `no-store`) or `/api/*` — they fall through to
  the Default (CachingDisabled) behavior. Authenticated API data must never be edge-cached.

## Step 5 — Cutover (low-risk, reversible)
1. Test the distribution on its `*.cloudfront.net` name first:
   - `curl -I https://dxxxx.cloudfront.net/assets/<hashed>.js` → expect `x-cache: Hit from cloudfront` on 2nd hit.
   - Log in through the cloudfront name and click around — confirm `/api` works (JWT passes).
2. Flip DNS: `invoice.makutadevelopers.com` → CloudFront distribution
   (Route 53 **Alias** to the distribution, or CNAME if not apex).
3. Watch: 401s/CORS/missing-data usually mean the Authorization header or cookies aren't
   being forwarded → re-check the **AllViewer** origin request policy on the Default behavior.

## Step 6 — Verify the win
- `curl -w '%{time_starttransfer}\n' -o /dev/null https://invoice.makutadevelopers.com/assets/<hashed>.js`
  from an India network → should drop from ~0.8 s to ~tens of ms on a warm edge.
- Spot-check the app: first paint and navigation should feel materially faster.

## Rollback
Point DNS back to the origin (or to `origin.invoice.makutadevelopers.com`). TTL-bounded;
keep DNS TTL low (60 s) during cutover. No app/data changes were made, so rollback is just DNS.

## Gotchas specific to this stack
- **JWT in `Authorization` header** must be forwarded → AllViewer origin request policy.
- index.html is `no-cache, no-store` (correct) — keep it uncached so deploys are picked up
  instantly; only the hashed `/assets/*` are cached.
- The box is co-tenant with the CRM nginx; make sure the new `origin.*` host doesn't collide
  with CRM server blocks.
- This does **not** speed up the database or API compute (already fast) — its value is
  latency/TLS for India users. For API round-trip latency itself, the real fix is region
  (see mumbai-migration-plan.md).
