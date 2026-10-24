# Admin UI standard

Applies to every page under `/admin` **except** `/admin/route` (Route) and `/admin/schedule` (Calendar). Those two are dark on purpose: they are the screens the business is run from, not configured from. Every other admin page is light. The public site, booking flow and client status page keep their dark brand look.

## Known gap: the Calendar's colours
The Calendar (`src/pages/admin/Schedule.jsx` and its `src/components/schedule/` parts) uses hardcoded hex colours (for example `#0d0d10`, `#0a0e1a`) instead of theme tokens. That is why it stays dark. Converting it to tokens, or to light, is a separate job and has not been done. Note the layout still puts `admin-light` on `<body>` for the Calendar, so any token-based piece rendered outside the page (dialogs, selects) follows the light palette.

## How it is enforced
- `AdminSidebarLayout` adds the `admin-light` class to `<body>` on every admin page except `/admin/route` (the Calendar gets the class too, but its own hardcoded colours keep the page itself dark). `src/index.css` re-maps the colour tokens (`bg-card`, `text-foreground`, `bg-primary` …) to the light palette under that class, so token-based pages and portals (dialogs, selects) are light automatically.
- New and edited pages use the shared primitives in `src/components/admin/ui/`: `AdminPage`, `AdminCard`, `AdminSection`, `StatusBadge`. Do not copy-paste their classes.

## Rules
- **Page container:** `p-5 sm:p-6 lg:p-8 max-w-[1400px] mx-auto` (`AdminPage`)
- **Page title:** `text-2xl sm:text-3xl font-bold text-zinc-900`; subtitle `text-sm text-zinc-500 mt-1`
- **Section heading:** `font-semibold text-zinc-900`
- **Card:** `bg-white border border-zinc-200 rounded-xl`, padding `p-3.5`–`p-4` (`AdminCard`)
- **Primary button:** shadcn `Button` (`bg-zinc-900 hover:bg-zinc-800 text-white`; under `admin-light`, `bg-primary` is zinc-900). Secondary: bordered zinc. Destructive: red.
- **Links / inline actions:** `text-indigo-600 hover:text-indigo-700`
- **Status colours (`StatusBadge`):** emerald = sent/delivered/success · amber = waiting/warning · red = failed/dead-letter · violet = test data · zinc = neutral or suppressed
- **Inputs:** shadcn `Input`, never raw `<input>` with ad-hoc classes
- **Spacing:** 4/8 scale (`gap-2`, `gap-3`, `space-y-5`); radius `rounded-xl` for cards, `rounded-lg` for controls
- **States:** loading = spinner or `Loading…` in zinc-500; empty = `EmptyState`; error = `ErrorState` with retry. No state may be removed in a restyle.
- **Mobile:** works at 360–375px, no horizontal scroll; tables become stacked cards.

## Scheduling core (protected files)
`schedulingValidator.ts`, `reshuffleEngine.ts`, `routeFlowOptimiser.ts`, `routeFlowEngine.ts`, `dayRoute.ts` and `appointmentTiming.ts` (all in `base44/shared/`) are protected: their **behaviour must not change** without an explicit request.
- `dayRoute.ts` **may be extended through extraction with a re-export**: move a self-contained helper into its own module, import it back and `export { … }` it from `dayRoute.ts`, so every existing importer keeps working. The moved code must be character-identical (no behaviour, signature or ordering change), and there must be exactly ONE copy of any helper that route reconciliation depends on (`routeFingerprint`, `isBlockRow`, `isRouteAppointment`). Never duplicate those to avoid touching the file: copies drift. Trivial local helpers with no shared contract (for example the three-line `num()` coercion) may be duplicated.
- Current example: `isBlockRow`, `isRouteAppointment` and `routeFingerprint` live in `routeFingerprint.ts` and are re-exported by `dayRoute.ts`. Route reconciliation depends on that one fingerprint.
- Flag any such change to the owner when it is made, not only when asked.
## AI assistant: the one booking exception
The inbound assistant never updates, moves, confirms or cancels a booking. The single exception: when a **known client** accepts a time the scheduling engine returned in that conversation, it may **create** a BookingRequest.
- Only through the shared creator (`publicBookingCreate.ts`, assistant option) — never by writing the entity directly.
- Only as `pending`, source "Assistant Booking", created already placed and `locked` with `assistant_promised_time`, so Route Flow auto-place and reshuffle cannot move the time the customer was told.
- Only after the slot is re-validated at the moment of acceptance (`placementRevalidate.ts`). A gone slot is never booked.
- Time text from the model is discarded; only engine-returned slots are offered. Strangers and clients with no history get the booking link.
- Guarded by `tests/assistantBooking.test.mjs`.
