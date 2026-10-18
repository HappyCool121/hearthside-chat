import { COOKIE, exactOrigin, issueSession, verifySession, type Context } from '../../server/security';
export async function onRequestPost({ request, env }: Context) {
  exactOrigin(request, env);
  if ((request.headers.get('Cookie') ?? '').split(';').some(c => c.trim().startsWith(COOKIE + '='))) {
    await verifySession(request, env);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': await issueSession(env) } });
}
