import { sendEmail } from './lib/brevo.js';

const MAX_CV_BYTES = 5 * 1024 * 1024;

async function sessionIsPaidAudit(env, sessionId) {
  if (!sessionId || !/^cs_(test|live)_[a-zA-Z0-9]+$/.test(sessionId)) return { ok: false };
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return { ok: false };
  const s = await res.json();
  if (s.payment_status !== 'paid' || s.metadata?.product !== 'audit') return { ok: false };
  return { ok: true, email: s.customer_details?.email };
}

const page = (title, body) => new Response(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Consultant Chronicles</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#0d0d0f;color:#ecebe3;font-family:Archivo,sans-serif;line-height:1.55}
  .wrap{max-width:540px;margin:0 auto;padding:48px 22px}
  h1{font-family:Fraunces,serif;font-weight:500;font-size:30px;line-height:1.15}
  h1 em{font-style:italic;color:#e6cd8b}
  p{color:#9c988c}
  label{display:block;font-size:12px;color:#9c988c;margin:18px 0 5px}
  input,textarea{width:100%;box-sizing:border-box;background:#151517;color:#ecebe3;
    border:1px solid rgba(201,163,90,.22);border-radius:11px;padding:13px 14px;font:inherit;font-size:15px}
  input:focus,textarea:focus{outline:none;border-color:#c9a35a}
  button{margin-top:24px;width:100%;border:0;cursor:pointer;background:linear-gradient(180deg,#e6cd8b,#c9a35a);
    color:#1a1408;font-weight:700;font-size:15.5px;padding:15px 18px;border-radius:12px;font-family:Archivo}
  .note{font-size:12px;color:#726f68;margin-top:12px}
</style></head><body><main class="wrap">${body}</main></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function handleAuditForm(request, env) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  const check = await sessionIsPaidAudit(env, sessionId);
  if (!check.ok) {
    return page('Accès refusé', `<h1>Hmm, ce lien ne fonctionne pas.</h1>
      <p>Ce formulaire est réservé aux commandes d'audit confirmées. Si tu viens de payer,
      réessaie depuis la page de confirmation Stripe, ou écris à contact@consultantchronicles.fr.</p>`);
  }
  return page('Ton audit', `<h1>Ton audit démarre <em>ici</em>.</h1>
    <p>Dépose ton CV et donne-moi le contexte. Tu reçois ton audit complet sous 72h ouvrées, par email.</p>
    <form method="post" action="/audit" enctype="multipart/form-data">
      <input type="hidden" name="session_id" value="${sessionId}">
      <label for="cv">Ton CV (PDF, 5 Mo max)</label>
      <input type="file" id="cv" name="cv" accept="application/pdf" required>
      <label for="linkedin">URL de ton profil LinkedIn</label>
      <input type="url" id="linkedin" name="linkedin" placeholder="https://linkedin.com/in/…">
      <label for="poste">Le poste ou type de poste que tu vises</label>
      <input type="text" id="poste" name="poste" required placeholder="Ex. : Chef de projet marketing, secteur tech">
      <label for="questions">Tes questions (3 max, une par ligne)</label>
      <textarea id="questions" name="questions" rows="4" placeholder="Ce qui te bloque, ce que tu veux que je regarde en priorité…"></textarea>
      <button type="submit">Envoyer mon dossier</button>
      <p class="note">Tes documents servent uniquement à réaliser l'audit, puis sont supprimés. Aucune donnée partagée.</p>
    </form>`);
}

export async function handleAuditSubmit(request, env) {
  const form = await request.formData();
  const check = await sessionIsPaidAudit(env, form.get('session_id'));
  if (!check.ok) return page('Accès refusé', `<h1>Session invalide.</h1><p>Merci de repasser par ton lien de confirmation.</p>`);

  const cv = form.get('cv');
  if (!cv || typeof cv === 'string') return page('CV manquant', `<h1>Il manque ton CV.</h1><p>Reviens en arrière et joins ton CV en PDF.</p>`);
  if (cv.size > MAX_CV_BYTES) return page('Fichier trop lourd', `<h1>CV trop lourd.</h1><p>5 Mo maximum — compresse ton PDF et réessaie.</p>`);

  const buf = new Uint8Array(await cv.arrayBuffer());
  let b64 = '';
  for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  b64 = btoa(b64);

  await sendEmail(env, {
    to: env.NOTIFY_EMAIL,
    subject: `🔔 Nouvel audit payé — ${check.email}`,
    html: `<p>Client : ${check.email}</p>
      <p>LinkedIn : ${form.get('linkedin') || '—'}</p>
      <p>Poste visé : ${form.get('poste') || '—'}</p>
      <p>Questions :<br>${String(form.get('questions') || '—').replace(/\n/g, '<br>')}</p>
      <p>Session Stripe : ${form.get('session_id')}</p>
      <p>⏱ À livrer sous 72h ouvrées.</p>`,
    attachments: [{ name: cv.name || 'cv.pdf', content: b64 }],
  });

  return page('Dossier reçu', `<h1>C'est <em>parti</em>.</h1>
    <p>Ton dossier est bien arrivé. Tu recevras ton audit complet sous 72h ouvrées à l'adresse
    utilisée pour le paiement (${check.email}). D'ici là, respire — c'est moi qui bosse.</p>`);
}
