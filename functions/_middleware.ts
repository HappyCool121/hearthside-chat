import { errorResponse, protect, type Context } from '../server/security';
export async function onRequest(context: Context) {
  try { return protect(await context.next()); } catch { return errorResponse(); }
}
