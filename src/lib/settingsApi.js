import { base44 } from '@/api/base44Client';

/**
 * The browser's only way to change business settings. Send just the fields the screen owns:
 * the server refuses anything else, so one screen can never blank another screen's fields.
 * Resolves to the saved row, or throws an Error whose message is safe to show.
 */
export async function saveSettings(entity, screen, data) {
  let res;
  try {
    res = await base44.functions.invoke('saveSettings', { entity, screen, data });
  } catch (e) {
    throw new Error(e?.response?.data?.error || 'The settings could not be saved. Please try again.');
  }
  if (!res?.data?.success) throw new Error(res?.data?.error || 'The settings could not be saved. Please try again.');
  return res.data.row;
}