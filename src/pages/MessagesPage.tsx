import { ArrowLeft, Check, CheckCheck, LoaderCircle, LogIn, MessageCircle, MonitorSmartphone, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { MessagingNavigation } from "../components/messaging/MessagingNavigation";
import { useMessaging, type MessagingAccess } from "../components/messaging/MessagingProvider";
import { Avatar } from "../components/ui/Avatar";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  getMessagingError, loadConversations, loadDevices, loadEmailNotifications, loadMessagePage, loadMessagesSince,
  markConversationRead, revokeDevice, saveEmailNotifications, sendMessage,
  type Conversation, type ConversationMessage, type MessagingDeviceSummary,
} from "../lib/messagingRepository";
import { supabase } from "../lib/supabase";

const formatDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const peerOf = (conversation: Conversation, userId: string) => conversation.request.requesterId === userId
  ? conversation.request.recipient : conversation.request.requester;

// Checked in order: Edge and Opera also announce Chrome, Chrome announces Safari, iPhones announce Mac OS X.
const BROWSERS = [["Edg/", "Edge"], ["OPR/", "Opera"], ["Firefox/", "Firefox"], ["FxiOS/", "Firefox"], ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"], ["Safari/", "Safari"]] as const;
const SYSTEMS = [["iPhone", "iPhone"], ["iPad", "iPad"], ["Android", "Android"], ["Windows", "Windows"], ["Mac OS X", "Mac"],
  ["Linux", "Linux"]] as const;

function describeDevice(userAgent: string) {
  const browser = BROWSERS.find(([token]) => userAgent.includes(token))?.[1] ?? "Navigateur";
  const system = SYSTEMS.find(([token]) => userAgent.includes(token))?.[1];
  return system ? `${browser} sur ${system}` : browser;
}

function EmailPreference() {
  const { reportError } = useMessaging();
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setError(undefined);
    void loadEmailNotifications().then((value) => { if (active) setEnabled(value); })
      .catch((cause: unknown) => { reportError(cause); if (active) setError("Impossible de charger la préférence e-mail."); });
    return () => { active = false; };
  }, [reload, reportError]);
  const toggle = async () => {
    if (busy || enabled === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveEmailNotifications(!enabled);
      if (mounted.current) setEnabled(!enabled);
    } catch (cause) { reportError(cause); if (mounted.current) setError("La préférence n’a pas pu être enregistrée. Réessayez."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="messages-email">
    <label><input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || busy} onChange={() => void toggle()} />
      <span>Me prévenir par e-mail lorsque je suis absent</span>{busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
    </label>
    <p>Un rappel pour les messages non lus, sans leur contenu. Les rappels sont regroupés et peuvent arriver avec un délai.</p>
    {error && <p role="alert">{error} {enabled === undefined && <button className="text-link text-link--dark" onClick={() => setReload((value) => value + 1)}>Réessayer</button>}</p>}
  </div>;
}

function MessagingDevices() {
  const { reportError } = useMessaging();
  const [devices, setDevices] = useState<MessagingDeviceSummary[]>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void loadDevices().then((result) => { if (active) { setDevices(result); setError(undefined); } })
      .catch((cause: unknown) => { reportError(cause); if (active) setError("Impossible d’afficher vos appareils."); });
    return () => { active = false; };
  }, [reload, reportError]);
  const remove = async (sessionId: string) => {
    setBusy(sessionId);
    try { await revokeDevice(sessionId); setReload((value) => value + 1); }
    catch (cause) { reportError(cause); setError(getMessagingError(cause)); }
    finally { setBusy(undefined); }
  };
  const signOutOthers = async () => {
    setBusy("others");
    // Ends the other sign-ins of this account; their messaging stops with them.
    const { error: signOutError } = await supabase?.auth.signOut({ scope: "others" }) ?? { error: null };
    if (signOutError) setError("Les autres appareils n’ont pas pu être déconnectés. Réessayez.");
    setBusy(undefined);
    setReload((value) => value + 1);
  };
  const others = devices?.filter((device) => !device.isCurrent) ?? [];
  return <section className="messages-devices" aria-labelledby="messages-devices-title">
    <h2 id="messages-devices-title"><MonitorSmartphone size={18} aria-hidden="true" /> Appareils connectés</h2>
    <p>Vos messages s’ouvrent sur les appareils où vous vous êtes connecté. Retirez ceux que vous n’utilisez plus.</p>
    {devices === undefined && !error && <p role="status">Chargement…</p>}
    {devices && <ul>{devices.map((device) => <li key={device.sessionId}>
      <span><strong>{describeDevice(device.userAgent)}{device.isCurrent && " · cet appareil"}</strong>
        <small>Connecté le {formatDate(device.createdAt)} · dernière activité le {formatDate(device.lastUsedAt)}</small></span>
      {!device.isCurrent && <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void remove(device.sessionId)}>
        {busy === device.sessionId ? "Retrait…" : "Retirer"}</Button>}
    </li>)}</ul>}
    {others.length > 0 && <button className="text-link text-link--dark" disabled={Boolean(busy)} onClick={() => void signOutOthers()}>
      Déconnecter tous mes autres appareils</button>}
    {error && <p role="alert" className="messages-error">{error} <button className="text-link text-link--dark" onClick={() => setReload((value) => value + 1)}>Réessayer</button></p>}
  </section>;
}

