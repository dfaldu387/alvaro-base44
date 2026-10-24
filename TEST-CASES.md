# CUT DELUXE — Go-Live Test Cases

End-to-end test cases for the 8-day go-live, grounded in the actual system
(real pages, backend functions and entities). Run on the **`go-live-dev`** branch
preview before merge to `main`.

- **Preview (branch):** https://preview--6a30d1ec9fcbb579c10f4d91--b-6cecf3d.base44.app
- **Maps to:** `GO-LIVE-TEST-CHECKLIST.md` item IDs (e.g. A1, C1).
- Go-live: **Sat 31 Oct 2026.**

## Conventions
- **Priority:** 🔴 blocker · 🟡 important · ⚪ minor
- **Result:** Pass / Fail / Blocked — record actual result + date + tester.
- ⚠️ **Data warning:** entity data is LIVE and shared between `main` and branches.
  Create every test record as **test/sample data** (so `is_sample`/test flag = true)
  and remove it afterwards with the **`deleteTestData`** function. A full data
  snapshot exists at `Downloads\cut-deluxe-db-backup-2026-10-23\` — re-export before
  destructive steps.

## Test data (fill in before starting)
| Key | Value |
|---|---|
| Test client A (name / phone) | _e.g._ "Test Client A" / +61 4xx xxx xxx (a number you control) |
| Test client B (name / phone) | "Test Client B" / +61 4xx xxx xxx |
| Test client C (name / phone) | "Test Client C" / +61 4xx xxx xxx |
| Test service | one real service (e.g. the $ "High School" cut) |
| Test address(es) | 2–3 real addresses inside a service zone (to exercise drive times) |
| Square mode | sandbox for dry runs; LIVE only for TC-DEP-01/02 (one real small deposit) |

---

## A. Public booking → calendar  (Day 2–3)

### TC-BOOK-01 — Website booking request reaches the calendar 🔴  [A1]
- **Precondition:** At least one active Service and one active ServiceArea; booking availability open for a near date.
- **Steps:**
  1. Open `/book` as an anonymous visitor.
  2. Complete the flow: Service → Region/Address → Availability (pick a day/slot) → Details (Test Client A + phone) → Review → Submit.
  3. In admin, open **Calendar** (`/admin/schedule`) → Booking Requests drawer.
- **Expected:** A new `BookingRequest` appears (status *Needs Review* / *held*), showing client, service, requested time and address. `submitPublicBooking` returns success; no console/network error on `/book`.
- **Maps:** A1.

### TC-BOOK-02 — Approve a request → it lands on the calendar 🔴  [A2]
- **Precondition:** TC-BOOK-01 request exists.
- **Steps:** Open the request in the drawer (or `/admin/requests`) → Approve/Place.
- **Expected:** Request transitions to placed/confirmed (`reviewQueueAction`/`updateBookingRequest`); an appointment shows on the correct day/time with client + service; audit entry written (`ActivityLog`).
- **Maps:** A2.

### TC-BOOK-03 — Undated / out-of-hours request is handled, not lost 🟡  [A3]
- **Steps:** Submit a request with no specific date (or just outside bookable hours) and view the drawer.
- **Expected:** Request is visible and actionable (not silently dropped); it does **not** occupy a real time slot until dated (ref `undatedBookings`, `publicDayFit`).
- **Maps:** A3.

### TC-BOOK-04 — Decline a request 🟡
- **Steps:** On a test request choose Decline.
- **Expected:** `declineBookingRequest` runs; status = declined; client-facing status reflects it; no appointment created.

### TC-BOOK-05 — Out-of-area booking is blocked 🟡
- **Steps:** On `/book` enter an address clearly outside all service zones / beyond max radius.
- **Expected:** Booking is prevented with a clear message (ref `serviceCoverage`, `getMaxServiceRadiusKm`); no `BookingRequest` created.

### TC-BOOK-06 — Group booking is paused (capped to 1) 🔴  (pause verification)
- **Precondition:** Running `go-live-dev` (where the pause is applied).
- **Steps:** On `/book`, reach the People/Services step and try to add a second person.
- **Expected:** Cannot exceed **1 person**; no "Group booking" label; no group discount shown (ref the `Math.min(1, …)` cap in `Book.jsx`). On `main` (unpaused) this would still allow groups — confirm the difference.

---

## B. Connect — bunching & drive times  (Day 2–3)

### TC-CONN-01 — Connect bunches the day with real drive times 🔴  [B1]
- **Precondition:** 3–4 placed test bookings on one day at different addresses.
- **Steps:** Open **Route Flow** (`/admin/scheduling-bot`) / Calendar → run Reorder → **Connect**.
- **Expected:** Appointments reorder into an efficient sequence; travel legs use real drive times (not 0/placeholder) via Mapbox (`mapboxDriveMatrix`, `routeFlowEngine`/`routeFlowOptimiser`); a `RouteConnection` is produced.
- **Maps:** B1.

### TC-CONN-02 — Every unavoidable gap explains itself 🔴  [B2]
- **Steps:** Arrange bookings so a gap is unavoidable (e.g. a fixed-time appointment with travel before it); run Connect.
- **Expected:** Each idle gap shows a reason (client availability, travel, fixed time) via `placementReason`; no unexplained blank gaps.
- **Maps:** B2.

### TC-CONN-03 — Manual override survives a re-run 🟡  [B3]
- **Steps:** Manually move/lock one appointment, then run Connect again.
- **Expected:** The override is respected (not silently reverted); confirmed appointments are not moved (`provisionalPlacement`, confirmation flags).
- **Maps:** B3.

### TC-CONN-04 — Conflicts are flagged, not booked over 🟡  [B4]
- **Steps:** Force an impossible situation (two appointments whose times + travel overlap).
- **Expected:** Conflict is flagged / placement refused (`validateBookingPlacement(V2)`, `scheduleOverlap`); system does not double-book.
- **Maps:** B4.

### TC-CONN-05 — Finalised day is locked 🟡
- **Steps:** Finalise a day, then attempt to edit/replace an appointment on it.
- **Expected:** Edits are gated (`finalisedDayGate`); changing a finalised day requires an explicit unlock.

---

## C. Confirm — the real text  (Day 2–3, re-verified Day 5)

### TC-CONF-01 — Confirm sends each client a text with their time 🔴  [C1]
- **Precondition:** A connected/bunched day of test bookings; **messaging in test mode** for this dry run.
- **Steps:** Run **Confirm** on the day.
- **Expected:** A confirmation message is enqueued per client with the correct time (`confirmBooking` → `MessageOutbox` → `processMessageOutbox`); in test mode it is recorded but not sent to a real handset (`messagingMode`); each shows in **Messages**.
- **Maps:** C1.

### TC-CONF-02 — Message content is accurate 🔴  [C2]
- **Steps:** Inspect the queued/sent confirmation for a booking.
- **Expected:** Time, date and price in the text match the booking exactly (`messageRender`, `messageTemplateDefaults`); no placeholder tokens left unrendered.
- **Maps:** C2.

### TC-CONF-03 — Recipient guard blocks wrong/missing numbers 🟡
- **Steps:** Attempt to confirm a booking whose client has a malformed/empty phone.
- **Expected:** Send is blocked for that record with a clear reason (`recipientGuard`, `auPhone`); other sends proceed.

---

## D. Reminders  (Day 5)

### TC-REM-01 — Reminder fires automatically before an appointment 🔴  [D1]
- **Precondition:** A test appointment within the reminder lead window.
- **Steps:** Let the reminder job run (or trigger `preAppointmentReminder`).
- **Expected:** Exactly one reminder is enqueued at the configured lead time without manual action.
- **Maps:** D1.

### TC-REM-02 — No duplicate / runaway sends 🔴  [D2]
- **Steps:** Re-run the reminder/outbox processing twice for the same appointment.
- **Expected:** Still exactly one reminder (idempotency — ref `paymentIdempotency`/outbox dedupe patterns); no loop.
- **Maps:** D2.

### TC-REM-03 — Campaign automation stays paused 🔴  (pause verification)
- **Precondition:** `go-live-dev` (CampaignRun cron set to never-run).
- **Steps:** Over a run window, confirm the regular-client reminder **campaign** does not fire; the Campaigns tab is hidden under Reminders.
- **Expected:** No campaign sends; `/admin/reminders?tab=campaigns` falls back to Pipeline. (Re-enable only in Phase 2.)

---

## E. SMS go-live  (Day 5)

### TC-SMS-01 — Switch test → live and deliver a real text 🔴  [E1]
- **Precondition:** Twilio live secrets set; a phone you control as Test Client A.
- **Steps:** Set messaging mode to **LIVE** (`setMessagingMode`), send one confirmation to Test Client A.
- **Expected:** A real SMS arrives on the handset; delivery status updates (`twilioStatusWebhook`); mode shown honestly in UI (`messagingModeHonesty`).
- **Maps:** E1.

### TC-SMS-02 — Inbound reply is captured 🟡  [E2]
- **Steps:** Reply to the confirmation from the handset.
- **Expected:** The reply appears in **Messages** (`twilioInboundWebhook`; matched to client or `UnmatchedReply` if not matched).
- **Maps:** E2.

### TC-SMS-03 — Message history on the client profile 🟡  [E3]
- **Steps:** Open Test Client A in **Clients** → profile.
- **Expected:** Sent and received messages are listed on that profile (`Message` records).
- **Maps:** E3.

### TC-SMS-04 — Assistant/auto-reply never invents a time or price 🟡 (safety)
- **Steps:** From the handset, send an ambiguous/edge message.
- **Expected:** Per the assistant guardrails, no automated reply states a time/price it wasn't given; change requests are recorded, not acted on (`assistantGuard`, `assistantConstraint`).

---

## F. Deposits & checkout  (Day 6)

### TC-DEP-00 — Test data NEVER triggers a real charge 🔴  [F4] (run first)
- **Steps:** Create a **test** booking and attempt a deposit/payment with Square set to LIVE.
- **Expected:** Test data is refused against the live provider with a clear message and no charge (`testData`, `paymentSecurity` / `testDataNeverPaysReal`). Only sandbox serves test bookings.
- **Maps:** F4.

### TC-DEP-01 — One real deposit taken end-to-end 🔴  [F1]
- **Precondition:** Client approval for one small REAL deposit; Square LIVE; a real (non-test) booking.
- **Steps:** Trigger the deposit (public deposit quote `publicDepositQuote` / `evaluateDeposit` → pay via `routePayment`/`paymentAction`).
- **Expected:** Payment succeeds; `BookingPayment` = paid; `PaymentEvent` recorded; booking shows "deposit paid"; `squareWebhook` reconciles.
- **Maps:** F1.

### TC-DEP-02 — One real refund issued end-to-end 🔴  [F2]
- **Steps:** Refund the TC-DEP-01 deposit (`refundService`).
- **Expected:** Refund completes; status updates on booking and `PaymentEvent`; amount correct.
- **Maps:** F2.

### TC-DEP-03 — Payment status correct on booking AND in reports 🔴  [F3]
- **Steps:** Check the booking and **Reports** (`/admin/reports`) after TC-DEP-01 and TC-DEP-02.
- **Expected:** Paid then refunded reflected consistently in both places (`paymentState`, `bookingPaymentLine`).
- **Maps:** F3.

### TC-DEP-04 — Deposit amount follows the rules 🟡
- **Steps:** With different services/amounts, check the quoted deposit.
- **Expected:** Deposit matches `DepositRules` (`depositQuote`); correct when a deposit is/ isn't required.

---

## G. Daily Route screen (on a phone)  (Day 4)

### TC-ROUTE-01 — Appointments in the planned order on a phone 🔴  [G1]
- **Steps:** Open **Route** (`/admin/route`) on a phone-sized screen for a connected day.
- **Expected:** Stops listed in the order Connect planned; current stop highlighted (`dayRoute`, `routeStopStates`).
- **Maps:** G1.

### TC-ROUTE-02 — Navigation opens maps to the stop 🔴  [G2]
- **Steps:** Tap Navigate on a stop.
- **Expected:** Opens maps to that address (`navigateHref`). (Note: external map links can be unreliable inside embedded views — verify on the real device.)
- **Maps:** G2.

### TC-ROUTE-03 — Client details reachable from the stop 🟡  [G3]
- **Expected:** Name, phone, service and notes visible per stop (`CurrentStopPanel`).
- **Maps:** G3.

### TC-ROUTE-04 — Checkout works from the stop 🔴  [G4]
- **Steps:** Complete a stop / take payment (`routeCheckout`, `advanceRouteStop`).
- **Expected:** Stop advances; payment/checkout recorded; next stop becomes current.
- **Maps:** G4.

### TC-ROUTE-05 — Background location function returns no errors 🔴  [G5]
- **Steps:** Exercise live-location / ETA on the route (`liveLocation`, `getRouteEta`, `BarberLiveLocation`); watch function logs.
- **Expected:** No errors from the live-location function; ETAs update (ref `tests/liveLocation`).
- **Maps:** G5.

### TC-ROUTE-06 — Finalise the route 🟡
- **Steps:** Finalise the day's route (`finaliseRoute`).
- **Expected:** Day marked complete; `RouteExecution`/completion recorded; no further silent changes.

---

## H. Phone admin app  (Day 7)

### TC-APP-01 — Install admin app on the phone home screen 🔴  [H1]
- **Steps:** Open the app URL on the phone → Add to Home Screen.
- **Expected:** Installs as a PWA with icon; launches standalone.
- **Maps:** H1.

### TC-APP-02 — Secure login from the installed app 🔴  [H2]
- **Steps:** Open the home-screen app → log in.
- **Expected:** Auth succeeds; admin routes gated to signed-in admin (`ProtectedRoute`); logout works.
- **Maps:** H2.

### TC-APP-03 — Run the whole day from the phone 🔴  [H3]
- **Steps:** From the phone: view calendar → run/open route → confirm → checkout a stop.
- **Expected:** All core steps are usable on the phone without a desktop.
- **Maps:** H3.

---

## I. Clean-up & real setup  (Day 7)

### TC-DATA-01 — Test / demo data cleared 🔴  [I1]
- **Steps:** Run **`deleteTestData`**; review entities.
- **Expected:** Test/sample bookings, clients, payments removed; real setup intact.
- **Maps:** I1.

### TC-DATA-02 — Real services, prices, durations confirmed 🔴  [I2]
- **Expected:** `/admin/services` matches Alvaro's final list (`Service`, `AddOn`).
- **Maps:** I2.

### TC-DATA-03 — Real deposit rules confirmed 🟡  [I3]
- **Expected:** `/admin/deposit-rules` matches agreed policy (`DepositRules`).
- **Maps:** I3.

### TC-DATA-04 — Real service areas confirmed 🔴  [I4]
- **Expected:** `/admin/service-coverage` zones match where Alvaro works (`ServiceArea`).
- **Maps:** I4.

### TC-DATA-05 — Team/Staff section hidden 🟡  (pause verification)
- **Steps:** Open `/admin/settings`.
- **Expected:** No "Team & Access" section (paused for solo-operator go-live). Direct routes still exist but are not linked.

---

## J. Dress rehearsal  (Day 8)

### TC-DRESS-01 — One complete working day, end-to-end 🔴  [J1]
- **Steps:** Run a full simulated day: website booking → approve → Connect → Confirm (live SMS) → Route on phone → checkout → (deposit/refund if applicable) → finalise → reports.
- **Expected:** Every step works in sequence against the Definition of Done; issues logged.
- **Maps:** J1.

### TC-DRESS-02 — Same-day fixes 🔴  [J2]
- **Expected:** Any failure in TC-DRESS-01 is fixed on the branch the same day and re-tested; no open blocker overnight.
- **Maps:** J2.

---

## Traceability — Definition of Done (the 31st)
| DoD | Covered by |
|---|---|
| Website booking appears in calendar | TC-BOOK-01/02 |
| Connect bunches with real drive times; gaps explained | TC-CONN-01/02 |
| Confirm sends a real text with the time | TC-CONF-01/02, TC-SMS-01 |
| Reminders go out automatically | TC-REM-01/02 |
| A deposit can be taken and refunded | TC-DEP-01/02/03 |
| Whole day runs from the phone | TC-ROUTE-01→05, TC-APP-01/02/03 |
| One full day run before launch | TC-DRESS-01/02 |
