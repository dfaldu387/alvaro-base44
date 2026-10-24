# Cut Deluxe

A mobile booking and scheduling tool for professional barbers. Customers book online; the barber manages availability, routes and appointments from an admin dashboard.

## Features

- Public homepage and a step-by-step booking flow (Service, Availability, Details, Review)
- Admin dashboard: requests, schedule calendar, route planning and finalisation
- Service coverage zones, booking rules and deposit rules
- Client workflow, reminders and messaging (SMS) with safety controls
- Customer booking status and live arrival tracking
- Payments via Square, and Google Calendar sync per barber

## Tech stack

- React + Vite + Tailwind CSS
- Base44 backend (entities, backend functions, workflows)

## Project structure

- `src/pages/` – app pages (public and admin)
- `src/components/` – UI components
- `base44/entities/` – data schemas
- `base44/functions/` – backend functions
- `base44/shared/` – shared backend logic
- `tests/` – automated tests

## Getting started

1. Install dependencies: `npm install`
2. Run locally: `npm run dev`
3. Run tests: `npm test`

Secrets (Square, Mapbox, Twilio) are configured in the Base44 dashboard under Secrets.