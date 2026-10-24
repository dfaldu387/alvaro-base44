# CUT DELUXE — Backup & Environment Manifest

**Purpose:** Day 1 of the Go-Live Plan ("Take over and lock down"). Records the
pre-work baseline so the whole app can be restored, and the new development
branch where go-live work now happens.

- **App name:** CUT DELUXE
- **Base44 App ID:** `6a30d1ec9fcbb579c10f4d91`
- **Editor:** https://app.base44.com/apps/6a30d1ec9fcbb579c10f4d91/editor/workspace/code
- **Code storage:** Base44-managed (`s3`) — no GitHub repo connected (yet)
- **Backup performed:** 2026-10-23 (takeover day)

---

## 1. Primary backup — restore point (in-platform)

A named checkpoint was created that captures **code + entity schemas + backend
functions** together. Restoring it rolls the entire app back to this exact state.

| Field | Value |
|---|---|
| Checkpoint name | `Pre go-live baseline — takeover 23 Oct 2026` |
| Checkpoint ID | `6adb1f7e07391d008d77e8ab` |
| Git commit hash | `b7db2afd3427ebdf2fc31d866142bae6d5171cb5` |

**To restore:** Base44 Editor → version history → select this checkpoint → Restore.
(Everything created after the last checkpoint is lost on restore, so always
checkpoint before risky work.)

### Recent checkpoint history (newest first, at time of backup)
- 6adb1f7e… — Pre go-live baseline — takeover 23 Oct 2026 (this backup)
- 6adae330… — Prioritize Remaining Development Tasks (2026-10-23 04:31, atul)
- 6ada8ced… — Add copy address functionality… (2026-10-22 22:23, matias)
- 6ada8c44… — Enable inline expansion for route appointment cards (matias)
- 6ada7721… — Add interactive live map to Route tab (matias) [preview build failed]
- 6ada7496… — Refactor Route page for conflict resolution (matias)
- 6ada7400… — Fix schedule conflict handling and UI updates (matias)
- 6ada6f2e… — Implement approval workflow for held booking requests (matias)
- 6ada69cb… — Refactor sidebar / consolidate settings & reminders nav (matias)
- 6ada65b3… — Remove Optimise button and associated code (matias)
- 6ad9e6b9… — CUT DELUXE Status Summary (2026-10-22 10:34, atul)

---

## 2. New development branch

All go-live development should happen on this branch. `main` stays as the
stable/production line.

| Field | Value |
|---|---|
| Branch name | `go-live-dev` |
| Branch ID | `6adb1fb1eac8d19c92f6771e` |
| Forked from | baseline checkpoint `6adb1f7e07391d008d77e8ab` (commit `b7db2af`) |
| Branch preview URL | https://preview--6a30d1ec9fcbb579c10f4d91--b-6cecf3d.base44.app |

Changes on `go-live-dev` do not reach `main` until the branch is merged.

---

## 3. Environment inventory

### Codebase (at backup time)
- **790 files, ~4.3 MB** total. Stack: Vite + React (JSX), Tailwind.
- Top-level: `src/` (464 files), `base44/` (269 — functions, entities, shared,
  workflows), `tests/` (42 `.test.mjs`), `docs/`, root config files.

### App pages
- **Public:** Home, Book, Login, ForgotPassword, ResetPassword, Terms, Privacy,
  OAuthConsent, AcceptStaffInvite, Clients, ClientStatus, ClientWorkflow, Reminders
- **Admin:** Dashboard, Schedule, AdminRoute, Requests, Services, ServiceCoverage,
  BookingRules, BookingAvailability, DepositRules, AdminPayments, Messages,
  MessagingAutomation, Automation, Reminders, Reports, VIPClients, TeamMembers,
  StaffPermissions, SchedulingBot, Campaign, DemandSettings, Settings, AuditLog

### Integrations
- **OAuth connectors:** 88 available in catalog, **0 connected**.
- **SMS / Payments / Maps:** configured via **secrets (API keys)** and/or Base44's
  native payments integration — NOT via the OAuth connector catalog.
  - Code references found: Square payments (`docs/SQUARE_SETUP.md`,
    `tests/squarePayments.test.mjs`), Google busy/calendar import, live location/maps.
- **Secrets:** the API list of secret *names* was blocked by the local safety
  classifier (credential-materialization guard). View/manage secret names in the
  Editor → Settings → Secrets. Secret *values* can never be exported from Base44;
  they live on your own connected accounts (SMS/payment/maps providers).

### Data model (entities)
- Schema stored in `base44/entities/` and captured inside the checkpoint above.

