import { base44 } from '@/api/base44Client';

/**
 * The browser's only way to create a booking, a request or a Block Time row.
 * The server (createAdminBooking) decides the price, duration, group size, coverage
 * and test flag; this sends choices (service names and how many), never numbers.
 *
 * `submissionToken` comes from useSubmissionToken(): one per open modal, sent
 * unchanged on every retry of that save. Resolves to the saved booking row, or
 * throws an Error whose message is safe to show.
 */
export async function createAdminBooking(submissionToken, fields, { onCapacity } = {}) {
  let res;
  try {
    res = await base44.functions.invoke('createAdminBooking', { ...fields, submission_token: submissionToken });
  } catch (e) {
    const body = e?.response?.data;
    // Validation refusals name the fields; without them the message is unactionable.
    const detail = Array.isArray(body?.details) && body.details.length ? ` (${body.details.join('; ')})` : '';
    throw new Error((body?.error ? body.error + detail : '') || 'The booking could not be saved. Please try again.');
  }
  const data = res?.data;
  if (!data?.success || !data?.booking) throw new Error(data?.error || 'The booking could not be saved. Please try again.');
  // A full day is reported, never a reason to refuse: the booking is already saved.
  if (data.capacity_reason && onCapacity) onCapacity(data.capacity_reason);
  return data.booking;
}

/**
 * Create client records on the server (the only way the browser makes them). The server decides
 * is_test from the name; any flag sent here is ignored. With matchExisting, an exact phone or
 * email match updates that client instead. Resolves to { created, updated } or throws a readable Error.
 */
export async function createAdminClients(clients, { matchExisting = false } = {}) {
  let res;
  try {
    res = await base44.functions.invoke('createAdminClients', { clients, match_existing: matchExisting });
  } catch (e) {
    throw new Error(e?.response?.data?.error || 'The client could not be saved. Please try again.');
  }
  if (!res?.data?.success) throw new Error(res?.data?.error || 'The client could not be saved. Please try again.');
  return { created: res.data.created || [], updated: res.data.updated || [] };
}

/** Merge a duplicate client into the one being kept. Resolves to the server's summary or throws a readable Error. */
export async function mergeClients(survivorId, duplicateId) {
  let res;
  try {
    res = await base44.functions.invoke('mergeClients', { survivor_id: survivorId, duplicate_id: duplicateId });
  } catch (e) {
    throw new Error(e?.response?.data?.error || 'The merge could not be completed. Please try again.');
  }
  if (!res?.data?.merged) throw new Error(res?.data?.error || 'The merge could not be completed. Please try again.');
  return res.data;
}