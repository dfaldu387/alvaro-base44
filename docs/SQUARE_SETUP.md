# Square payments: setup for Alvaro

Square is OFF until every secret below is set AND the live switch is turned on. Until then the app uses the
simulated test payment system and the webhook answers 503. Names only: never paste a value into code or chat.

## Secrets to add (Base44 dashboard, Secrets)

| Secret name | What it is |
| --- | --- |
| SQUARE_ACCESS_TOKEN | Square access token for the environment below |
| SQUARE_LOCATION_ID | Square location the payment links belong to |
| SQUARE_APPLICATION_ID | Square application id |
| SQUARE_WEBHOOK_SIGNATURE_KEY | The signature key Square shows for the webhook subscription |
| SQUARE_ENVIRONMENT | Exactly `sandbox` or `production` |
| PAYMENTS_LIVE | The live switch. Exactly `true` turns Square on. Anything else keeps the simulated system |

Adding the five Square secrets does nothing by itself. Setting PAYMENTS_LIVE to `true` is the one deliberate act.
Start with `sandbox`. Admin > Payments shows which provider is active; production is a red LIVE banner.

## Square dashboard

Notification URL (paste exactly, no trailing slash):

    https://cut-deluxe.base44.app/functions/squareWebhook

Subscribe to these event types only:

- `payment.updated` (Square has no separate "payment completed" event: a completed payment arrives as payment.updated with status COMPLETED)
- `refund.updated`

Square signs the notification URL together with the body, so the URL registered in Square must match the
app's public address exactly (APP_BASE_URL must be set to `https://cut-deluxe.base44.app`).