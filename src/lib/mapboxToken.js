import { base44 } from '@/api/base44Client';

// Fetches the Mapbox access token and caches it for the lifetime of the page.
// The token never appears in frontend source code — it is stored as the
// MAPBOX_ACCESS_TOKEN secret and served by the getMapboxToken backend function
// (admin) or included in the public data response (customer pages).
let cachedToken = null;
let tokenPromise = null;

// Set the token directly (used by public pages that receive it from the
// publicHomepageData / publicBookingData response).
export function setMapboxToken(token) {
  if (token) cachedToken = token;
}

export function getMapboxToken() {
  if (cachedToken) return Promise.resolve(cachedToken);
  if (!tokenPromise) {
    tokenPromise = base44.functions
      .invoke('getMapboxToken')
      .then((res) => {
        cachedToken = res.data.token;
        return cachedToken;
      })
      .catch((e) => {
        tokenPromise = null;
        throw e;
      });
  }
  return tokenPromise;
}