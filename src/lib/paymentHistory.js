// A booking's payment history, built from its PaymentEvent rows. Pure: no network, no React.
export const EVENT_LABELS = {
  evaluated: 'Deposit rules checked',
  payment_received: 'Payment received',
  provider_payment: 'Payment confirmed by the provider',
  provider_webhook_payment: 'Payment received (Square)',
  deposit_waived: 'Deposit waived',
  link_requested: 'Payment link made',
  refund_recorded: 'Refund recorded',
  provider_webhook_refund: 'Refund update (Square)',
  refund_resolved: 'Refund paid out',
  written_off: 'Written off',
  migrated: 'Payment record created',
  provider_webhook_ignored: 'Square update not applied',
};

const when = (e) => e.created_date || e.timestamp || '';

/** Newest first. `labels` maps a payment state to its display name. */
export function historyRows(events, labels = {}) {
  return [...(events || [])]
    .sort((a, b) => String(when(b)).localeCompare(String(when(a))))
    .map((e) => ({
      id: e.id,
      label: EVENT_LABELS[e.event_type] || String(e.event_type || 'Payment event').replace(/_/g, ' '),
      when: when(e),
      actor: e.actor || 'System',
      amount: typeof e.amount === 'number' && e.amount > 0 ? e.amount : null,
      simulated: e.is_simulated === true,
      providerEventId: e.provider_event_id || '',
      note: e.note || '',
      change: e.from_state && e.to_state && e.from_state !== e.to_state
        ? `${labels[e.from_state] || e.from_state} → ${labels[e.to_state] || e.to_state}` : '',
    }));
}