function ConversationThread({ conversation, userId }: { conversation: Conversation; userId: string }) {
  const { revision, refresh, connected, reportError } = useMessaging();
  const [messages, setMessages] = useState<ConversationMessage[]>();
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [focusVersion, setFocusVersion] = useState(0);
  const mounted = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const list = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const nonce = useRef<string | null>(null);
  const markedRead = useRef(new Set<string>());
  const peer = peerOf(conversation, userId);
  const peerName = peer ? `${peer.firstName} ${peer.lastName}` : "Membre indisponible";
  const { id: conversationId } = conversation;

  const fail = useCallback((cause: unknown, show: (message: string) => void) => {
    reportError(cause);
    if (mounted.current) show(getMessagingError(cause));
  }, [reportError]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; nonce.current = null; messagesRef.current = undefined; }; }, []);
  useEffect(() => {
    let active = true;
    const existing = messagesRef.current;
    const operation = existing?.length ? loadMessagesSince(conversationId, existing[0]!.sequence - 1) : loadMessagePage(conversationId);
    void operation.then((result) => {
      if (!active) return;
      setMessages((previous) => {
        const merged = new Map((previous ?? []).map((message) => [message.id, message]));
        for (const message of result) merged.set(message.id, message);
        return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
      });
      if (!existing && result.length === 0) setHasOlder(false);
      setError(undefined);
    }).catch((cause: unknown) => { if (active) fail(cause, setError); });
    return () => { active = false; };
  }, [conversationId, revision, fail]);

  const measureBottom = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
    followLatest.current = bottom;
    setAtBottom(bottom);
  }, []);

  useLayoutEffect(() => {
    if (followLatest.current && list.current) {
      list.current.scrollTop = list.current.scrollHeight;
      setAtBottom(true);
    }
  }, [messages]);

  useEffect(() => {
    const foreground = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) setFocusVersion((value) => value + 1);
    };
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => { window.removeEventListener("focus", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, []);

  useEffect(() => {
    const element = list.current;
    if (!messages?.length || !element || !atBottom || document.visibilityState !== "visible" || !document.hasFocus()
      || element.scrollHeight - element.scrollTop - element.clientHeight >= 60) return;
    const unreadIncoming = messages.filter((message) => message.recipientId === userId && !message.readAt && !markedRead.current.has(message.id));
    if (!unreadIncoming.length) return;
    const ids = new Set(unreadIncoming.map((message) => message.id));
    for (const id of ids) markedRead.current.add(id);
    void markConversationRead(userId, conversationId, unreadIncoming).then(() => {
      if (!mounted.current) return;
      setMessages((previous) => previous?.map((message) => ids.has(message.id)
        ? { ...message, readAt: new Date().toISOString() } : message));
      refresh();
    }).catch((cause: unknown) => { reportError(cause); for (const id of ids) markedRead.current.delete(id); });
  }, [messages, conversationId, userId, atBottom, focusVersion, refresh, reportError]);

  const older = async () => {
    const first = messages?.[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const previousHeight = list.current?.scrollHeight ?? 0;
    const previousTop = list.current?.scrollTop ?? 0;
    followLatest.current = false;
    try {
      const result = await loadMessagePage(conversationId, first.sequence);
      if (!mounted.current) return;
      if (!result.length) setHasOlder(false);
      setMessages((previous) => {
        const merged = new Map([...result, ...(previous ?? [])].map((message) => [message.id, message]));
        return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
      });
      requestAnimationFrame(() => {
        if (mounted.current && list.current) {
          list.current.scrollTop = previousTop + list.current.scrollHeight - previousHeight;
          measureBottom();
        }
      });
    } catch (cause) { fail(cause, setError); }
    finally { if (mounted.current) setLoadingOlder(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || !draft.trim() || !peer) return;
    setSending(true);
    setSendError(undefined);
    // Keep this key after an uncertain response: a retry must not create a second message.
    nonce.current ??= crypto.randomUUID();
    try {
      const message = await sendMessage(conversationId, draft, nonce.current);
      if (!mounted.current) return;
      followLatest.current = true;
      setMessages((previous) => [...new Map([...(previous ?? []), message].map((item) => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence));
      setDraft("");
      nonce.current = null;
      refresh();
    } catch (cause) { fail(cause, setSendError); }
    finally { if (mounted.current) setSending(false); }
  };

  return <section className="message-thread" aria-label={`Conversation avec ${peerName}`}>
    <header className="message-thread__header">
      <Link to="/espace/messages" className="message-thread__back" aria-label="Retour aux conversations"><ArrowLeft size={20} aria-hidden="true" /></Link>
      {peer && <Avatar initials={peer.initials} avatarTone={peer.avatarTone} photoUrl={peer.photoUrl} label={`Photo de ${peerName}`} />}
      <div><h2>{peer ? <Link to={`/alumni/${peer.id}`}>{peerName}</Link> : peerName}</h2>
        <p>{conversation.request.kind === "mentoring" ? "Mentorat" : "Échange privé"}</p>
      </div>
      <span className="message-thread__connection" title={connected ? "Réception en temps réel" : "Actualisation régulière en cours"}>{connected ? "En direct" : "Synchronisation"}</span>
    </header>
    {error && <div className="messages-error" role="alert">{error} <Button size="sm" variant="outline" onClick={refresh}>Réessayer</Button></div>}
    <div className="message-thread__history" ref={list} onScroll={measureBottom} role="log" aria-label="Historique des messages" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {messages === undefined ? <p className="messages-empty" role="status"><LoaderCircle className="spin" size={20} aria-hidden="true" /> Chargement des messages…</p>
        : <>
          {hasOlder && messages.length > 0 && <div className="message-thread__older"><Button variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void older()}>{loadingOlder ? "Chargement…" : "Voir les messages précédents"}</Button></div>}
          {messages.length === 0 && <p className="messages-empty">Votre conversation est ouverte. Écrivez le premier message.</p>}
          {messages.map((message, index) => {
            const own = message.senderId === userId;
            const previous = messages[index - 1];
            const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
            return <div key={message.id}>
              {newDay && <p className="message-day">{new Date(message.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>}
              <article className={`message-bubble${own ? " message-bubble--own" : ""}`} aria-label={`Message de ${own ? "vous" : peerName}`}>
                <p>{message.body}</p>
                <footer><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>{own && <span aria-label={message.readAt ? "Lu" : "Envoyé"} title={message.readAt ? "Lu" : "Envoyé"}>{message.readAt ? <CheckCheck size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}</span>}</footer>
              </article>
            </div>;
          })}
        </>}
    </div>
    {!atBottom && <button className="message-thread__latest" onClick={() => { followLatest.current = true; if (list.current) list.current.scrollTop = list.current.scrollHeight; setAtBottom(true); }}>Revenir aux derniers messages ↓</button>}
    <form className="message-composer" onSubmit={(event) => void submit(event)}>
      <label htmlFor="message-draft">Votre message à {peer?.firstName ?? "ce membre"}</label>
      <textarea id="message-draft" name="message" rows={3} maxLength={4000} value={draft} disabled={sending || !peer}
        onChange={(event) => { setDraft(event.target.value); nonce.current = null; setSendError(undefined); }}
        placeholder={peer ? "Écrivez votre message…" : "Ce membre n’est plus disponible."} required />
      {sendError && <p role="alert" className="messages-error">{sendError}</p>}
      <div className="message-composer__footer"><small>{draft.length}/4 000</small><Button type="submit" size="sm" disabled={sending || !draft.trim() || !peer || messages === undefined}>{sending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />} {sending ? "Envoi…" : sendError ? "Réessayer l’envoi" : "Envoyer"}</Button></div>
    </form>
  </section>;
}

function MessagesWorkspace({ userId }: { userId: string }) {
  const { conversationId } = useParams();
  const { revision, refresh, reportError } = useMessaging();
  const [conversations, setConversations] = useState<Conversation[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void loadConversations(userId).then((result) => { if (active) { setConversations(result); setError(undefined); } })
      .catch((cause: unknown) => { reportError(cause); if (active) setError(getMessagingError(cause)); });
    return () => { active = false; };
  }, [userId, revision, reportError]);
  const selected = conversations?.find((conversation) => conversation.id === conversationId);
  return <div className="messages-page page-shell">
    <MessagingNavigation />
    <header className="messages-heading"><div><p className="eyebrow eyebrow--dark">Messagerie privée</p><h1>Mes messages</h1><p>Échangez avec les membres qui ont accepté votre demande.</p></div>
      <div className="messages-heading__actions"><Button variant="outline" size="sm" onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Actualiser</Button></div>
    </header>
    <p className="messages-encryption-note">Les présentations initiales des demandes restent accessibles dans <Link to="/espace/relations">Mes relations</Link>.</p>
    {error && <p className="messages-error" role="alert">{error} <button onClick={refresh} className="text-link text-link--dark">Réessayer</button></p>}
    <div className={`messages-workspace${conversationId ? " messages-workspace--selected" : ""}`}>
      <aside className="messages-inbox" aria-label="Vos conversations">
        <div className="messages-inbox__heading"><h2>Conversations</h2>{conversations && <span>{conversations.length}</span>}</div>
        {conversations === undefined ? <p className="messages-empty" role="status">Chargement des conversations…</p>
          : !conversations.length ? <div className="messages-empty"><MessageCircle size={32} aria-hidden="true" /><p>Aucun échange ouvert pour le moment.</p><ButtonLink to="/espace/relations" variant="outline" size="sm">Voir mes demandes</ButtonLink></div>
            : <ul className="messages-inbox__list">{conversations.map((conversation) => {
              const peer = peerOf(conversation, userId);
              const name = peer ? `${peer.firstName} ${peer.lastName}` : "Membre indisponible";
              return <li key={conversation.id}><Link to={`/espace/messages/${conversation.id}`} aria-current={conversation.id === conversationId ? "page" : undefined} className={conversation.unreadCount ? "is-unread" : ""}>
                {peer ? <Avatar initials={peer.initials} avatarTone={peer.avatarTone} photoUrl={peer.photoUrl} label={`Photo de ${name}`} /> : <span className="message-avatar-unavailable"><MessageCircle size={22} aria-hidden="true" /></span>}
                <span className="messages-inbox__text"><span className="messages-inbox__name">{name}<time dateTime={conversation.updatedAt}>{formatDate(conversation.updatedAt)}</time></span><span className="messages-inbox__preview">{conversation.lastMessage}</span><span className="messages-inbox__kind">{conversation.request.offerId ? "Question sur une offre" : conversation.request.kind === "mentoring" ? "Mentorat" : "Échange"}</span></span>
                {conversation.unreadCount > 0 && <span className="message-unread-count" aria-label={`${conversation.unreadCount} messages non lus`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>}
              </Link></li>;
            })}</ul>}
      </aside>
      {selected ? <ConversationThread key={`${userId}:${selected.id}`} conversation={selected} userId={userId} />
        : <section className="messages-placeholder"><MessageCircle size={44} strokeWidth={1.3} aria-hidden="true" /><h2>{conversationId ? conversations ? "Conversation indisponible" : "Ouverture de votre échange…" : "La conversation continue ici."}</h2><p>{conversationId ? "Seules les personnes d’une demande acceptée peuvent accéder à cet échange." : "Choisissez une conversation pour lire les messages et répondre."}</p>{conversationId && <ButtonLink to="/espace/messages" variant="outline">Toutes mes conversations</ButtonLink>}</section>}
    </div>
    <div className="messages-settings">
      <EmailPreference />
      <MessagingDevices />
    </div>
  </div>;
}

function MessagingAccessNotice({ access }: { access: Exclude<MessagingAccess, "ready"> }) {
  const { retryAccess } = useMessaging();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const reconnect = async () => {
    setBusy(true);
    // "local" ends only this browser's sign-in; the member's other devices stay connected.
    await supabase?.auth.signOut({ scope: "local" });
    navigate(`/connexion?next=${encodeURIComponent(location.pathname)}`);
  };
  return <div className="messages-page page-shell"><MessagingNavigation />
    <section className="messages-access" aria-labelledby="messages-access-title">
      <MessageCircle size={34} strokeWidth={1.4} aria-hidden="true" />
      {access === "checking" ? <>
        <h1 id="messages-access-title">Ouverture de votre messagerie…</h1>
        <p role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /> Un instant.</p>
      </> : access === "reconnect" ? <>
        <h1 id="messages-access-title">Reconnectez-vous pour lire vos messages ici.</h1>
        <p>Pour protéger vos échanges, la messagerie s’ouvre sur les appareils où vous vous êtes connecté récemment. Une nouvelle connexion suffit : il n’y a rien d’autre à faire.</p>
        <Button disabled={busy} onClick={() => void reconnect()}><LogIn size={18} aria-hidden="true" /> Me reconnecter</Button>
      </> : <>
        <h1 id="messages-access-title">La messagerie ne répond pas pour le moment.</h1>
        <p>Vérifiez votre connexion internet, puis réessayez.</p>
        <Button variant="outline" onClick={retryAccess}><RefreshCw size={18} aria-hidden="true" /> Réessayer</Button>
      </>}
    </section>
  </div>;
}

export function MessagesPage() {
  const { user } = useAuth();
  const { access } = useMessaging();
  if (!user) return null;
  return access === "ready" ? <MessagesWorkspace key={user.id} userId={user.id} /> : <MessagingAccessNotice access={access} />;
}
