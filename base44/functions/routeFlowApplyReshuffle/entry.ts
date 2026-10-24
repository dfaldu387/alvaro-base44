/**
 * RETIRED — replaced by routeFlowApplyReshuffleV2.
 *
 * This legacy route is intentionally inert: it reads nothing, writes nothing and
 * performs no scheduling work for any caller, authenticated or not.
 */
export default async function (_req) {
  return Response.json(
    { error: 'This endpoint has been retired.', code: 'ENDPOINT_RETIRED', replacement: 'routeFlowApplyReshuffleV2' },
    { status: 410 },
  );
}