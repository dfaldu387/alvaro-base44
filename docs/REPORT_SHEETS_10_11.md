# Report: sheets 10 and 11

Test run: `node --test --test-concurrency=1 "tests/*.test.mjs"` gives **340 tests, 340 pass, 0 fail**.
The production build is clean.

## Sheet 10: capacity and Booking Rules

### Capacity rules (as shipped, now pinned by `tests/publicCapacity.test.mjs`, 17 tests)
- A day is full when it already has the limit of confirmed or completed bookings. The limit is `max_bookings_per_day` from the settings record, default 8.
- A day with room is offered only if a gap in the barber's working hours can hold the shortest service plus its buffer, with a 10 minute travel allowance on each side that touches another booking.
- Both rules can only close a day. Neither can open a day the count rule would close.
- The booking page and the submit endpoint use the same rules (`publicDayFit.ts`). The browser cannot change the server's count.
- Blocks, including Google Calendar blocks, hold the barber's time. Another barber's bookings do not.
- A booking for a day that has filled up is saved but held for review, with a readable reason (for example "This day already has 3 confirmed bookings (limit 3)"). It is not rejected.

### Booking Rules enforcement
Booking Window and Auto-accept are enforced server-side. The 14 settings below are saved but nothing reads them. Each is now labelled "Not in effect yet" on screen, with a plain-words note on its group of settings:
- allow_multiple_services
- max_services_per_booking
- default_buffer_minutes
- appointment_interval_minutes
- booking_cutoff_hour
- min_availability_window_hours
- max_availability_window_hours
- service_must_fit_window
- buffer_can_extend_past_window
- core_service_areas
- out_of_area_after_3pm
- cancellation_policy
- allow_client_reschedule
- client_reschedule_needs_approval

None was enforced, because each would change which bookings are accepted. That is a decision for the business.

### Outstanding defects
1. The capacity limit is not a Booking Rules field. It lives in a separate settings record, so the Booking Rules page gives no way to change it.
2. The 14 settings above do nothing until they are implemented or removed.
3. Route Flow auto-placement (`routeFlowAutoPlaceV2`) is not yet gated against finalised days.
4. `SQUARE_WEBHOOK_SIGNATURE_KEY` is not configured, so Square payment events are not processed. The deposit and balance flows have not been tested end to end in the sandbox.
5. Message templates are missing for booking_received, booking_confirmed, booking_cancelled, no_show_followup and both rebooking messages.

## Sheet 11: customer states, audit log, appointment edits

- **Customer states.** "Barber preparing" and "Arriving soon" are worked out for the tracking view only and are never stored.
  - "Arriving soon" shows when the barber is on the way and the arrival estimate is within 10 minutes.
  - "Barber preparing" shows when nobody is ahead of the customer and the estimate is within 30 minutes.
  - If the estimate is missing or more than 10 minutes out of date, the customer sees "On the way" or "Confirmed" instead.
  - Tests are in `tests/customerState.test.mjs`.
- **Audit Log** (`/admin/audit`, admins only). It is a read-only view of the server-side activity log, with filters and "show older". It is separate from Route Flow Activity.
- **Appointment detail edits now go through the server.** Services and notes save through `updateBookingRequest`, which checks permission, recalculates duration and price from the catalogue, and writes an audit entry.
  - `participants` is now the record occupancy is timed from. It is rebuilt from the same list as `services`, so the two cannot disagree. This is `planFlatServiceEdit`, tested in `tests/serviceEdit.test.mjs`.
  - A group booking, or a list that would need a second person, is refused with a readable reason. The side panel also tells the person to use Edit on the booking in Bookings. The server refuses even if the panel is bypassed.
  - The address is read-only in the side panel, because the server only accepts addresses picked from the verified suggestions.
  - Source guards stop the browser writing to a booking directly from these two components.
  - Not yet verified in the live preview: the click-through of the edit panel.
- **Browser writes that remain.** Other components still create booking records directly from the browser: the Add Request, Add Booking, Create Booking, Add Client and Block Time modals, and the Client Workflow page. The Clients page merge also updates bookings by client name. These were not part of this sheet. They should move to server functions in a later pass.