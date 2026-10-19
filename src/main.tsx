import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createAdRouterClient, type AdRouterClient, type PublicMessage, type SDKError, type SponsorOffer } from '@adrouter/browser-sdk';
import { SponsoredCard } from '@adrouter/browser-sdk/react';
import './style.css';

type Config = { enabled: boolean; siteKey: string; model: string };
type Turnstile = { render(element: HTMLElement, options: Record<string, unknown>): string; reset(id: string): void; remove(id: string): void };
declare global { interface Window { turnstile?: Turnstile } }
type Reply = { text: string; interrupted: boolean };
const STORAGE = 'hearthside.conversation.v1';
const SPONSORSHIP = 'hearthside.sponsorship.v1';
const welcome = 'The fire is still warm, and there’s a chair by the window. I’m Rowan. You look like someone with a story. Shall I put the kettle on?';
const TRIMMED = 'Earlier messages are no longer sent to the model. Your latest message is kept.';
const STOPPED = 'Reply stopped. No request was retried.';
const INTERRUPTED = 'The connection was interrupted. Your message is saved. No request will be retried automatically.';
const errors: Partial<Record<SDKError['code'], string>> = {
  app_disabled: 'The inn is resting for now. Please come back later.',
  session_invalid: 'Your session expired. Please reload before sending another message.',
  turnstile_failed: 'The browser check expired. Please complete it again.',
  input_limit: 'Your message is too long. Please shorten it.',
  request_too_large: 'Your message is too long. Please shorten it.',
  global_busy: 'Rowan is with another guest. Please try again in a moment.',
  session_daily_limit: 'Rowan has talked a lot today. Please come back tomorrow.',
  ip_daily_limit: 'Rowan has talked a lot today. Please come back tomorrow.',
  global_daily_limit: 'Rowan has talked a lot today. Please come back tomorrow.',
  turn_cancelled: STOPPED,
};
const endpoints = {
  chat: '/api/chat',
  status: (id: string) => `/api/turns/${encodeURIComponent(id)}`,
  cancel: (id: string) => `/api/turns/${encodeURIComponent(id)}/cancel`,
  feedback: '/api/feedback',
  clientEvents: '/api/client-events',
  measurement: 'https://adrouter-v3.fly.dev/v3/sponsor/events',
};
function load(): PublicMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw || raw.length > 200_000) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((m): m is PublicMessage => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 65_536).slice(-100);
  } catch { return []; }
}
function loadSponsorship() {
  try { return localStorage.getItem(SPONSORSHIP) !== 'off'; } catch { return true; }
}
function App() {
  const [messages, setMessages] = useState<PublicMessage[]>(load);
  const [draft, setDraft] = useState('');
  const [config, setConfig] = useState<Config>();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [offer, setOffer] = useState<SponsorOffer | null>(null);
  const [sponsorship, setSponsorship] = useState(loadSponsorship);
  const [client, setClient] = useState<AdRouterClient>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [storageError, setStorageError] = useState(false);
  const challenge = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const tokenRef = useRef('');
  const answer = useRef('');
  const active = useRef<{ cancel(): Promise<void> } | undefined>(undefined);
  const stopped = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setConfig)
      .catch(() => { if (!controller.signal.aborted) setError('Unable to connect. Please reload to try again.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const make = () => createAdRouterClient({
      endpoints,
      history: { maxMessages: 14, maxBytes: 12_000 },
      onHistoryTrimmed: () => setNotice(TRIMMED),
      getTurnstileToken: async () => {
        const value = tokenRef.current; tokenRef.current = ''; setToken('');
        if (!value) throw { code: 'turnstile_failed', message: 'The browser check expired.' } satisfies SDKError;
        return value;
      },
      onModelDelta: text => { answer.current += text; setReply({ text: answer.current, interrupted: false }); },
      onSponsorOffer: next => setOffer(next),
      onSponsorNone: () => setOffer(null),
    });
    let current = make(); setClient(current);
    // The SDK disposes its client on pagehide. A page restored from the back-forward cache needs a new one.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { current = make(); setClient(current); setOffer(null); } };
    addEventListener('pageshow', restore);
    return () => { removeEventListener('pageshow', restore); current.dispose(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-100))); } catch { setStorageError(true); }
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, reply]);
  useEffect(() => {
    try { localStorage.setItem(SPONSORSHIP, sponsorship ? 'on' : 'off'); } catch { /* The choice applies to this visit only. */ }
  }, [sponsorship]);
  useEffect(() => {
    if (!config?.enabled || !config.siteKey || !challenge.current) return;
    let disposed = false;
    const render = () => {
      if (disposed || !window.turnstile || !challenge.current || widget.current) return;
      widget.current = window.turnstile.render(challenge.current, { sitekey: config.siteKey, action: 'chat', theme: 'light',
        callback: (value: string) => { tokenRef.current = value; setToken(value); },
        'expired-callback': () => { tokenRef.current = ''; setToken(''); },
        'error-callback': () => { tokenRef.current = ''; setToken(''); setError('The browser check could not load. Please reload to try again.'); } });
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = render; script.onerror = () => setError('The browser check could not load. Please reload to try again.');
    if (window.turnstile) render(); else document.head.append(script);
    return () => { disposed = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = undefined; script.remove(); };
  }, [config]);
  function resetChallenge() { tokenRef.current = ''; setToken(''); if (widget.current) window.turnstile?.reset(widget.current); }
  async function stop() {
    stopped.current = true;
    await active.current?.cancel().catch(() => {});
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || active.current || !client || !draft.trim() || !token || !config?.enabled) return;
    setError(''); setNotice(''); setReply(null); setOffer(null);
    const snapshot = [...messages, { role: 'user' as const, content: draft.trim() }];
    setMessages(snapshot); setDraft(''); setBusy(true);
    answer.current = ''; stopped.current = false;
    try {
      const session = await fetch('/api/session', { method: 'POST', cache: 'no-store' });
      if (!session.ok) throw { code: 'session_invalid', message: 'Publisher session could not be created.' } satisfies SDKError;
      const turn = client.sendTurn({ messages: snapshot, sponsorshipEnabled: sponsorship });
      active.current = turn;
      const result = await turn.done;
      // Only a complete, successful answer joins the conversation that is stored and sent to the model.
      if (result.kind === 'new' && result.delivery === 'complete' && result.status.model_outcome === 'success' && answer.current) {
        setMessages([...snapshot, { role: 'assistant', content: answer.current }]); setReply(null);
      } else {
        setReply(answer.current ? { text: answer.current, interrupted: true } : null);
        setError(stopped.current ? STOPPED : INTERRUPTED);
      }
    } catch (e) {
      const code = (e as Partial<SDKError> | undefined)?.code;
      setReply(answer.current ? { text: answer.current, interrupted: true } : null);
      setError(stopped.current ? STOPPED : (code && errors[code]) || INTERRUPTED);
    } finally { active.current = undefined; setBusy(false); resetChallenge(); }
  }
  function newStory() {
    if (messages.length && !window.confirm('Clear the conversation stored in this browser?')) return;
    setMessages([]); setReply(null); setOffer(null); setNotice(''); setError('');
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
      <header className="chat-header"><div><span className="eyebrow">BY THE FIRE</span><h2>A conversation with Rowan</h2></div><button className="quiet" disabled={busy} onClick={newStory}>New story <span aria-hidden="true">↗</span></button></header>
      <section className="conversation" aria-label="Conversation">
        <div className="chapter"><span/> THE DOOR IS OPEN <span/></div>
        <article className="message assistant"><span className="speaker">ROWAN</span><p>{welcome}</p></article>
        {!messages.length && <div className="starters">{['Tell me about this place.', 'I’ve come a long way.', 'Is there a story behind that forest?'].map(text => <button key={text} onClick={() => setDraft(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div>}
        {messages.map((message, i) => <article key={i} className={`message ${message.role}`}><span className="speaker">{message.role === 'user' ? 'YOU' : 'ROWAN'}</span><p>{message.content}</p></article>)}
        {reply && <article className={`message assistant${reply.interrupted ? ' interrupted' : ''}`}><span className="speaker">{reply.interrupted ? 'ROWAN · INTERRUPTED, NOT KEPT' : 'ROWAN'}</span><p>{reply.text}</p></article>}
        {busy && !reply && <p role="status" className="thinking">Rowan is gathering a thought…</p>}
        <div ref={end}/>
      </section>
      <section className={`placement-space${offer ? ' filled' : ''}`} aria-label="Reserved placement">
        {offer && client ? <SponsoredCard client={client} offer={offer}/> : <><span aria-hidden="true">✧</span><p>A little space beside the story.</p></>}
      </section>
      <footer className="composer">
        {!config && !error && <p role="status">Opening the door…</p>}
        {config && !config.enabled && <p role="status" className="notice">The inn is resting. Chat is paused while its keeper gets things ready.</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {storageError && <p className="notice">Browser storage is unavailable. This conversation will disappear when you leave.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <form onSubmit={send}><label className="sr-only" htmlFor="message">Your message to Rowan</label><textarea id="message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={12_000} rows={2} placeholder="Say something to Rowan…" disabled={busy} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>{busy ? <button className="send" type="button" onClick={() => void stop()} aria-label="Stop reply">■</button> : <button className="send" type="submit" disabled={!config?.enabled || !client || !token || !draft.trim()} aria-label="Send message">↑</button>}</form>
        <div className="composer-meta"><p>Rowan is an AI character. History stays in this browser.</p><label className="sponsorship"><input type="checkbox" checked={sponsorship} disabled={busy} onChange={e => setSponsorship(e.target.checked)}/> Show sponsored suggestions</label><span>Enter to send · Shift + Enter for a new line</span></div>
        <div className="challenge" ref={challenge}/>
      </footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
