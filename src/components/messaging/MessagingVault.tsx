import { Copy, Download, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { generateMessagingIdentity, unlockMessagingIdentity, type MessagingIdentity } from "../../lib/messagingCrypto";
import { enrollIdentity, loadIdentity, requestIdentityChallenge } from "../../lib/messagingIdentityRepository";
import type { IdentityChallenge } from "../../lib/messagingIdentityData";
import type { MessagingSession } from "../../lib/messagingRepository";
import { MessagingNavigation } from "./MessagingNavigation";
import { Button } from "../ui/Button";

type GeneratedIdentity = Awaited<ReturnType<typeof generateMessagingIdentity>>;

function VaultAccess({ userId, onUnlocked }: { userId: string; onUnlocked: (session: MessagingSession) => void }) {
  const [identity, setIdentity] = useState<MessagingIdentity | null>();
  const [challenge, setChallenge] = useState<IdentityChallenge>();
  const [generated, setGenerated] = useState<GeneratedIdentity>();
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++operation.current; };
  }, []);
  useEffect(() => {
    let active = true;
    void loadIdentity().then((value) => {
      if (!active) return;
      if (value && value.user_id !== userId) throw new Error("Votre session a changé. Rechargez la page.");
      setIdentity(value);
      setError(undefined);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Impossible de vérifier votre messagerie."); });
    return () => { active = false; };
  }, [userId, reload]);

  const start = async () => {
    if (busy) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    const current = ++operation.current;
    try {
      const nextChallenge = await requestIdentityChallenge(userId);
      if (!mounted.current || current !== operation.current) return;
      setChallenge(nextChallenge);
      // A token alone cannot enroll an identity: a separate e-mail proof is required.
      const created = generated ?? await generateMessagingIdentity(userId);
      if (!mounted.current || current !== operation.current) return;
      setGenerated(created);
      setNotice("Un code de 8 chiffres a été envoyé à l’adresse e-mail de votre compte. Il expire après 10 minutes.");
    } catch (cause) { if (mounted.current && current === operation.current) setError(cause instanceof Error ? cause.message : "La vérification n’a pas pu démarrer."); }
    finally { if (mounted.current && current === operation.current) setBusy(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || identity === undefined) return;
    setBusy(true); setError(undefined);
    const current = ++operation.current;
    try {
      let target = identity;
      if (!target) {
        if (!generated || !challenge || !saved || secret.trim() !== generated.recoverySecret) throw new Error("Sauvegardez votre clé, puis ressaisissez-la exactement pour confirmer.");
        if (!/^\d{8}$/.test(code)) throw new Error("Saisissez le code de 8 chiffres reçu par e-mail.");
        await enrollIdentity(userId, generated.identity, challenge, code);
        target = generated.identity;
      }
      const unlocked = await unlockMessagingIdentity(target, secret.trim());
      if (!mounted.current || current !== operation.current) return;
      setSecret(""); setCode(""); setGenerated(undefined);
      onUnlocked({ userId, identity: unlocked });
    } catch (cause) {
      if (mounted.current && current === operation.current) setError(identity ? "Cette clé ne déverrouille pas votre messagerie. Vérifiez la clé LSNB1 sauvegardée." : cause instanceof Error ? cause.message : "L’activation n’a pas abouti.");
    } finally { if (mounted.current && current === operation.current) setBusy(false); }
  };

  const copyKey = async () => {
    if (!generated) return;
    try { await navigator.clipboard.writeText(generated.recoverySecret); if (mounted.current) setNotice("Clé copiée. Conservez-la dans votre gestionnaire de mots de passe ou un lieu sûr."); }
    catch { if (mounted.current) setError("La copie automatique est indisponible. Sélectionnez et copiez la clé affichée."); }
  };
  const downloadKey = () => {
    if (!generated) return;
    const file = new Blob([`Clé personnelle de messagerie LSNB\nCompte : ${userId}\n\n${generated.recoverySecret}\n\nNe partagez pas cette clé. Sa perte rend votre historique chiffré irrécupérable.\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "cle-messagerie-lsnb.txt"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Rangez le fichier téléchargé dans un lieu sûr. Le site ne conserve pas votre clé de récupération.");
  };

  return <div className="messages-page page-shell"><MessagingNavigation />
    <section className="message-vault" aria-labelledby="vault-title">
      <LockKeyhole size={36} strokeWidth={1.4} aria-hidden="true" />
      <p className="eyebrow eyebrow--dark">Messagerie chiffrée de bout en bout</p>
      <h1 id="vault-title">{identity === undefined ? "Vérification de votre messagerie…" : identity ? "Déverrouillez vos messages." : "Votre clé, vos conversations."}</h1>
      <p>Votre clé personnelle ouvre les messages sur cet appareil. Le serveur conserve uniquement les nouveaux messages chiffrés et une copie chiffrée de votre clé privée.</p>
      {identity === undefined && !error && <p role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /> Chargement…</p>}
      {identity === undefined && error && <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Réessayer</Button>}
      {identity === null && !generated && <>
        <div className="message-vault__warning"><strong>Conservez votre clé de récupération.</strong><p>Si vous la perdez, votre historique chiffré sera irrécupérable. Nous ne pouvons ni retrouver cette clé ni la réinitialiser pour lire les anciens messages.</p></div>
        <Button disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />} Activer ma messagerie chiffrée</Button>
      </>}
      {(identity || generated) && <form onSubmit={(event) => void submit(event)} autoComplete="off">
        {generated && <>
          <h2>1. Sauvegardez votre clé personnelle</h2>
          <p>Cette clé est créée dans votre navigateur. Elle ne sera jamais envoyée au serveur.</p>
          <label htmlFor="new-messaging-key">Votre clé de récupération</label>
          <textarea id="new-messaging-key" value={generated.recoverySecret} readOnly rows={3} spellCheck={false} autoComplete="off" className="message-vault__secret" />
          <div className="message-vault__actions"><Button variant="outline" size="sm" onClick={() => void copyKey()}><Copy size={16} aria-hidden="true" /> Copier la clé</Button><Button variant="outline" size="sm" onClick={downloadKey}><Download size={16} aria-hidden="true" /> Télécharger la clé</Button></div>
          <label className="message-vault__saved"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} required disabled={busy} /> J’ai conservé ma clé dans un lieu sûr et je comprends qu’elle ne peut pas être récupérée en cas de perte.</label>
          <h2>2. Confirmez votre clé et votre e-mail</h2>
        </>}
        <label htmlFor="messaging-key">{generated ? "Ressaisissez votre clé sauvegardée" : "Votre clé de récupération LSNB1"}</label>
        <input id="messaging-key" name="messaging-recovery" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} disabled={busy} required placeholder="LSNB1-…" />
        {generated && <><label htmlFor="identity-email-code">Code reçu par e-mail</label><input id="identity-email-code" name="identity-email-code" type="text" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" disabled={busy} required /><button type="button" className="text-link text-link--dark" onClick={() => void start()} disabled={busy}>Recevoir un nouveau code</button></>}
        <Button type="submit" disabled={busy || !secret.trim() || Boolean(generated && (!saved || code.length !== 8 || secret.trim() !== generated.recoverySecret))}>{busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}{generated ? "Confirmer et ouvrir ma messagerie" : "Déverrouiller"}</Button>
      </form>}
      {notice && <p role="status" className="message-vault__notice">{notice}</p>}
      {error && <p role="alert" className="messages-error">{error}</p>}
      <p className="message-vault__footnote">La messagerie se verrouille au rechargement, après 5 minutes sans activité ou 1 minute dans un onglet masqué. Les textes et brouillons sont alors retirés de l’écran et de l’état de l’application. Les anciennes présentations des demandes restent dans Mes relations et ne sont pas chiffrées de bout en bout.</p>
    </section>
  </div>;
}

export function MessagingVault({ userId, children }: { userId: string; children: (session: MessagingSession, lock: () => void) => ReactNode }) {
  const [session, setSession] = useState<MessagingSession>();
  const [epoch, setEpoch] = useState(0);
  const current = useRef<MessagingSession | undefined>(undefined);
  const lastActivity = useRef(Date.now());
  const hiddenAt = useRef<number | null>(document.visibilityState === "hidden" ? Date.now() : null);
  const lock = useCallback(() => {
    if (current.current) current.current.identity = null;
    current.current = undefined;
    setSession(undefined);
    setEpoch((value) => value + 1);
    lastActivity.current = Date.now();
  }, []);
  useEffect(() => {
    const expired = () => Date.now() - lastActivity.current >= 300000 || (hiddenAt.current !== null && Date.now() - hiddenAt.current >= 60000);
    const check = () => { if (expired()) { lock(); hiddenAt.current = document.visibilityState === "hidden" ? Date.now() : null; } };
    const activity = () => { check(); if (document.visibilityState === "visible") lastActivity.current = Date.now(); };
    const visibility = () => {
      check();
      hiddenAt.current = document.visibilityState === "hidden" ? Date.now() : null;
    };
    // A full navigation can freeze React in the back/forward cache. Remove keys
    // and plaintext synchronously before the browser snapshots this document.
    const leaving = () => { flushSync(lock); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) flushSync(lock); };
    const timer = window.setInterval(check, 1000);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("scroll", activity, { passive: true, capture: true });
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", restored);
    return () => {
      if (current.current) current.current.identity = null;
      current.current = undefined;
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("scroll", activity, true);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", restored);
    };
  }, [lock]);
  if (session?.identity && session.userId === userId) return children(session, lock);
  return <VaultAccess key={`${userId}:${epoch}`} userId={userId} onUnlocked={(opened) => {
    current.current = opened;
    lastActivity.current = Date.now();
    setSession(opened);
  }} />;
}
