import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';

// Returns the Mapbox public access token to authenticated app users.
// The token is stored as the MAPBOX_ACCESS_TOKEN secret and never appears
// in frontend source code. Both admin and user roles can view service zones,
// so any authenticated user may fetch the token.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = secrets.get('CUTDELUXEMAP') || secrets.get('MAPBOX_ACCESS_TOKEN');
    if (!token) return Response.json({ error: 'MAPBOX_ACCESS_TOKEN not configured.' }, { status: 500 });
    return Response.json({ token });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}