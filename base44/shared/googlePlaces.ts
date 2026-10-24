// Shared Google Places API (New) helpers — Autocomplete + Place Details.
// Uses GOOGLE_MAPS_API_KEY (server-side only). Restricted to Australia,
// biased toward Sydney NSW by default, or toward provided coordinates
// (e.g. the customer's Step 1 location) when supplied.
// The Places API (New) must be enabled in Google Cloud Console:
//   https://console.developers.google.com/apis/api/places.googleapis.com/overview

export async function placesAutocomplete(
  input: string,
  locationBias?: { lat: number; lng: number; radius?: number } | null,
): Promise<{
  suggestions: Array<{ place_id: string; description: string; main_text: string; secondary_text: string }>;
  error: string | null;
}> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { suggestions: [], error: 'GOOGLE_MAPS_API_KEY is not configured.' };

  try {
    const body: any = {
      input,
      includedRegionCodes: ['au'],
    };

    // Use caller-supplied coordinates (e.g. Step 1 suburb) for biasing when
    // available; otherwise fall back to the default Sydney CBD bias.
    if (locationBias && locationBias.lat != null && locationBias.lng != null) {
      body.locationBias = {
        circle: {
          center: { latitude: locationBias.lat, longitude: locationBias.lng },
          radius: locationBias.radius || 50000,
        },
      };
    } else {
      body.locationBias = {
        circle: {
          center: { latitude: -33.87, longitude: 151.21 },
          radius: 50000,
        },
      };
    }

    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.error) {
      return { suggestions: [], error: data.error.message || `Places API error (${data.error.status || res.status})` };
    }

    if (Array.isArray(data.suggestions)) {
      return {
        suggestions: data.suggestions
          .filter((s: any) => s.placePrediction)
          .map((s: any) => ({
            place_id: s.placePrediction.placeId,
            description: s.placePrediction.text?.text || '',
            main_text: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text?.text || '',
            secondary_text: s.placePrediction.structuredFormat?.secondaryText?.text || '',
          })),
        error: null,
      };
    }

    return { suggestions: [], error: null };
  } catch (e) {
    return { suggestions: [], error: 'Network error contacting Google Places API.' };
  }
}

export async function placesDetails(
  placeId: string,
): Promise<{
  lat: number;
  lng: number;
  formatted_address: string;
  postcode?: string;
  suburb?: string;
  state?: string;
  country?: string;
  street_number?: string;
  street_name?: string;
  place_id?: string;
  error: string | null;
}> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { lat: 0, lng: 0, formatted_address: '', error: 'GOOGLE_MAPS_API_KEY is not configured.' };

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'formattedAddress,location,addressComponents',
      },
    });

    const data = await res.json();

    if (data.error) {
      return { lat: 0, lng: 0, formatted_address: '', error: data.error.message || `Places API error (${data.error.status || res.status})` };
    }

    if (data.location) {
      let postcode = '';
      let suburb = '';
      let state = '';
      let country = '';
      let street_number = '';
      let street_name = '';
      for (const comp of data.addressComponents || []) {
        const types: string[] = comp.types || [];
        if (types.includes('postal_code')) postcode = comp.longText;
        if (types.includes('locality') || types.includes('sublocality') || types.includes('administrative_area_level_2')) {
          if (!suburb) suburb = comp.longText;
        }
        if (types.includes('administrative_area_level_1')) state = comp.shortText || comp.longText;
        if (types.includes('country')) country = comp.shortText || comp.longText;
        if (types.includes('street_number')) street_number = comp.longText;
        if (types.includes('route')) street_name = comp.longText;
      }
      return {
        lat: data.location.latitude,
        lng: data.location.longitude,
        formatted_address: data.formattedAddress || '',
        postcode,
        suburb,
        state,
        country,
        street_number,
        street_name,
        place_id: placeId,
        error: null,
      };
    }

    return { lat: 0, lng: 0, formatted_address: '', error: 'No coordinates returned for this place.' };
  } catch (e) {
    return { lat: 0, lng: 0, formatted_address: '', error: 'Network error contacting Google Places API.' };
  }
}