import { publisher } from '../../server/adrouter';
import type { Context } from '../../server/security';
export const onRequestPost = ({ request, env }: Context) => publisher(env).session(request);
