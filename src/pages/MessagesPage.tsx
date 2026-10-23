import { ArrowLeft, Check, CheckCheck, LoaderCircle, LockKeyhole, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { MessagingNavigation } from "../components/messaging/MessagingNavigation";
import { useMessaging } from "../components/messaging/MessagingProvider";
import { MessagingVault } from "../components/messaging/MessagingVault";
import { Avatar } from "../components/ui/Avatar";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  getMessagingError, loadConversations, loadEmailNotifications, loadMessagePage, loadMessagesSince, loadPeerMessagingKey,
  markConversationRead, prepareMessage, saveEmailNotifications, sendMessage, type Conversation, type ConversationMessage,
  type MessagingSession, type PreparedEncryptedMessage, type PeerMessagingKey,
} from "../lib/messagingRepository";

const formatDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const formatTime = (value: string) => new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const peerOf = (conversation: Conversation, userId: string) => conversation.request.requesterId === userId
  ? conversation.request.recipient : conversation.request.requester;

function EmailPreference() {
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
      .catch(() => { if (active) setError("Impossible de charger la préférence e-mail."); });
    return () => { active = false; };
  }, [reload]);
  const toggle = async () => {
    if (busy || enabled === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveEmailNotifications(!enabled);
      if (mounted.current) setEnabled(!enabled);
    } catch { if (mounted.current) setError("La préférence n’a pas pu être enregistrée. Réessayez."); }
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

function ConversationThread({ conversation, session }: { conversation: Conversation; session: MessagingSession }) {
  const userId = session.userId;
  const { revision, refresh, connected } = useMessaging();
  const [messages, setMessages] = useState<ConversationMessage[]>();
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [focusVersion, setFocusVersion] = useState(0);
  const [peerKey, setPeerKey] = useState<PeerMessagingKey | null>();
  const mounted = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const list = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const nonce = useRef<string | null>(null);
  const prepared = useRef<PreparedEncryptedMessage | null>(null);
  const markedRead = useRef(new Set<string>());
  const peer = peerOf(conversation, userId);
  const peerName = peer ? `${peer.firstName} ${peer.lastName}` : "Membre indisponible";
  const { id: conversationId } = conversation;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; prepared.current = null; nonce.current = null; messagesRef.current = undefined; }; }, []);
  useEffect(() => {
    let active = true;
    void loadPeerMessagingKey(conversationId).then((key) => { if (active && session.identity) setPeerKey(key); })
      .catch((cause: unknown) => { if (active && session.identity) setError(getMessagingError(cause)); });
    return () => { active = false; };
  }, [conversationId, revision, session]);
  useEffect(() => {
    let active = true;
    const existing = messagesRef.current;
    const operation = existing?.length ? loadMessagesSince(session, conversationId, existing[0]!.sequence - 1) : loadMessagePage(session, conversationId);
    void operation.then((result) => {
      if (!active || !session.identity) return;
      setMessages((previous) => {
        const merged = new Map((previous ?? []).map((message) => [message.id, message]));
        for (const message of result) merged.set(message.id, message);
        return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
      });
      if (!existing && result.length === 0) setHasOlder(false);
      setError(undefined);
    }).catch((cause: unknown) => { if (active) setError(getMessagingError(cause)); });
    return () => { active = false; };
  }, [conversationId, revision, session]);

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
    const unreadIncoming = messages.filter((message) => message.decrypted && message.recipientId === userId && !message.readAt && !markedRead.current.has(message.id));
    if (!unreadIncoming.length) return;
    const ids = new Set(unreadIncoming.map((message) => message.id));
    for (const id of ids) markedRead.current.add(id);
    void markConversationRead(session, conversationId, unreadIncoming).then(() => {
      if (!mounted.current || !session.identity) return;
      setMessages((previous) => previous?.map((message) => ids.has(message.id)
        ? { ...message, readAt: new Date().toISOString() } : message));
      refresh();
    }).catch(() => { for (const id of ids) markedRead.current.delete(id); });
  }, [messages, conversationId, userId, atBottom, focusVersion, refresh, session]);

  const older = async () => {
    const first = messages?.[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const previousHeight = list.current?.scrollHeight ?? 0;
    const previousTop = list.current?.scrollTop ?? 0;
    followLatest.current = false;
    try {
      const result = await loadMessagePage(session, conversationId, first.sequence);
      if (!mounted.current || !session.identity) return;
      if (!result.length) setHasOlder(false);
      setMessages((previous) => {
        const merged = new Map([...(result ?? []), ...(previous ?? [])].map((message) => [message.id, message]));
        return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
      });
      requestAnimationFrame(() => {
        if (mounted.current && list.current) {
          list.current.scrollTop = previousTop + list.current.scrollHeight - previousHeight;
          measureBottom();
        }
      });
    } catch (cause) { if (mounted.current) setError(getMessagingError(cause)); }
    finally { if (mounted.current) setLoadingOlder(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || !draft.trim() || !peer || !peerKey || !session.identity) return;
    setSending(true);
    setSendError(undefined);
    // Keep this key after an uncertain response: a retry must not create a second message.
    nonce.current ??= crypto.randomUUID();
    try {
      prepared.current ??= await prepareMessage(session, conversationId, draft, nonce.current);
      if (!mounted.current || !session.identity) return;
      const message = await sendMessage(session, prepared.current);
      if (!mounted.current || !session.identity) return;
      followLatest.current = true;
      setMessages((previous) => [...new Map([...(previous ?? []), message].map((item) => [item.id, item])).values()].sort((a, b) => a.sequence - b.sequence));
      setDraft("");
      nonce.current = null;
      prepared.current = null;
      refresh();
    } catch (cause) { if (mounted.current) setSendError(getMessagingError(cause)); }
    finally { if (mounted.current) setSending(false); }
  };

  return <section className="message-thread" aria-label={`Conversation avec ${peerName}`}>
    <header className="message-thread__header">
      <Link to="/espace/messages" className="message-thread__back" aria-label="Retour aux conversations"><ArrowLeft size={20} aria-hidden="true" /></Link>
      {peer && <Avatar initials={peer.initials} avatarTone={peer.avatarTone} photoUrl={peer.photoUrl} label={`Photo de ${peerName}`} />}
      <div><h2>{peer ? <Link to={`/alumni/${peer.id}`}>{peerName}</Link> : peerName}</h2>
        <p>Chiffré de bout en bout · {conversation.request.kind === "mentoring" ? "Mentorat" : "Échange privé"}</p>
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
                <p>{message.decrypted ? message.body : "Ce message ne peut pas être déchiffré avec votre clé. Son contenu n’est pas affiché."}</p>
                <footer><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>{own && <span aria-label={message.readAt ? "Lu" : "Envoyé"} title={message.readAt ? "Lu" : "Envoyé"}>{message.readAt ? <CheckCheck size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}</span>}</footer>
              </article>
            </div>;
          })}
        </>}
    </div>
    {!atBottom && <button className="message-thread__latest" onClick={() => { followLatest.current = true; if (list.current) list.current.scrollTop = list.current.scrollHeight; setAtBottom(true); }}>Revenir aux derniers messages ↓</button>}
    {peerKey === null && <p className="messages-encryption-note" role="status">{peer?.firstName ?? "Votre destinataire"} doit activer sa messagerie chiffrée avant que vous puissiez échanger ici.</p>}
    <form className="message-composer" onSubmit={(event) => void submit(event)}>
      <label htmlFor="message-draft">Votre message à {peer?.firstName ?? "ce membre"}</label>
      <textarea id="message-draft" name="message" rows={3} maxLength={4000} value={draft} disabled={sending || !peer || !peerKey}
        onChange={(event) => { setDraft(event.target.value); nonce.current = null; prepared.current = null; setSendError(undefined); }}
        placeholder={peer ? "Écrivez votre message…" : "Ce membre n’est plus disponible."} required />
      {sendError && <p role="alert" className="messages-error">{sendError}</p>}
      <div className="message-composer__footer"><small>{draft.length}/4 000 · Chiffré sur cet appareil</small><Button type="submit" size="sm" disabled={sending || !draft.trim() || !peer || !peerKey || messages === undefined}>{sending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />} {sending ? "Envoi…" : sendError ? "Réessayer l’envoi" : "Envoyer"}</Button></div>
    </form>
  </section>;
}

