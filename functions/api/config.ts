import { MODEL } from '../../server/chat';
import { ADROUTER_API_ORIGIN, type Context } from '../../server/security';
// Chat and sponsors switch independently: AdRouter being off, paused or down never stops Rowan.
export function onRequestGet({ env }: Context) {
  const enabled = env.CHAT_ENABLED === 'true' && Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.SESSION_SECRET && env.DEEPSEEK_API_KEY);
  const sponsors = env.ADROUTER_ENABLED === 'true' && /^v3pk_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(env.ADROUTER_PUBLIC_KEY ?? '')
    ? { publicKey: env.ADROUTER_PUBLIC_KEY!, apiOrigin: ADROUTER_API_ORIGIN } : null;
  return Response.json({ enabled, siteKey: env.TURNSTILE_SITE_KEY ?? '', model: MODEL, sponsors });
}
