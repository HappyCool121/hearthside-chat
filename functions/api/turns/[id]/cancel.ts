import { publisher } from '../../../../server/adrouter';
import type { Context } from '../../../../server/security';
export const onRequestPost = ({ request, env, params }: Context & { params: { id: string } }) =>
  publisher(env).cancel(request, params.id);
