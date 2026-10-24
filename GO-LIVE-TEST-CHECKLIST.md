# CUT DELUXE — Go-Live Test Checklist

**Target go-live:** Sat 31 Oct 2026 · **Tested on branch:** `go-live-dev`
(preview: https://preview--6a30d1ec9fcbb579c10f4d91--b-6cecf3d.base44.app)

How to use: work top to bottom. Each item has **Steps**, a **Pass =** line, and
**Where** (the page/flow in the app). Mark `[x]` when it passes on a real-style run.
Nothing counts as done until it passes end-to-end with real-style data on a phone.

Legend: 🔴 blocker for go-live · 🟡 important · ⚪ nice-to-have

---

## A. Website booking → Calendar  🔴  (Day 2–3)
- [ ] **A1. A website booking request appears in the calendar**
  - Steps: On the public site (`/book`), submit a booking request as a test client.
  - Pass = it shows in the admin Calendar's requests drawer as "Needs Review".
  - Where: `Book` → `admin/Schedule` (requests drawer).
- [ ] **A2. Approving a request places it on the calendar**
  - Steps: Approve the held request.
  - Pass = appointment appears on the correct day/time with client + service.
  - Where: `admin/Requests` / Calendar requests drawer.
- [ ] **A3. Undated / unusual requests are handled, not lost**
  - Pass = a request with no date is visible and actionable, never silently dropped.

## B. Connect — bunching & drive times  🔴  (Day 2–3)
- [ ] **B1. Connect bunches the day using real drive times**
  - Steps: With several bookings on one day, run Reorder → Connect.
  - Pass = appointments pull together into an efficient order; drive times look real (not zero/placeholder).
  - Where: `admin/Schedule` + `admin/SchedulingBot` (Route Flow).
- [ ] **B2. Every unavoidable gap explains itself**
  - Pass = each remaining idle gap shows a reason (e.g. client availability, travel), none unexplained.
- [ ] **B3. Overrides & confirmation flags behave**
  - Pass = manual overrides stick through a re-run; confirmed appointments aren't silently moved.
- [ ] **B4. Conflicts resolve sanely**
  - Pass = double-books / impossible travel are flagged, not booked over.

## C. Confirm — real text with the time  🔴  (Day 2–3, verified live Day 5)
- [ ] **C1. Confirm sends each client a text with their time**
  - Steps: Run Confirm on a bunched day (test numbers).
  - Pass = each test number receives one text with the correct appointment time.
  - Where: `admin/Schedule` → Confirm · `admin/Messages`.
- [ ] **C2. Message is accurate (no wrong time/price)**
  - Pass = the time/price in the text matches the booking exactly.

## D. Reminders — automatic  🔴  (Day 5)
- [ ] **D1. Reminders go out automatically before appointments**
  - Pass = a reminder fires at the configured lead time without manual action.
  - Where: `admin/Reminders`, `admin/MessagingAutomation`, automation jobs.
- [ ] **D2. No duplicate / runaway sends**
  - Pass = exactly one reminder per appointment; no loops.

## E. SMS go-live  🔴  (Day 5)
- [ ] **E1. Texting switched test → live**
  - Pass = messaging mode is LIVE; a real text is delivered to a real handset.
  - Where: `admin/Settings` (messaging) / secrets.
- [ ] **E2. Replies captured**
  - Pass = a client reply appears in `admin/Messages`.
- [ ] **E3. Message history on the client profile**
  - Pass = each client profile shows its sent/received messages.
  - Where: `admin/Clients` → client profile.

## F. Deposits & checkout  🔴  (Day 6)
- [ ] **F1. One real deposit taken end-to-end**
  - Steps: Take one small REAL deposit (client-approved) via the live payment path.
  - Pass = payment succeeds; booking shows "deposit paid".
  - Where: public booking / `admin/AdminPayments`, `admin/DepositRules`.
- [ ] **F2. One real refund issued end-to-end**
  - Pass = refund completes; booking + reports reflect it.
- [ ] **F3. Payment status correct on booking AND in reports**
  - Where: `admin/Reports`.
- [ ] **F4. Test data never triggers a real charge**
  - Pass = test bookings cannot hit the live payment path (see `tests/testDataNeverPaysReal`).

## G. Daily Route screen on the phone  🔴  (Day 4)
- [ ] **G1. Appointments in correct order on a phone screen**
  - Where: `admin/Route`.
- [ ] **G2. Navigation works** (tap → opens maps to the address).
- [ ] **G3. Client details reachable** from the stop.
- [ ] **G4. Checkout works** from the route stop.
- [ ] **G5. 🔴 Background location function errors FIXED**
  - Pass = no errors from the live-location function; see `tests/liveLocation`.

## H. Phone admin app  🔴  (Day 7)
- [ ] **H1. Admin app installed on phone home screen** (PWA "Add to Home Screen").
- [ ] **H2. Secure login works** from the installed app.
- [ ] **H3. Whole day can be run from the phone** (calendar → route → confirm → checkout).

## I. Clean-up & real setup  🔴  (Day 7)
- [ ] **I1. Test bookings / demo data cleared** from real setup.
- [ ] **I2. Real services, prices, durations confirmed** (`admin/Services`).
- [ ] **I3. Real deposit rules confirmed** (`admin/DepositRules`).
- [ ] **I4. Real service areas confirmed** (`admin/ServiceCoverage`).
- [ ] **I5. Non-essential modules paused** (campaigns / team / group bookings) — see BACKUP-MANIFEST §5.

## J. Full dress rehearsal  🔴  (Day 8, ~60 min with Alvaro)
- [ ] **J1. Run one complete working day** on the system, start to finish.
- [ ] **J2. Everything that fails is fixed the same day.**

---

## Definition of Done (the 31st) — must ALL be true
1. [ ] Website booking appears in the calendar (A)
2. [ ] Connect bunches the day with real drive times; every gap shows its reason (B)
3. [ ] Confirm sends each client a real text with their time (C)
4. [ ] Reminders go out automatically before appointments (D)
5. [ ] A deposit can be taken and refunded (F)
6. [ ] The whole day runs from the phone app (G, H)
7. [ ] One full day already run on it before launch (J)

## Needed from Alvaro
- [ ] Final services, prices, durations, service areas
- [ ] 2–3 phone numbers for test texts
- [ ] Approval for one small real deposit + refund
- [ ] ~60 min on Fri 30 Oct for the dress rehearsal
