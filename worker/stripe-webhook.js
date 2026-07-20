import { hmacHex, makeDownloadUrl } from './lib/sign.js';
import { sendEmail, addContact } from './lib/brevo.js';

const TOLERANCE_SEC = 300;
const LINK_TTL_SEC = 7 * 24 * 3600; // lien valable 7 jours

export async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = sigHeader.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const v1s = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || v1s.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > TOLERANCE_SEC) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return v1s.some((v1) => {
    if (v1.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < v1.length; i++) diff |= v1.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

export async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  const ok = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Bad signature', { status: 400 });

  const event = JSON.parse(payload);
  if (event.type !== 'checkout.session.completed') return new Response('ignored', { status: 200 });

  const session = event.data.object;
  if (session.payment_status !== 'paid') return new Response('unpaid, ignored', { status: 200 });

  const email = session.customer_details?.email;
  const product = session.metadata?.product;
  if (!email) return new Response('no email', { status: 200 });

  await addContact(env, { email, listIds: [Number(env.CLIENTS_LIST_ID)] });

  if (product === 'guide') {
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
    const url = await makeDownloadUrl(env, email, exp);
    await sendEmail(env, {
      to: email,
      subject: 'Ton guide CV/ATS — Consultant Chronicles',
      html: guideEmailHtml(url),
    });
  }
  // product === 'audit' : rien à envoyer ici, le client est redirigé vers /audit par Stripe.
  return new Response('ok', { status: 200 });
}

function guideEmailHtml(url) {
  return `
  <div style="font-family:Georgia,serif;max-width:540px;margin:0 auto;color:#0d0d0f">
    <h1 style="font-size:22px">Merci pour ta confiance.</h1>
    <p>Ton guide <b>« Le CV qui passe — ATS &amp; recruteurs »</b> est prêt.</p>
    <p style="margin:28px 0"><a href="${url}"
      style="background:#c9a35a;color:#0d0d0f;padding:14px 22px;border-radius:10px;
      text-decoration:none;font-weight:bold">Télécharger le guide (PDF)</a></p>
    <p style="font-size:13px;color:#555">Ce lien est personnel et valable 7 jours.
    Un souci ? Réponds simplement à cet email.</p>
    <p style="font-size:13px;color:#555">— Consultant Chronicles</p>
  </div>`;
}
