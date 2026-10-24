/**
 * Deposit rules engine. Pure: takes a booking's risk inputs and the saved rules
 * and says whether a deposit is required, how much, which rules fired and why.
 * Every amount and threshold comes from the saved rules; nothing is hardcoded.
 * With no saved rules, or the master switch off, nothing is ever required.
 */
export interface DepositRules {
  enabled?: boolean;
  deposit_type?: 'fixed' | 'percentage';
  deposit_amount?: number;
  min_no_shows?: number;
  no_show_deposit_amount?: number;
  new_client_deposit_amount?: number;
  after_hours_deposit_amount?: number;
  group_min_people?: number;
  link_expiry_hours?: number;
  allow_waive?: boolean;
}

export interface DepositInput {
  price: number;
  people: number;
  isNewClient: boolean;
  noShowCount: number;
  isAfterHours: boolean;
  isTest?: boolean;
}

export interface DepositDecision {
  required: boolean;
  amount: number;
  /** Machine keys of every rule that fired. */
  rules: string[];
  /** Short plain-language reason per fired rule. */
  reasons: string[];
  /** One sentence for the admin: why the deposit was asked for. */
  reason_text: string;
  note: string;
}

const num = (v: any, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

export function evaluateDeposit(input: DepositInput, rules: DepositRules | null | undefined): DepositDecision {
  const none = (note: string): DepositDecision => ({ required: false, amount: 0, rules: [], reasons: [], reason_text: '', note });
  if (!rules || rules.enabled !== true) return none('Deposits are switched off.');
  if (input.isTest === true) return none('Test bookings never need a deposit.');

  const price = Math.max(0, num(input.price));
  const fired: { key: string; reason: string; amount: number }[] = [];

  const newAmt = Math.max(0, num(rules.new_client_deposit_amount));
  if (input.isNewClient && newAmt > 0) fired.push({ key: 'new_client', reason: 'new client', amount: newAmt });

  const ahAmt = Math.max(0, num(rules.after_hours_deposit_amount));
  if (input.isAfterHours && ahAmt > 0) fired.push({ key: 'after_hours', reason: 'after-hours booking', amount: ahAmt });

  const minPeople = num(rules.group_min_people);
  if (minPeople > 0 && num(input.people, 1) >= minPeople) {
    const raw = rules.deposit_type === 'percentage'
      ? price * Math.min(100, Math.max(0, num(rules.deposit_amount))) / 100
      : Math.max(0, num(rules.deposit_amount));
    if (raw > 0) fired.push({ key: 'group', reason: `group of ${input.people}`, amount: raw });
  }

  const minNoShows = num(rules.min_no_shows);
  const nsAmt = Math.max(0, num(rules.no_show_deposit_amount));
  if (minNoShows > 0 && num(input.noShowCount) >= minNoShows && nsAmt > 0) {
    fired.push({ key: 'no_shows', reason: `${input.noShowCount} earlier no-show${input.noShowCount === 1 ? '' : 's'}`, amount: nsAmt });
  }

  if (fired.length === 0) return none('No deposit rule applies.');

  // The largest fired deposit applies; rules never stack.
  const amount = r2(Math.min(price, Math.max(...fired.map((f) => f.amount))));
  const reasons = fired.map((f) => `${f.reason} (${money(r2(Math.min(price, f.amount)))})`);
  if (amount <= 0) return { ...none('A rule applies but the deposit works out to $0.'), rules: fired.map((f) => f.key), reasons };
  return {
    required: true,
    amount,
    rules: fired.map((f) => f.key),
    reasons,
    reason_text: `Deposit required: ${money(amount)}, ${fired.map((f) => f.reason).join(' + ')}.`,
    note: `Deposit of ${money(amount)} required.`,
  };
}