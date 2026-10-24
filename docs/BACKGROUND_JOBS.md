# Background jobs

Every automated job writes one `JobHeartbeat` row (one per job, updated on each run).

| Job key | What it does | How it runs | Quiet is a failure? |
|---|---|---|---|
| `sweep` | Sends queued messages from the outbox (`processMessageOutbox`) | Scheduled workflow `MessageSweep` | Yes |
| `arrival` | Night-before arrival-time messages (`sendArrivalTimes`) | Scheduled workflow `ArrivalTimes`, hourly; acts from `arrival_send_hour` | Yes |
| `campaign` | Regular-client reminder campaign (`campaignRun`) | Scheduled workflow `CampaignRun`, hourly; acts on the configured day and hour | Yes |
| `autoplace` | Route Flow places a new booking request (`routeFlowAutoPlaceV2`) | Entity trigger: a booking request is created | No. A quiet day is normal |
| `reshuffle` | Route Flow re-evaluates a provisional day (`optimiseProvisionalDay`) | Entity trigger: a booking request changes | No. A quiet day is normal |

## Outcomes
- `acted`: the run did work.
- `no_op`: it ran and correctly did nothing (wrong day or hour, empty queue).
- `failed`: it hit an error; `last_error` holds a safe description.

## Dead letters
A message that fails repeatedly becomes `dead_letter`. An admin can re-queue it from the
Automation page (`requeueDeadLetter`). It is refused if the booking is cancelled or the
customer has opted out or declined messaging. Re-queueing sends nothing itself; the normal
sweep applies every guard. Each re-queue is written to the activity log.