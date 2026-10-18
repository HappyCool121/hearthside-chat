import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { trimHistory, type Message } from '../shared/history';
import './style.css';

type Config = { enabled: boolean; siteKey: string; model: string };
type Turnstile = { render(element: HTMLElement, options: Record<string, unknown>): string; reset(id: string): void; remove(id: string): void };
declare global { interface Window { turnstile?: Turnstile } }
const STORAGE = 'hearthside.conversation.v1';
const welcome = 'The fire is still warm, and there’s a chair by the window. I’m Rowan. You look like someone with a story. Shall I put the kettle on?';
function load(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw || raw.length > 200_000) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((m): m is Message => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 65_536).slice(-100);
  } catch { return []; }
}
async function requireOk(response: Response) {
  if (response.ok) return response;
  const code = await response.json().then(v => v.error).catch(() => 'temporarily_unavailable');
  const messages: Record<string, string> = {
    chat_paused: 'The inn is resting for now. Please come back later.',
    session_required: 'Your session expired. Please reload before sending another message.',
    verification_failed: 'The browser check expired. Please complete it again.',
    history_limit: 'Your message is too long. Please shorten it.',
    body_too_large: 'Your message is too long. Please shorten it.',
  };
  throw new Error(messages[code] ?? 'The connection was interrupted. Your message is saved. No request will be retried automatically.');
}
function App() {
  const [messages, setMessages] = useState<Message[]>(load);
  const [draft, setDraft] = useState('');
  const [config, setConfig] = useState<Config>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [storageError, setStorageError] = useState(false);
  const challenge = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const active = useRef<AbortController | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal, cache: 'no-store' }).then(requireOk).then(r => r.json()).then(setConfig)
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to connect.'); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-100))); } catch { setStorageError(true); }
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    if (!config?.enabled || !config.siteKey || !challenge.current) return;
    let disposed = false;
    const render = () => {
      if (disposed || !window.turnstile || !challenge.current || widget.current) return;
      widget.current = window.turnstile.render(challenge.current, { sitekey: config.siteKey, action: 'chat', theme: 'light',
        callback: (value: string) => setToken(value), 'expired-callback': () => setToken(''),
        'error-callback': () => { setToken(''); setError('The browser check could not load. Please reload to try again.'); } });
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = render; script.onerror = () => setError('The browser check could not load. Please reload to try again.');
    if (window.turnstile) render(); else document.head.append(script);
    return () => { disposed = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = undefined; script.remove(); };
  }, [config]);
  function resetChallenge() { setToken(''); if (widget.current) window.turnstile?.reset(widget.current); }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || active.current || !draft.trim() || !token || !config?.enabled) return;
    setError(''); setNotice('');
    const user: Message = { role: 'user', content: draft.trim() };
    // An incomplete answer is shown, but is never included in the next model context.
    const context = [...messages, user];
    let trimmed: ReturnType<typeof trimHistory>;
    try { trimmed = trimHistory(context); } catch (e) { setError((e as Error).message); return; }
    if (trimmed.removed) setNotice('Earlier messages are no longer sent to the model. Your latest message is kept.');
    const snapshot = [...messages, user];
    setMessages(snapshot); setDraft(''); setBusy(true);
    const controller = new AbortController(); active.current = controller;
    try {
      await requireOk(await fetch('/api/session', { method: 'POST', signal: controller.signal }));
      const response = await requireOk(await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: trimmed.messages, turnstile: token }), signal: controller.signal }));
      if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('The response could not be read.');
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let pending = '', answer = '', done = false;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          pending += decoder.decode(next.value, { stream: true });
          if (pending.length > 131_072) throw new Error('The response exceeded its limit.');
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const raw = pending.slice(0, newline); pending = pending.slice(newline + 1);
            if (!raw) continue;
            const event = JSON.parse(raw);
            if (done) throw new Error('The response could not be read.');
            if (event.type === 'text' && typeof event.text === 'string') {
              answer += event.text;
              if (answer.length > 65_536) throw new Error('The response exceeded its limit.');
              setMessages([...snapshot, { role: 'assistant', content: answer }]);
            } else if (event.type === 'done') done = true;
            else throw new Error('The reply was interrupted. No request was retried.');
          }
        }
        if (!done || pending.trim() || !answer) throw new Error('The reply was interrupted. No request was retried.');
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (e) {
      // Remove partial assistant output from stored/provider history rather than treating it as completed.
      setMessages(snapshot);
      setError(controller.signal.aborted ? 'Reply stopped. No request was retried.' : e instanceof Error ? e.message : 'The reply was interrupted.');
    } finally { active.current = undefined; setBusy(false); resetChallenge(); }
  }
  return <div className="shell">
    <aside className="room">
      <a className="wordmark" href="/" aria-label="Hearthside home"><span aria-hidden="true">✳</span> hearthside</a>
      <div className="room-art" aria-hidden="true"><div className="arch"><div className="moon"/><div className="hills"/></div><div className="hearth"><div className="flame"/></div></div>
      <p className="eyebrow">THE WAYFARER · EST. IN IMAGINATION</p>
      <h1>A little room<br/>for a story.</h1>
      <p className="room-copy">Leave the busy world outside.<br/>Pull up a chair. Stay a while.</p>
      <div className="character"><span className="avatar" aria-hidden="true">R</span><div><strong>Rowan</strong><small>Your innkeeper & fellow wanderer</small></div></div>
      <div className="room-bottom"><span className="dot"/> A fictional place. A real moment of quiet.</div>
    </aside>
    <main>
      <header className="chat-header"><div><span className="eyebrow">BY THE FIRE</span><h2>A conversation with Rowan</h2></div><button className="quiet" disabled={busy} onClick={() => { if (messages.length && !window.confirm('Clear the conversation stored in this browser?')) return; setMessages([]); setNotice(''); setError(''); }}>New story <span aria-hidden="true">↗</span></button></header>
      <section className="conversation" aria-label="Conversation">
        <div className="chapter"><span/> THE DOOR IS OPEN <span/></div>
        <article className="message assistant"><span className="speaker">ROWAN</span><p>{welcome}</p></article>
        {!messages.length && <div className="starters">{['Tell me about this place.', 'I’ve come a long way.', 'Is there a story behind that forest?'].map(text => <button key={text} onClick={() => setDraft(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div>}
        {messages.map((message, i) => <article key={i} className={`message ${message.role}`}><span className="speaker">{message.role === 'user' ? 'YOU' : 'ROWAN'}</span><p>{message.content}</p></article>)}
        {busy && <p role="status" className="thinking">Rowan is gathering a thought…</p>}
        <div ref={end}/>
      </section>
      <aside className="placement-space" aria-label="Reserved placement"><span aria-hidden="true">✧</span><p>A little space beside the story.</p></aside>
      <footer className="composer">
        {!config && !error && <p role="status">Opening the door…</p>}
        {config && !config.enabled && <p role="status" className="notice">The inn is resting. Chat is paused while its keeper gets things ready.</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {storageError && <p className="notice">Browser storage is unavailable. This conversation will disappear when you leave.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <form onSubmit={send}><label className="sr-only" htmlFor="message">Your message to Rowan</label><textarea id="message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={12_000} rows={2} placeholder="Say something to Rowan…" disabled={busy} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>{busy ? <button className="send" type="button" onClick={() => active.current?.abort()} aria-label="Stop reply">■</button> : <button className="send" type="submit" disabled={!config?.enabled || !token || !draft.trim()} aria-label="Send message">↑</button>}</form>
        <div className="composer-meta"><p>Rowan is an AI character. History stays in this browser.</p><span>Enter to send · Shift + Enter for a new line</span></div>
        <div className="challenge" ref={challenge}/>
      </footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
