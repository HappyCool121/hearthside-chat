import { enabled, failure, publisher } from '../../server/adrouter';
import type { Context } from '../../server/security';
// The paused state is checked first, so a paused publisher never reaches Turnstile or the gateway.
export const onRequestPost = ({ request, env }: Context) =>
  enabled(env) ? publisher(env).chat(request) : failure('app_disabled');
