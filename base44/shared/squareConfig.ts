/**
 * The one place that decides whether Square is allowed to be the active payment provider.
 *
 * Every Square value is read from Base44 Secrets at runtime and from nowhere else. Nothing in this
 * file (or anywhere in the repository) holds a credential. The names below are NAMES of secrets.
 *
 * SAFE BY DEFAULT: Square is active only when ALL of these hold:
 *   1. every required secret is present and non-empty,
 *   2. SQUARE_ENVIRONMENT is exactly "sandbox" or "production",
 *   3. the live switch PAYMENTS_LIVE is exactly "true" (mirrors MESSAGING_LIVE).
 * Anything else is the test double, so adding a secret never switches payments live by itself.
 */
export const SQUARE_SECRETS = {
  accessToken: 'SQUARE_ACCESS_TOKEN',
  locationId: 'SQUARE_LOCATION_ID',
  applicationId: 'SQUARE_APPLICATION_ID',
  webhookKey: 'SQUARE_WEBHOOK_SIGNATURE_KEY',
  environment: 'SQUARE_ENVIRONMENT',
} as const;
export const LIVE_SWITCH = 'PAYMENTS_LIVE';

export type SecretReader = (name: string) => unknown;
export type SquareEnvironment = 'sandbox' | 'production';

const clean = (v: unknown) => String(v ?? '').trim();

export interface SquareStatus {
  /** The live switch is exactly "true". */
  live: boolean;
  /** Names (never values) of required secrets that are absent. */
  missing: string[];
  /** SQUARE_ENVIRONMENT is set but is neither "sandbox" nor "production". */
  invalidEnvironment: boolean;
  environment: SquareEnvironment | null;
  /** Every secret present and the environment valid. */
  complete: boolean;
  /** Square is the active provider: complete AND live. */
  active: boolean;
}

/** Safe to show to an admin: contains names and flags only, never a value. */
export function squareStatus(get: SecretReader): SquareStatus {
  const live = clean(get(LIVE_SWITCH)) === 'true';
  const missing = Object.values(SQUARE_SECRETS).filter(name => !clean(get(name)));
  const envRaw = clean(get(SQUARE_SECRETS.environment));
  const environment: SquareEnvironment | null = envRaw === 'sandbox' || envRaw === 'production' ? envRaw : null;
  const invalidEnvironment = envRaw !== '' && environment === null;
  const complete = missing.length === 0 && environment !== null;
  return { live, missing, invalidEnvironment, environment, complete, active: complete && live };
}

export interface SquareConfig {
  accessToken: string;
  locationId: string;
  applicationId: string;
  webhookKey: string;
  environment: SquareEnvironment;
  baseUrl: string;
}

const BASE_URL: Record<SquareEnvironment, string> = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

/** The full configuration, or null unless Square is active. A partial configuration is never returned. */
export function readSquareConfig(get: SecretReader): SquareConfig | null {
  const s = squareStatus(get);
  if (!s.active || !s.environment) return null;
  return {
    accessToken: clean(get(SQUARE_SECRETS.accessToken)),
    locationId: clean(get(SQUARE_SECRETS.locationId)),
    applicationId: clean(get(SQUARE_SECRETS.applicationId)),
    webhookKey: clean(get(SQUARE_SECRETS.webhookKey)),
    environment: s.environment,
    baseUrl: BASE_URL[s.environment],
  };
}