/**
 * Strip a `token=...` query value from a URL before it is logged or sent to an
 * error tracker. The WebSocket tracking handshake carries the JWT in the query
 * string (ws://host/?token=...), because browsers can't set headers on a WS
 * upgrade — so any place that logs a raw URL could leak a valid token.
 */
export function redactTokenInUrl(url?: string): string {
  return url ? url.replace(/([?&])token=[^&]*/gi, '$1token=***') : (url ?? '');
}
