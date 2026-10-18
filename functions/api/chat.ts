import { chat } from '../../server/chat';
import type { Context } from '../../server/security';
export const onRequestPost = ({ request, env }: Context) => chat(request, env);
