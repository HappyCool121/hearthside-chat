import { failure, type Env } from './adrouter';

export interface Context { request: Request; env: Env; next(): Promise<Response> }
export const GATEWAY_ORIGIN = 'https://adrouter-v3.fly.dev';
export const CSP = `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com ${GATEWAY_ORIGIN}; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;

export function protect(response: Response) {
  const headers = new Headers(response.headers);
  // Keep the SDK's no-transform so the streamed reply is forwarded unchanged.
  headers.set('Cache-Control', headers.get('Cache-Control')?.includes('no-transform') ? 'no-store, no-transform' : 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Content-Security-Policy', CSP);
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function errorResponse() {
  return protect(failure('service_unavailable'));
}
