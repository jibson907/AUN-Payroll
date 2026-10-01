# AUN Payroll — Pay Advice System

Payroll application for the **American University of Nigeria**. An administrator signs in, uploads the monthly payroll Excel file, the backend validates it, generates an **individual PDF pay advice** for every employee, and emails **each employee only their own** pay advice from `payroll@aun.edu.ng` — in controlled batches, with delivery tracking, retry, payroll history and a full audit log.

```
AUNpayroll/
├── frontend/     React 18 · Vite · React Router  (dev: http://localhost:5173)
├── backend/      Node.js · Express · Mongoose (MongoDB Atlas) · ExcelJS · Puppeteer · Nodemailer
├── Dockerfile    production image (API + web app on one origin)
└── package.json  convenience scripts (build / start / dev)
```

---

## Requirements

- **Node.js 22.12 or newer** (https://nodejs.org, LTS).
- **MongoDB Atlas** cluster with a database user that has **readWrite on `AUNpayroll` only**, and the server's IP in **Network Access** (never `0.0.0.0/0` in production).
- **Email:** the `payroll@aun.edu.ng` Google Workspace mailbox — an **App Password** (testing) or **Google Workspace SMTP relay** (production). AUN's DNS already has SPF and Google DKIM, so no DNS changes are needed.

---

## Local development (Windows)

```
npm install            (root: installs 'concurrently')
npm run install:all    (backend + frontend dependencies; downloads Chromium for PDFs)
copy backend\.env.example backend\.env
```

Edit `backend/.env` — at minimum:

```
MONGODB_URI=<Atlas connection string>
JWT_SECRET=<long random value: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))">
```

Email settings (`SMTP_*`) can be added later — until they are set, pay advices can be uploaded and generated but **sending is disabled** (nothing is ever marked "sent" by mistake).

```
npm run db:check       (verifies the Atlas connection and database-user privileges)
npm run admin:create   (creates an administrator; password typed at a hidden prompt)
npm run dev            (backend :5000 + frontend :5173 together)
```

Open **http://localhost:5173**. In development the Vite server forwards `/api` to the backend, so the app and API behave as one origin — exactly like production.

**Accounts.** Admin credentials are never stored in `.env` or code. An administrator adds more users (administrators, payroll officers, read-only viewers) in **Settings → Payroll Users**. There is no public sign-up. Forgotten password: `npm run admin:reset-password`.

---

## Monthly workflow

1. **Upload Payroll** — choose the month and upload the `.xlsx`. The file is validated **in memory and never stored**.
   Re-uploading a corrected file for the same month replaces the previous upload **only if nothing from it has been emailed yet**; the exact same file cannot be uploaded twice.
2. **Review** — the run page shows valid records and records with errors (e.g. missing/invalid email). Rows with errors are **skipped**, never emailed; the rest of the file still processes.
3. **Generate PDFs** — one pay advice per valid employee (the AUN design is unchanged).
4. **Send Pay Advices** → confirm. Each employee receives **only their own** PDF:
   - Subject: `Payroll: Pay Advice Slip for the month of June 2026`
   - Greeting: `Dear <Employee Name>,`
   - Attachment: `<Employee Name> Pay Advice for June 2026.pdf`
   Emails go out in controlled batches (default 50, 2 at a time, 30 s pause between batches ≈ 15 min for 1,000 staff).
5. **Delivery status** — Pending / Sent / Failed / Skipped per employee, with the failure reason and attempt count. **Retry Failed** re-sends only failures; already-sent staff are never emailed twice (a deliberate single re-send asks for confirmation and is audited).

---

## Excel requirements

- `.xlsx` only (no `.xls`, macros or passwords), max 10 MB, max 5,000 rows, first **visible** sheet.
- Required columns: `Employee Names`, `Employee ID No`, **`Email Address`**, `Gross Pay`, `TOTAL DEDUCTIONS`, `NET PAY` (plus the AUN template columns printed on the pay advice).
- Email addresses must be plain single addresses (e.g. `name@aun.edu.ng`); anything else marks that row invalid.

---

## Production deployment

**Live address:** `https://aun.edu.ng/payrol`. AUN's main Apache web server terminates HTTPS and forwards everything under `/payrol/` to this app. One Node process serves the built web app **and** the API (`/payrol/api`) from the same origin (`NODE_ENV=production`).

**Sub-path (`BASE_PATH`).** The app is built for the path it is published under. `BASE_PATH=/payrol` must be set in **both** places:
- at **build** time for the frontend (Docker: the `BASE_PATH` build arg in `docker-compose.yml`; no Docker: `BASE_PATH=/payrol npm run build`), and
- at **run** time in `backend/.env.production`.

If they differ, the page loads blank and the server logs `frontend_base_path_mismatch`. Leave `BASE_PATH` empty for local development.

### Option A — Docker Compose (recommended)

Production settings live in `backend/.env.production` (git- and docker-ignored).

```
docker compose up -d --build
docker compose exec app npm run admin:create         (first time only, if no admin exists)
docker compose restart app                           (after editing backend/.env.production)
```

The container listens on `127.0.0.1:5000`, reachable only by the Apache proxy (see `docker-compose.yml` if Apache is on another machine).

### Option B — directly on a server (Node 22+)

```
npm run install:all
npm run build:prod                 (builds frontend/dist for /payrol)
cp backend/.env.production backend/.env
cd backend && node server.js       (run under a process manager, e.g. pm2 or systemd)
```

`npm run build:prod` works the same in PowerShell, cmd and Git Bash. Plain `npm run build` is for the root of a domain: uploading that build to /payrol gives a blank page.

### Apache reverse proxy (for AUN IT, on the aun.edu.ng server)

Enable `mod_proxy`, `mod_proxy_http` and `mod_headers`, then add inside the HTTPS (`:443`) `<VirtualHost>` for `aun.edu.ng` / `www.aun.edu.ng`. Replace `127.0.0.1` with the app server's internal IP if the app runs on another machine.

```apache
# AUN Payroll — https://aun.edu.ng/payrol
RedirectMatch 301 ^/payrol$ /payrol/
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass        /payrol/ http://127.0.0.1:5000/payrol/ timeout=180
ProxyPassReverse /payrol/ http://127.0.0.1:5000/payrol/
```

The path is forwarded unchanged (`/payrol/…` → `/payrol/…`), so no rewriting is needed. Uploads can be up to 10 MB: if Apache sets `LimitRequestBody`, allow at least 11 MB for `/payrol/`. Then check `https://aun.edu.ng/payrol/api/health` returns `"status":"ok"`.

### Production `backend/.env.production` (in addition to MONGODB_URI / JWT_SECRET / SMTP_*)

```
NODE_ENV=production
BASE_PATH=/payrol                                     (the sub-path; must match the build)
FRONTEND_URL=https://aun.edu.ng,https://www.aun.edu.ng (site origin(s) without the path; no "*")
COOKIE_SECURE=true                                    (required — the server refuses to start without it)
TRUST_PROXY=1                                         (one reverse proxy: AUN's Apache)
EMAIL_REPLY_TO=payroll.queries@aun.edu.ng             (optional)
```

### HTTPS

The app **must** be served over HTTPS: it sends HSTS, a strict Content-Security-Policy and `Secure` cookies. On a shared domain the session cookie is scoped to `/payrol` (`__Secure-` prefix), so the rest of aun.edu.ng never receives it, and HSTS is sent without `includeSubDomains` so it doesn't affect other AUN subdomains.

### Before going live — checklist

- [ ] Atlas: **rotate** the database password; app user has **readWrite on `AUNpayroll` only**; Network Access = the server's fixed IP only; **backups** enabled (M10+ tier).
- [ ] `JWT_SECRET` is a fresh random value on the server (never reuse the development one).
- [ ] Email: Google Workspace **SMTP relay** (or App Password) configured by AUN IT; **Settings → Email Delivery → Test Connection** succeeds.
- [ ] `NODE_ENV=production`, `BASE_PATH=/payrol`, `COOKIE_SECURE=true`, `FRONTEND_URL`, `TRUST_PROXY` set; AUN IT has added the Apache proxy; `https://aun.edu.ng/payrol` reachable only over HTTPS.
- [ ] Administrator created with `npm run admin:create`; change its password after first login.
- [ ] Do a first run with a small file of your own staff records before the full payroll.
- [ ] Logs: `backend/logs/app.log` (rotates at 10 MB, keeps 5) or the container's stdout — ship to your monitoring if available.

---

## Security summary

- Sessions: short-lived JWT in an **HttpOnly, Secure, SameSite=Strict** cookie (never in `localStorage`); CSRF token on every change; server-side logout; password change signs out other devices.
- Login: bcrypt (cost ≥ 12), password policy (≥ 12 chars, no common passwords), per-account lockout after 5 failures, per-IP and per-account rate limits, no account enumeration.
- Authorization enforced on the server for every route (admin / payroll officer / viewer).
- Uploads: `.xlsx` only, ZIP-bomb/macro/path-traversal checks, size and shape limits, strict per-row validation; files never stored.
- Payslips: rendered in memory, never written to disk; downloadable only by signed-in users; `Cache-Control: no-store`.
- Email: sent only by the backend; one recipient per message; strict address validation (no lists or display-name tricks); credentials only in `backend/.env`.
- Secrets live only in `backend/.env` (git- and docker-ignored); none in the frontend build.
- Headers: CSP, HSTS, frame-deny, no-sniff, no-referrer, Permissions-Policy. Rate limits on login, upload, generate/send, resend and PDF downloads. Audit log of every action; no salaries, passwords or tokens in logs.

---

## Troubleshooting

**"Database error" on start / `database: disconnected`** — run `npm run db:check`.
- `Server selection timed out` / "IP that isn't whitelisted": add the current IP in Atlas → Network Access.
- `querySrv ECONNREFUSED`: set `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1` in `backend/.env`.
- `bad auth`: wrong user/password in `MONGODB_URI` (URL-encode special characters).

**"Email is not configured"** — set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in `backend/.env`, restart, then **Settings → Test Connection**.

**PDF preview/generation fails** — Chromium could not start. Reinstall backend dependencies, or set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome/Chromium. The app restarts the PDF engine automatically if it crashes.

**Upload rejected** — the message says why (format, size, missing column, …). See *Excel requirements*.

**Port already in use** — change `PORT` in `backend/.env` (and the proxy target in `frontend/vite.config.js` for development).
