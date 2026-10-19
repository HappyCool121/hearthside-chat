import { publisher } from '../../../../server/adrouter';
import type { Context } from '../../../../server/security';
export const onRequestGet = ({ request, env, params }: Context & { params: { id: string } }) =>
  publisher(env).status(request, params.id);
