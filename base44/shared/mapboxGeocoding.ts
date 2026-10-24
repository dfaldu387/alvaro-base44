// Shared Mapbox Geocoding API helpers — used by mapboxGeocode (public
// autocomplete) and geocodeAddress (admin/fallback geocoding).
// The Mapbox public token is read from the CUTDELUXEMAP / MAPBOX_ACCESS_TOKEN
// secret and never appears in frontend source code.
// Mapbox Geocoding returns coordinates directly in search results, so a
// separate "place details" call is not needed (unlike Google Places).

interface MapboxSuggestion {
  place_id: string;
  mapbox_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
  lat: number;
  lng: number;
  formatted_address: string;
  postcode: string;
  suburb: string;
  state: string;
  country: string;
  street_number: string;
  street_name: string;
}

function getMapboxToken(): string {
  return process.env.CUTDELUXEMAP || process.env.MAPBOX_ACCESS_TOKEN || '';
}

// Parse Mapbox context array into structured address components.
function parseContext(context: any[]): { postcode: string; suburb: string; state: string; country: string } {
  let postcode = '', suburb = '', state = '', country = '';
  for (const c of (context || [])) {
    const id = String(c.id || '');
    if (id.startsWith('postcode')) postcode = c.text || '';
    else if (id.startsWith('locality') || id.startsWith('place')) { if (!suburb) suburb = c.text || ''; }
    else if (id.startsWith('region')) state = c.text || '';
    else if (id.startsWith('country')) country = c.text || '';
  }
  return { postcode, suburb, state, country };
}

// Forward geocoding search — returns up to 5 suggestions, each with full
// structured address data and coordinates. Optional proximity bias toward
// the customer's Step 1 location (or Sydney CBD by default).
export async function mapboxGeocodeSearch(
  query: string,
  proximity?: { lat: number; lng: number } | null,
): Promise<{ suggestions: MapboxSuggestion[]; error: string | null }> {
  const token = getMapboxToken();
  if (!token) return { suggestions: [], error: 'Mapbox is not configured.' };

  try {
    const params = new URLSearchParams({
      access_token: token,
      country: 'au',
      limit: '5',
      language: 'en',
    });
    if (proximity && proximity.lat != null && proximity.lng != null) {
      params.set('proximity', `${proximity.lng},${proximity.lat}`);
    } else {
      // Default bias toward Sydney CBD
      params.set('proximity', '151.21,-33.87');
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { suggestions: [], error: "We couldn't search addresses right now. Please try again." };
    }
    const data = await res.json();
    if (data.error) {
      return { suggestions: [], error: "We couldn't search addresses right now. Please try again." };
    }

    const features: MapboxSuggestion[] = (data.features || []).map((f: any) => {
      const { postcode, suburb, state, country } = parseContext(f.context || []);
      const placeName: string = f.place_name || '';
      const commaIdx = placeName.indexOf(',');
      const mainText = commaIdx > 0 ? placeName.substring(0, commaIdx) : placeName;
      const secondaryText = commaIdx > 0 ? placeName.substring(commaIdx + 1).trim() : '';
      return {
        place_id: f.id || '',
        mapbox_id: f.id || '',
        description: placeName,
        main_text: mainText,
        secondary_text: secondaryText,
        lat: f.center ? f.center[1] : 0,
        lng: f.center ? f.center[0] : 0,
        formatted_address: placeName,
        postcode,
        suburb,
        state,
        country,
        street_number: f.address || '',
        street_name: f.text || '',
      };
    });

    return { suggestions: features, error: null };
  } catch (e) {
    return { suggestions: [], error: "We couldn't search addresses right now. Please try again." };
  }
}

// Single-address geocoding — returns the best match for a given address
// string. Used by geocodeAddress (admin) and other server-side geocoding.
export async function mapboxGeocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; formatted_address?: string } | null> {
  const token = getMapboxToken();
  if (!token || !address) return null;

  try {
    const params = new URLSearchParams({
      access_token: token,
      country: 'au',
      limit: '1',
      language: 'en',
    });
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?${params}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const f = data.features[0];
      return { lat: f.center[1], lng: f.center[0], formatted_address: f.place_name };
    }
    return null;
  } catch (e) {
    return null;
  }
}