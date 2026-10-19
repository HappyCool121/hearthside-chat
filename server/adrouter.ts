import { createPublisherProxy } from '@adrouter/browser-sdk/server';

// Hearthside keeps its standalone binding names. The comments give the SDK README's names.
export interface Env {
  PUBLIC_ORIGIN?: string; // PUBLISHER_ORIGIN
  ADROUTER_GATEWAY_ORIGIN?: string;
  ADROUTER_MODEL?: string;
  ADROUTER_ENABLED?: string;
  ADROUTER_APP_CREDENTIAL?: string;
  ADROUTER_PROVIDER_CONNECTION_ID?: string;
  ADROUTER_PLACEMENT_ID?: string;
  REFERENCE_HMAC_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string; // TURNSTILE_SECRET
  SESSION_SECRET?: string; // SESSION_SIGNING_SECRET
}

export const SYSTEM = 'You are Rowan, the kind and quietly witty keeper of the Wayfarer, a small inn beside an ancient forest. Welcome the visitor into a fictional, cosy roleplay. Speak as Rowan in short, natural paragraphs, leave room for the visitor to shape the story, and ask at most one question at a time. Be honest that you are an AI character if asked. Never claim real-world actions, professional qualifications or knowledge of the visitor beyond this conversation. Avoid graphic or sexual content. If the visitor is in danger or asks for serious real-world help, step out of the story and respond calmly and practically.';

const REQUIRED = ['PUBLIC_ORIGIN', 'ADROUTER_GATEWAY_ORIGIN', 'ADROUTER_MODEL', 'ADROUTER_APP_CREDENTIAL',
  'ADROUTER_PROVIDER_CONNECTION_ID', 'ADROUTER_PLACEMENT_ID', 'REFERENCE_HMAC_SECRET', 'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY', 'SESSION_SECRET'] as const;

// The explicit publisher switch. It defaults to paused and never falls back to direct inference.
export const enabled = (env: Env) => env.ADROUTER_ENABLED === 'true' && REQUIRED.every(name => Boolean(env[name]));

export function failure(code: 'app_disabled' | 'service_unavailable', status = 503) {
  return Response.json({ error: { code, message: code.replaceAll('_', ' '), retryable: code === 'service_unavailable' },
    request_id: crypto.randomUUID() }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function publisher(env: Env) {
  return createPublisherProxy({
    gatewayOrigin: env.ADROUTER_GATEWAY_ORIGIN ?? '',
    allowedOrigin: env.PUBLIC_ORIGIN ?? '',
    appCredential: env.ADROUTER_APP_CREDENTIAL ?? '',
    providerConnectionId: env.ADROUTER_PROVIDER_CONNECTION_ID ?? '',
    placementId: env.ADROUTER_PLACEMENT_ID ?? '',
    model: env.ADROUTER_MODEL ?? '',
    systemInstruction: SYSTEM,
    sessionSigningSecret: env.SESSION_SECRET ?? '',
    referenceHmacSecret: env.REFERENCE_HMAC_SECRET ?? '',
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? '',
  });
}
