import { base44 } from '@/api/base44Client';

// Reads everything the business report needs. Every query filters on the server
// (test data out, date range in) and pages with a cursor, so nothing is cut off.
const PAGE = 1000;
const MAX_PAGES = 10;
const CHUNK = 80;

async function fetchAll(entity, query, sort = 'created_date') {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await entity.filter(query, { sort, limit: PAGE, ...(cursor ? { cursor } : {}) });
    out.push(...(page.items || []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

const chunks = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
};

export async function loadReportData(fromStr, toStr) {
  const E = base44.entities;
  const notTest = { is_test: { $ne: true } };
  const [bookings, dayRoutes, logs, regulars] = await Promise.all([
    fetchAll(E.BookingRequest, { ...notTest, requested_date: { $gte: fromStr, $lte: toStr } }, 'requested_date'),
    fetchAll(E.DayRoute, { ...notTest, date: { $gte: fromStr, $lte: toStr } }, 'date'),
    fetchAll(E.ActivityLog, { event_type: 'route_finalised', schedule_date: { $gte: fromStr, $lte: toStr } }),
    fetchAll(E.ReminderClient, { ...notTest, recurring_enabled: true }),
  ]);

  const completed = bookings.filter((b) => b.status === 'completed');
  const completedIds = completed.map((b) => b.id);
  const clientIds = [...new Set(completed.map((b) => b.client_id).filter(Boolean))];

  const [paymentSets, priorSets] = await Promise.all([
    Promise.all(chunks(completedIds).map((ids) => fetchAll(E.BookingPayment, { ...notTest, booking_request_id: { $in: ids } }))),
    Promise.all(chunks(clientIds).map((ids) => fetchAll(E.BookingRequest, {
      ...notTest, status: 'completed', requested_date: { $lt: fromStr }, client_id: { $in: ids },
    }))),
  ]);

  return {
    bookings,
    dayRoutes,
    logs,
    regulars,
    payments: paymentSets.flat(),
    priorClientIds: [...new Set(priorSets.flat().map((b) => b.client_id).filter(Boolean))],
  };
}