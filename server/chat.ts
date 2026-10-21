import type { Message } from '../shared/history';
import { boundedJson, exactOrigin, HttpError, verifySession, type Bindings } from './security';

// Resolved from Router's canonical catalog at the standalone source baseline.
export const MODEL = 'deepseek-v4-flash';
const SYSTEM = 'You are Rowan, the kind and quietly witty keeper of the Wayfarer, a small inn beside an ancient forest. Welcome the visitor into a fictional, cosy roleplay. Speak as Rowan in short, natural paragraphs, leave room for the visitor to shape the story, and ask at most one question at a time. Be honest that you are an AI character if asked. Never claim real-world actions, professional qualifications or knowledge of the visitor beyond this conversation. Avoid graphic or sexual content. If the visitor is in danger or asks for serious real-world help, step out of the story and respond calmly and practically.';
const encoder = new TextEncoder();
function input(value: unknown): { messages: Message[]; turnstile: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(k => !['messages', 'turnstile'].includes(k)) || !Array.isArray(data.messages) ||
    !data.messages.length || data.messages.length > 14 || typeof data.turnstile !== 'string' || !data.turnstile.length || data.turnstile.length > 2048)
    throw new HttpError(400, 'invalid_request');
  for (const message of data.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).some(k => !['role', 'content'].includes(k)) || !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' || !message.content.trim()) throw new HttpError(400, 'invalid_request');
  }
  if (data.messages.at(-1).role !== 'user' || encoder.encode(JSON.stringify(data.messages)).length > 12_000)
    throw new HttpError(400, 'history_limit');
  return data as { messages: Message[]; turnstile: string };
}
export async function chat(request: Request, env: Bindings, fetcher: typeof fetch = fetch) {
  exactOrigin(request, env);
  if (env.CHAT_ENABLED !== 'true') throw new HttpError(503, 'chat_paused');
  if (!env.DEEPSEEK_API_KEY || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) throw new HttpError(503, 'not_configured');
  await verifySession(request, env);
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new HttpError(403, 'trusted_ip_required');
  const data = input(await boundedJson(request));
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 60_000);
  let handedOff = false;
  try {
    const verification = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: data.turnstile, remoteip: ip }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    });
    if (!verification.ok) throw new HttpError(403, 'verification_failed');
    const verified = await verification.json() as { success?: boolean; hostname?: string; action?: string };
    if (verified.success !== true || verified.hostname !== new URL(env.PUBLIC_ORIGIN!).hostname || verified.action !== 'chat')
      throw new HttpError(403, 'verification_failed');
    const upstream = await fetcher('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM }, ...data.messages],
        max_tokens: 512, thinking: { type: 'disabled' }, stream: true }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body || !upstream.headers.get('Content-Type')?.includes('text/event-stream')) {
      await upstream.body?.cancel(); throw new HttpError(503, 'provider_unavailable');
    }
    const reader = upstream.body.getReader();
    const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let pending = '', total = 0, outputBytes = 0, finished = false, done = false;
        const emit = (event: object) => stream.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        try {
          while (!done) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.byteLength;
            if (total > 1_048_576) throw new Error();
            pending += decoder.decode(next.value, { stream: true });
            let newline: number;
            while ((newline = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
              if (encoder.encode(line).length > 65_536) throw new Error();
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (raw === '[DONE]') { done = true; break; }
              const event = JSON.parse(raw);
              if (event.error || !Array.isArray(event.choices) || event.choices.length > 1) throw new Error();
              const choice = event.choices[0];
              if (choice?.delta?.tool_calls?.length || choice?.delta?.reasoning_content) throw new Error();
              const text = choice?.delta?.content;
              if (text !== undefined && text !== null) {
                if (typeof text !== 'string') throw new Error();
                outputBytes += encoder.encode(text).length;
                if (outputBytes > 65_536) throw new Error();
                if (text) emit({ type: 'text', text });
              }
              if (choice?.finish_reason) {
                if (!['stop', 'length'].includes(choice.finish_reason)) throw new Error();
                finished = true;
              }
            }
            if (encoder.encode(pending).length > 65_536) throw new Error();
          }
          if (!done || !finished || !outputBytes || controller.signal.aborted) throw new Error();
          emit({ type: 'done' }); stream.close();
        } catch {
          try { emit({ type: 'error', error: controller.signal.aborted ? 'stream_interrupted' : 'provider_unavailable' }); stream.close(); } catch { /* Consumer cancelled. */ }
        } finally { abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); cleanup(); }
      },
      cancel() { abort(); cleanup(); return reader.cancel().catch(() => {}); },
    });
    handedOff = true;
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
  } finally {
    if (!handedOff) { abort(); clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  }
}
