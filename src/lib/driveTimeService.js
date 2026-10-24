/**
 * Drive Time Service
 *
 * Currently uses InvokeLLM with internet access to approximate driving times.
 *
 * TO SWAP TO GOOGLE MAPS LATER:
 * Replace `calculatePair` with a call to your backend function, e.g.:
 *
 *   const res = await base44.functions.getDriveTimes({ pairs });
 *
 * The backend function would call the Google Maps Directions API securely
 * using GOOGLE_MAPS_API_KEY stored as a server-side environment secret.
 * The shape of the returned result object must stay the same:
 *   { [key]: { state: 'ok'|'error'|'missing_address', mins: number|null, km: number|null } }
 */

import { base44 } from '@/api/base44Client';

/**
 * Calculate driving time for a single origin→destination pair.
 * @returns {{ state: string, mins: number|null, km: number|null }}
 */
export async function calculatePair(origin, destination) {
  if (!origin?.trim() || !destination?.trim()) {
    return { state: 'missing_address', mins: null, km: null };
  }
  try {
    const res = await base44.integrations.Core.InvokeLLM({
      model: 'gemini_3_flash',
      add_context_from_internet: true,
      prompt: `What is the estimated driving time in minutes between these two addresses in Australia?
Origin: ${origin}
Destination: ${destination}
Return ONLY a JSON object with keys durationMins (integer) and distanceKm (number, one decimal place). No other text.`,
      response_json_schema: {
        type: 'object',
        properties: {
          durationMins: { type: 'number' },
          distanceKm: { type: 'number' },
        },
      },
    });
    if (res?.durationMins != null) {
      return {
        state: 'ok',
        mins: Math.round(res.durationMins),
        km: res.distanceKm != null ? parseFloat(res.distanceKm.toFixed(1)) : null,
      };
    }
    return { state: 'error', mins: null, km: null };
  } catch {
    return { state: 'error', mins: null, km: null };
  }
}

/**
 * Calculate drive times for an ordered list of stops.
 * @param {Array<{ id, address }>} stops
 * @param {function} onUpdate - called with partial results as each pair resolves
 * @returns {Promise<Record<string, { state, mins, km }>>}
 */
export async function calculateDriveTimes(stops, onUpdate) {
  if (stops.length < 2) return {};

  const pairs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    pairs.push({
      key: `${stops[i].id}_${stops[i + 1].id}`,
      origin: stops[i].address,
      destination: stops[i + 1].address,
    });
  }

  // Mark all pairs as loading immediately
  const loadingState = {};
  pairs.forEach(p => { loadingState[p.key] = { state: 'loading', mins: null, km: null }; });
  if (onUpdate) onUpdate(loadingState);

  // Resolve each pair; call onUpdate as each one finishes
  const results = { ...loadingState };
  await Promise.all(pairs.map(async (pair) => {
    const result = await calculatePair(pair.origin, pair.destination);
    results[pair.key] = result;
    if (onUpdate) onUpdate({ ...results });
  }));

  return results;
}