export type BrandedEmail = { subject: string; text: string; html: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

type EmailContent = {
  subject: string; preheader: string; label: string; title: string; introduction: string;
  action: string; actionUrl: string; note: string; footer: string; text: string;
};

// Table layout and inline styles keep the action usable in restrictive mail clients.
// No remote images, web fonts, pixels, scripts, or recipient-derived content.
function renderEmail(content: EmailContent): BrandedEmail {
  const link = escapeHtml(content.actionUrl);
  const action = `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#0c2948" style="background-color:#0c2948;border:1px solid #0c2948;border-radius:4px;text-align:center;mso-padding-alt:16px 24px;">
          <a href="${link}" target="_blank" rel="noreferrer" style="display:inline-block;padding:16px 24px;border-radius:4px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(content.action)}</a>
        </td></tr></table>`;
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#faf8f3;color:#142536;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#faf8f3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#faf8f3;"><tr><td align="center" style="padding:28px 16px;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:26px 28px;background-color:#0c2948;border-bottom:4px solid #c27d38;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="color:#fffdf8;font-size:14px;font-weight:700;letter-spacing:2px;line-height:20px;">ALUMNI<br><span style="font-size:29px;letter-spacing:1px;line-height:32px;color:#e7b77d;">LSNB</span></td>
          <td align="right" valign="bottom" style="color:#e7b77d;font-size:12px;line-height:18px;">Bobo-Dioulasso<br>Burkina Faso</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 28px 28px;background-color:#ffffff;border-right:1px solid #eadac6;border-left:1px solid #eadac6;">
        <p style="margin:0 0 14px;color:#76502d;font-size:12px;font-weight:700;letter-spacing:1px;line-height:18px;text-transform:uppercase;">${escapeHtml(content.label)}</p>
        <h1 style="margin:0 0 20px;color:#0c2948;font-size:32px;font-weight:700;line-height:38px;letter-spacing:-0.7px;">${escapeHtml(content.title)}</h1>
        <p style="margin:0 0 26px;font-size:16px;line-height:26px;color:#425466;">${escapeHtml(content.introduction)}</p>
        ${action}
        <p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#536371;">${escapeHtml(content.note)}</p>
      </td></tr>
      <tr><td style="padding:22px 28px;background-color:#f3eee5;border:1px solid #eadac6;border-top:0;">
        <p style="margin:0 0 8px;font-size:12px;line-height:19px;color:#536371;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
        <p style="margin:0;font-size:12px;line-height:19px;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" target="_blank" rel="noreferrer" style="color:#0c2948;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${link}</a></p>
      </td></tr>
      <tr><td style="padding:22px 8px 0;text-align:center;">
        <p style="margin:0 0 10px;font-size:12px;line-height:19px;color:#536371;">${content.footer}</p>
        <p style="margin:0;font-size:12px;line-height:19px;color:#6c746f;">LSNB Alumni<br>Lycée Scientifique National de Bobo-Dioulasso</p>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
  return { subject: content.subject, text: content.text, html };
}

export function renderConfirmationEmail(confirmationUrl: string): BrandedEmail {
  return renderEmail({
    subject: "Confirmez votre inscription à LSNB Alumni",
    preheader: "Confirmez votre adresse e-mail pour activer votre compte.",
    label: "Votre inscription", title: "Confirmez votre adresse.",
    introduction: "Votre demande d’inscription à LSNB Alumni a bien été reçue. Confirmez votre adresse e-mail pour activer votre compte et accéder à votre espace membre.",
    action: "Confirmer mon adresse", actionUrl: confirmationUrl,
    note: "Ce lien est personnel et utilisable une seule fois. S’il a expiré, demandez un nouvel e-mail depuis la page de connexion du site.",
    footer: "Vous n’êtes pas à l’origine de cette inscription ?<br>Ignorez simplement cet e-mail.",
    text: `LSNB ALUMNI\n\nConfirmez votre adresse.\n\nVotre demande d’inscription à LSNB Alumni a bien été reçue. Confirmez votre adresse e-mail pour activer votre compte et accéder à votre espace membre.\n\nConfirmer mon adresse :\n${confirmationUrl}\n\nCe lien est personnel et utilisable une seule fois. S’il a expiré, demandez un nouvel e-mail depuis la page de connexion du site.\n\nVous n’êtes pas à l’origine de cette inscription ? Ignorez simplement cet e-mail.\n\nLSNB Alumni\nLycée Scientifique National de Bobo-Dioulasso`,
  });
}

export function renderMessageNotificationEmail(conversationUrl: string, settingsUrl: string): BrandedEmail {
  return renderEmail({
    subject: "Un message vous attend sur LSNB Alumni",
    preheader: "Retrouvez vos messages non lus dans votre espace membre.",
    label: "Votre messagerie", title: "Un message vous attend.",
    introduction: "Vous avez des messages non lus sur LSNB Alumni. Retrouvez votre conversation et répondez directement depuis le site.",
    action: "Ouvrir la conversation", actionUrl: conversationUrl,
    note: "Le contenu des messages reste sur le site. Aucun extrait ni nom d’expéditeur n’est inclus dans cet e-mail.",
    footer: `Vous recevez ce rappel parce que les alertes e-mail sont activées.<br><a href="${escapeHtml(settingsUrl)}" target="_blank" rel="noreferrer" style="color:#0c2948;text-decoration:underline;">Gérer mes notifications</a> dans la messagerie.`,
    text: `LSNB ALUMNI\n\nUn message vous attend.\n\nVous avez des messages non lus sur LSNB Alumni. Retrouvez votre conversation et répondez directement depuis le site.\n\nOuvrir la conversation :\n${conversationUrl}\n\nLe contenu des messages reste sur le site. Aucun extrait ni nom d’expéditeur n’est inclus dans cet e-mail.\n\nVous recevez ce rappel parce que les alertes e-mail sont activées. Pour les désactiver, ouvrez les réglages de votre messagerie :\n${settingsUrl}\n\nLSNB Alumni\nLycée Scientifique National de Bobo-Dioulasso`,
  });
}
