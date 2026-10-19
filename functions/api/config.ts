import { enabled } from '../../server/adrouter';
import type { Context } from '../../server/security';
export function onRequestGet({ env }: Context) {
  return Response.json({ enabled: enabled(env), siteKey: env.TURNSTILE_SITE_KEY ?? '', model: env.ADROUTER_MODEL ?? '' });
}