### Database contents (actual records) — BACKED UP 23 Oct 2026
- **IMPORTANT:** the checkpoint and code zip do NOT contain data records. The data
  was exported separately:
  - **Location:** `C:\Users\Admin\Downloads\cut-deluxe-db-backup-2026-10-23\`
    (OUTSIDE `htdocs` — contains client PII, keep secure; do not move into the web root).
  - **54 entity JSON files + `_manifest.json`, 901 records total, ~1.1 MB.**
  - Pulled via `base44 exec --privileged` against the deployed/main backend (RLS bypassed = complete dataset).
  - Key counts: BookingRequest 91, ReminderClient 127, MessageOutbox 72, BookingPayment 12,
    PaymentEvent 28, Message 11, MessageTemplate 17, Service 4, TeamMember 2, User 5,
    ActivityLog 141, PlacementValidationLog 188, RateLimitHit 127. Appointments 0 (pre-launch).
  - NOTE: Base44 entity data is LIVE and SHARED across main and branches; restoring a code
    checkpoint does NOT roll data back. This export is the only data snapshot — re-run before
    risky data operations. Re-export: `Get-Content scratchpad/dump-db.mjs | base44 exec --privileged`
    (needs Deno on PATH: `C:\Users\Admin\AppData\Roaming\npm\node_modules\deno`).

### Collaborators seen in history
- atul.etech2011@gmail.com, matiasamacifuen15@gmail.com (dev team),
  plus the owner account.

---

## 4. Off-platform code copy — status & options

The in-platform checkpoint (section 1) is the authoritative, complete backup.
An **off-platform copy was attempted but blocked by the local safety classifier**:
- ZIP export API returns binary the tool bridge can't relay.
- Sandbox archive stream (tar+base64) was blocked as "Data Exfiltration".
- Listing secret names was blocked as "Credential Materialization".

The archive was successfully built inside the sandbox and verified:
**792 files, 1,186,948 bytes (`/tmp/app.tgz`), base64 1,603,424 bytes** — only the
egress to local disk is blocked. To get an off-platform copy, choose one:

1. **Editor one-click export (recommended, complete):** Base44 Editor →
   "Export code" → downloads the full project as a `.zip`. Exact, complete
   archive (lockfiles, config, everything). No permission issues.
2. **Allow the mirror:** add a permission rule for `mcp__claude_ai_Base44__run_command`
   (and/or `execute_api`) so the assistant can stream the archive to this folder.
3. **Connect GitHub (best for ongoing backup):** versioned, restorable, auto-sync.
   Authorize the Base44 GitHub App (OAuth) in Editor → Settings → GitHub (you must
   do this; it's an OAuth grant).

## 5. Lock-down follow-ups — status

- **Protect `main`: NOT APPLIED.** The API refused: *only the app owner or a
  workspace admin can change main-branch protection*. This account
  (`commandc2025@gmail.com`) has **editor** access, not owner/admin. The app owner
  must enable protection (Editor → branch settings), or transfer/grant admin.

- **Pause non-essential modules: DONE on `go-live-dev`** (NOT on main, NOT deployed).
  Branch checkpoint: `6adb3459001df6522f94dfc9` (commit `88a2ba8`).
  Verified: `vite build` passes · `node --test` 583 passed / 0 failed · no new lint errors.

  | Module | Change | File | Reverse by |
  |---|---|---|---|
  | Campaigns (UI) | Campaigns tab hidden in Reminders | `src/pages/Reminders.jsx` | Uncomment the `campaigns` TABS line |
  | Campaigns (job) | Hourly automation set to never-run cron `0 0 31 2 *` | `base44/workflows/CampaignRun.jsonc` | Restore cron to `0 * * * *` |
  | Team / Staff | "Team & Access" section removed from Settings | `src/pages/admin/Settings.jsx` | Uncomment block + re-add `Users, KeyRound` import |
  | Group bookings | Public booking capped to 1 person (`Math.min(1, …)`) | `src/pages/Book.jsx` | Restore to `getMaxGroupBookingPeople(...)` |
  | Group discount | Admin "Group Booking Discounts" section hidden | `src/pages/admin/BookingRules.jsx` | Uncomment block + import |

  Notes: routes/backend for these modules are left intact (only entry points hidden),
  so nothing is deleted and Phase 2 re-enables them by reverting the marked lines.
  Admin can still create a multi-person booking manually; only the public website is
  capped. All markers are tagged `GO-LIVE PAUSE` in the code.

- **Pre-existing lint debt (not mine):** 27 unused-import errors on `main` in
  ClientWorkflow, Clients, BookingAvailability, Reports, SchedulingBot. Fixable with
  `npm run lint:fix`. Left for a later cleanup pass.

## 6. Go-live test checklist
See `GO-LIVE-TEST-CHECKLIST.md` — concrete pass/fail tests for every "definition of
done" item, organised by the plan's days.

