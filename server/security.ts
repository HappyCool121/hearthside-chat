export interface Bindings {
  PUBLIC_ORIGIN?: string;
  STANDALONE_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SESSION_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
}
export interface Context { request: Request; env: Bindings; next(): Promise<Response> }
export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const COOKIE = '__Host-hearthside';
const encoder = new TextEncoder();
const SESSION_SECONDS = 86_400;
export function exactOrigin(request: Request, env: Bindings) {
  let expected: URL;
  try { expected = new URL(env.PUBLIC_ORIGIN ?? ''); } catch { throw new HttpError(503, 'not_configured'); }
  if (expected.protocol !== 'https:' || expected.origin !== env.PUBLIC_ORIGIN)
    throw new HttpError(503, 'not_configured');
  if (request.headers.get('Origin') !== expected.origin || new URL(request.url).origin !== expected.origin ||
    (request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin'))
    throw new HttpError(403, 'origin_rejected');
}
function base64url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError(401, 'session_required');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function key(env: Bindings) {
  if (!env.SESSION_SECRET || encoder.encode(env.SESSION_SECRET).length < 32) throw new HttpError(503, 'not_configured');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function issueSession(env: Bindings, now = Date.now()) {
  const value = base64url(encoder.encode(JSON.stringify({ id: crypto.randomUUID(), exp: Math.floor(now / 1000) + SESSION_SECONDS })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(value))));
  return `${COOKIE}=${value}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export async function verifySession(request: Request, env: Bindings, now = Date.now()) {
  const values = (request.headers.get('Cookie') ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
  if (values.length !== 1 || values[0].length > 512) throw new HttpError(401, 'session_required');
  try {
    const parts = values[0].slice(COOKIE.length + 1).split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(env), decode(parts[1]), encoder.encode(parts[0])))
      throw new Error();
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (typeof payload.id !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.id) || !Number.isSafeInteger(payload.exp) ||
      payload.exp <= now / 1000 || payload.exp > now / 1000 + SESSION_SECONDS + 60) throw new Error();
    return payload.id as string;
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) throw error;
    throw new HttpError(401, 'session_required');
  }
}
export async function boundedJson(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'json_required');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 65_536)) throw new HttpError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_request');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new HttpError(413, 'body_too_large'); }
      chunks.push(next.value);
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown; }
    catch { throw new HttpError(400, 'invalid_request'); }
  } finally { reader.releaseLock(); }
}
export function protect(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function errorResponse(error: unknown) {
  const known = error instanceof HttpError ? error : new HttpError(503, 'temporarily_unavailable');
  return protect(Response.json({ error: known.code }, { status: known.status }));
}
