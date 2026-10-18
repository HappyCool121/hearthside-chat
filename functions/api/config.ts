import { MODEL } from '../../server/chat';
import type { Context } from '../../server/security';
export function onRequestGet({ env }: Context) {
  const enabled = env.STANDALONE_ENABLED === 'true' && Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.SESSION_SECRET && env.DEEPSEEK_API_KEY);
  return Response.json({ enabled, siteKey: env.TURNSTILE_SITE_KEY ?? '', model: MODEL });
}