export function MessagesWorkspace({ session, lock }: { session: MessagingSession; lock: () => void }) {
  const userId = session.userId;
  const { conversationId } = useParams();
  const { revision, refresh } = useMessaging();
  const [conversations, setConversations] = useState<Conversation[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void loadConversations(userId).then((result) => { if (active && session.identity) { setConversations(result); setError(undefined); } })
      .catch((cause: unknown) => { if (active) setError(getMessagingError(cause)); });
    return () => { active = false; };
  }, [userId, revision, session]);
  const selected = conversations?.find((conversation) => conversation.id === conversationId);
  return <div className="messages-page page-shell">
    <MessagingNavigation />
    <header className="messages-heading"><div><p className="eyebrow eyebrow--dark">Chiffrement de bout en bout</p><h1>Mes messages</h1><p>Vos conversations sont déchiffrées uniquement dans ce navigateur déverrouillé.</p></div>
      <div className="messages-heading__actions"><Button variant="outline" size="sm" onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Actualiser</Button><Button variant="outline" size="sm" onClick={lock}><LockKeyhole size={16} aria-hidden="true" /> Verrouiller</Button></div>
    </header>
    <p className="messages-encryption-note">Les présentations initiales des demandes restent accessibles dans <Link to="/espace/relations">Mes relations</Link>. Ces textes historiques ne font pas partie de la messagerie chiffrée.</p>
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
      {selected ? <ConversationThread key={`${userId}:${selected.id}`} conversation={selected} session={session} />
        : <section className="messages-placeholder"><MessageCircle size={44} strokeWidth={1.3} aria-hidden="true" /><h2>{conversationId ? conversations ? "Conversation indisponible" : "Ouverture de votre échange…" : "La conversation continue ici."}</h2><p>{conversationId ? "Seules les personnes d’une demande acceptée peuvent accéder à cet échange." : "Choisissez une conversation pour lire les messages et répondre."}</p>{conversationId && <ButtonLink to="/espace/messages" variant="outline">Toutes mes conversations</ButtonLink>}</section>}
    </div>
    <EmailPreference />
  </div>;
}

export function MessagesPage() {
  const { user } = useAuth();
  return user ? <MessagingVault key={user.id} userId={user.id}>{(session, lock) => <MessagesWorkspace key={user.id} session={session} lock={lock} />}</MessagingVault> : null;
}
