# Monétisation B2C Consultant Chronicles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer la page bio `consultantchronicles.fr` en mini-boutique : guide CV/ATS à 19 € (livraison automatique) + audit CV/LinkedIn à 99 € (formulaire post-paiement), sur la stack existante GitHub Pages + Cloudflare Worker + Brevo + Stripe.

**Architecture:** Le Worker Cloudflare existant (`brevo-subscribe`, actuellement mono-route) devient un petit routeur : `/` (inscription Brevo, inchangé), `/stripe-webhook` (livraison du guide), `/download` (téléchargement du PDF par lien signé expirant), `/audit` (formulaire post-paiement + dépôt CV). Les pages de vente restent statiques sur GitHub Pages. Le PDF payant est un asset privé du Worker (gitignoré, uploadé au deploy), jamais dans le repo public.

**Tech Stack:** Cloudflare Workers (ES modules, Wrangler, Workers Assets), Stripe Payment Links + webhook (vérification de signature manuelle via WebCrypto), Brevo API v3 (contacts + emails transactionnels), HTML/CSS statique (pas de framework), tests unitaires `node --test` (Node ≥ 20).

## Global Constraints

- Repo **public** (`github.com/MossAbid/bio`) : aucun secret, aucune clé API, aucun PDF payant commité — jamais.
- Charte graphique stricte : noir `#0D0D0F`, or `#C9A35A`, crème `#ECEBE3`, typographies Fraunces (titres) + Archivo (texte). Réutiliser les variables CSS d'`index.html`.
- Prix affichés : « 19 € TTC » et « 99 € TTC » avec la mention « TVA non applicable, art. 293 B du CGI ».
- Stripe reste en **mode test** jusqu'à réception du SIRET (action Moss, hors plan). Aucune bascule live sans son accord explicite.
- Copy exclusivement côté candidat (jamais d'offre destinée aux entreprises).
- Ton éditorial : cohérent avec la tagline « Les méthodes de ceux qui recrutent, mises à ton service ».
- Le formulaire d'inscription existant (page bio → Worker → liste Brevo #2) doit continuer de fonctionner à l'identique après chaque tâche.
- Worker déployé sous le même nom `brevo-subscribe` (l'URL `https://brevo-subscribe.mmossly.workers.dev` est câblée dans `index.html` en prod).
- Secrets Wrangler utilisés partout : `BREVO_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SIGN_SECRET`. Vars non secrètes dans `wrangler.toml` : `NOTIFY_EMAIL`, `CLIENTS_LIST_ID`, `SITE_ORIGIN`.

---

### Task 1: Assainir le Worker — Wrangler + secret Brevo (fuite active à corriger)

Contexte : `worker.js:38` contient la clé API Brevo **en clair dans un repo public**. Fuite déjà signalée le 16/06, jamais corrigée. On migre le Worker vers un déploiement Wrangler avec secret, et Moss révoque l'ancienne clé.

**Files:**
- Create: `wrangler.toml`
- Create: `package.json`
- Create: `worker/index.js` (routeur minimal)
- Create: `worker/subscribe.js` (logique existante, clé retirée)
- Delete: `worker.js` (remplacé par `worker/`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: routeur `worker/index.js` avec table `routes` (méthode+pathname → handler `(request, env) => Response`), helper `cors(headers?)` exporté depuis `worker/subscribe.js`. Signature handler : `handleSubscribe(request, env)`.
- Produces: `env.BREVO_API_KEY` disponible dans tous les handlers.

- [ ] **Step 1 : Vérifier l'accès Wrangler**

Run: `cd ~/Projets/consultant-chronicles && npx wrangler whoami`
Expected: affiche le compte Cloudflare (mmossly). Si « not authenticated », demander à Moss de lancer `npx wrangler login` (action interactive, navigateur).

- [ ] **Step 2 : Créer `package.json`**

```json
{
  "name": "consultant-chronicles-bio",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

Run: `npm install`

- [ ] **Step 3 : Créer `wrangler.toml`**

```toml
name = "brevo-subscribe"
main = "worker/index.js"
compatibility_date = "2026-07-01"

[vars]
NOTIFY_EMAIL = "mmossly@gmail.com"
SITE_ORIGIN = "https://consultantchronicles.fr"
CLIENTS_LIST_ID = "0"   # remplacé en Task 3 par l'id réel de la liste Brevo « Clients »
```

- [ ] **Step 4 : Créer `worker/subscribe.js`** — logique actuelle de `worker.js`, clé lue depuis `env` :

```js
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...headers },
  });
}

export async function handleSubscribe(request, env) {
  try {
    const { email, prenom } = await request.json();
    if (!email) return json({ error: 'Email requis' }, 400);

    const payload = {
      email,
      listIds: [2],
      updateEnabled: true,
      ...(prenom && { attributes: { PRENOM: prenom } }),
    };

    const brevo = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = brevo.ok ? { success: true } : await brevo.json();
    if (!brevo.ok && data?.code !== 'duplicate_parameter') return json(data, brevo.status);
    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
```

- [ ] **Step 5 : Créer `worker/index.js`** — routeur :

```js
import { CORS, handleSubscribe } from './subscribe.js';

const routes = [
  { method: 'POST', path: '/', handler: handleSubscribe },
];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(request.url);
    const route = routes.find((r) => r.method === request.method && r.path === pathname);
    if (!route) return new Response('Not found', { status: 404, headers: CORS });
    return route.handler(request, env);
  },
};
```

- [ ] **Step 6 : Supprimer `worker.js`, compléter `.gitignore`**

Run: `git rm worker.js`
`.gitignore` — contenu complet :

```
CLAUDE.md
_archive-preview-demo/
_scripts/
.DS_Store
node_modules/
.wrangler/
assets-private/
```

- [ ] **Step 7 : Rotation de la clé Brevo (ACTION MOSS — bloquant)**

Demander à Moss : dans Brevo → Paramètres → Clés API : **créer une nouvelle clé**, puis **révoquer l'ancienne** (celle qui commence par `xkeysib-5661bbfb…`). Récupérer la nouvelle clé.
⚠️ Ne pas continuer avec l'ancienne clé : elle est publique dans l'historique GitHub.

- [ ] **Step 8 : Poser le secret et déployer**

Run: `npx wrangler secret put BREVO_API_KEY` (coller la nouvelle clé)
Run: `npx wrangler deploy`
Expected: `Deployed brevo-subscribe … https://brevo-subscribe.mmossly.workers.dev`

- [ ] **Step 9 : Vérifier que l'inscription marche toujours**

Run: `curl -s -X POST https://brevo-subscribe.mmossly.workers.dev/ -H 'Content-Type: application/json' -d '{"email":"test-task1@example.com","prenom":"Test"}'`
Expected: `{"success":true}`

- [ ] **Step 10 : Commit**

```bash
git add package.json package-lock.json wrangler.toml worker/ .gitignore
git commit -m "refactor(worker): migration Wrangler, clé Brevo en secret (fuite corrigée)"
```

---

### Task 2: Helpers signés + client Brevo (TDD)

**Files:**
- Create: `worker/lib/sign.js`
- Create: `worker/lib/brevo.js`
- Test: `tests/sign.test.mjs`

**Interfaces:**
- Produces: `hmacHex(secret, message) → Promise<string>` ; `makeDownloadUrl(env, email, expEpochSec) → Promise<string>` (URL absolue `${workerOrigin}/download?e=…&exp=…&sig=…`) ; `verifyDownload(env, e, exp, sig) → Promise<boolean>` (faux si signature invalide OU expiré).
- Produces: `sendEmail(env, { to, subject, html, attachments? })` (attachments: `[{ name, content }]`, content en base64) ; `addContact(env, { email, prenom, listIds })`. Les deux lèvent `Error` si Brevo répond non-2xx (sauf `duplicate_parameter` pour `addContact`).
- Consumes: `env.BREVO_API_KEY`, `env.SIGN_SECRET` (posé en Task 3).

- [ ] **Step 1 : Écrire les tests qui échouent** — `tests/sign.test.mjs` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hmacHex, makeDownloadUrl, verifyDownload } from '../worker/lib/sign.js';

const env = { SIGN_SECRET: 'test-secret', WORKER_ORIGIN: 'https://w.example' };

test('hmacHex is deterministic and hex', async () => {
  const a = await hmacHex('s', 'm');
  const b = await hmacHex('s', 'm');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('valid token verifies', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const url = new URL(await makeDownloadUrl(env, 'a@b.fr', exp));
  const ok = await verifyDownload(env, url.searchParams.get('e'),
    url.searchParams.get('exp'), url.searchParams.get('sig'));
  assert.equal(ok, true);
});

test('tampered email fails', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const url = new URL(await makeDownloadUrl(env, 'a@b.fr', exp));
  const ok = await verifyDownload(env, 'evil@b.fr',
    url.searchParams.get('exp'), url.searchParams.get('sig'));
  assert.equal(ok, false);
});

test('expired token fails', async () => {
  const exp = Math.floor(Date.now() / 1000) - 10;
  const url = new URL(await makeDownloadUrl(env, 'a@b.fr', exp));
  const ok = await verifyDownload(env, url.searchParams.get('e'),
    url.searchParams.get('exp'), url.searchParams.get('sig'));
  assert.equal(ok, false);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../worker/lib/sign.js'`

- [ ] **Step 3 : Implémenter `worker/lib/sign.js`**

```js
const enc = new TextEncoder();

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeDownloadUrl(env, email, expEpochSec) {
  const sig = await hmacHex(env.SIGN_SECRET, `${email}.${expEpochSec}`);
  const u = new URL('/download', env.WORKER_ORIGIN);
  u.searchParams.set('e', email);
  u.searchParams.set('exp', String(expEpochSec));
  u.searchParams.set('sig', sig);
  return u.toString();
}

export async function verifyDownload(env, e, exp, sig) {
  if (!e || !exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(env.SIGN_SECRET, `${e}.${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `npm test`
Expected: `pass 4` / `fail 0`

- [ ] **Step 5 : Implémenter `worker/lib/brevo.js`** (pas de test unitaire — simple wrapper HTTP, vérifié en intégration Task 4) :

```js
async function brevoFetch(env, path, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data?.code === 'duplicate_parameter') return data;
    throw new Error(`Brevo ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return res.json().catch(() => ({}));
}

export function sendEmail(env, { to, subject, html, attachments }) {
  return brevoFetch(env, '/smtp/email', {
    sender: { name: 'Consultant Chronicles', email: 'contact@consultantchronicles.fr' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(attachments && { attachment: attachments }),
  });
}

export function addContact(env, { email, prenom, listIds }) {
  return brevoFetch(env, '/contacts', {
    email,
    listIds,
    updateEnabled: true,
    ...(prenom && { attributes: { PRENOM: prenom } }),
  });
}
```

- [ ] **Step 6 : Commit**

```bash
git add worker/lib/ tests/
git commit -m "feat(worker): helpers lien signé (TDD) + client Brevo"
```

---

### Task 3: Configuration Stripe test + liste Brevo « Clients » + secrets

Tâche de configuration externe. Tout en **mode test** Stripe. Prérequis : Moss connecté à dashboard.stripe.com (un compte en mode test se crée sans SIRET).

**Files:**
- Modify: `wrangler.toml` (CLIENTS_LIST_ID réel, WORKER_ORIGIN)

**Interfaces:**
- Produces: 2 Payment Links test (guide, audit) avec `metadata.product = "guide" | "audit"` — URLs consignées dans `docs/superpowers/plans/stripe-links.md` (commité : de simples URLs de paiement test, non sensibles).
- Produces: secrets Wrangler `STRIPE_SECRET_KEY` (clé `sk_test_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…`), `SIGN_SECRET` (aléatoire).
- Produces: liste Brevo « Clients » et son id dans `env.CLIENTS_LIST_ID`.

- [ ] **Step 1 : Créer la liste Brevo « Clients »**

Run (remplacer `$BREVO_KEY` par la clé de Task 1, ne pas l'écrire dans un fichier) :
```bash
curl -s -X POST https://api.brevo.com/v3/contacts/lists \
  -H "api-key: $BREVO_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Clients","folderId":1}'
```
Expected: `{"id":<N>}` — reporter `<N>` dans `wrangler.toml` → `CLIENTS_LIST_ID = "<N>"`.

- [ ] **Step 2 : Ajouter `WORKER_ORIGIN` dans `wrangler.toml` [vars]**

```toml
WORKER_ORIGIN = "https://brevo-subscribe.mmossly.workers.dev"
```

- [ ] **Step 3 : Produits + Payment Links Stripe (dashboard, mode test — guider Moss ou faire via Stripe CLI si installé)**

Dans dashboard.stripe.com (toggle « Mode test ») :
1. Produit « Guide CV/ATS — Consultant Chronicles », prix 19,00 € TTC unique.
2. Produit « Audit CV/LinkedIn — Consultant Chronicles », prix 99,00 € TTC unique.
3. Payment Link guide : produit 1 ; métadonnée `product = guide` ; page de confirmation → rediriger vers `https://consultantchronicles.fr/merci.html` ; activer « adresse email obligatoire ».
4. Payment Link audit : produit 2 ; métadonnée `product = audit` ; redirection → `https://brevo-subscribe.mmossly.workers.dev/audit?session_id={CHECKOUT_SESSION_ID}`.
5. Noter les deux URLs `https://buy.stripe.com/test_…` dans `docs/superpowers/plans/stripe-links.md`.

- [ ] **Step 4 : Webhook Stripe**

Dashboard → Développeurs → Webhooks → Ajouter un endpoint :
- URL : `https://brevo-subscribe.mmossly.workers.dev/stripe-webhook`
- Événement : `checkout.session.completed` uniquement.
- Copier le signing secret `whsec_…`.

- [ ] **Step 5 : Poser les secrets**

```bash
npx wrangler secret put STRIPE_SECRET_KEY     # sk_test_…
npx wrangler secret put STRIPE_WEBHOOK_SECRET # whsec_…
openssl rand -hex 32 | npx wrangler secret put SIGN_SECRET
npx wrangler deploy
```

- [ ] **Step 6 : Commit**

```bash
git add wrangler.toml docs/superpowers/plans/stripe-links.md
git commit -m "chore: config Stripe test (links, webhook) + liste Brevo Clients"
```

---

### Task 4: Route webhook Stripe → livraison du guide

**Files:**
- Create: `worker/stripe-webhook.js`
- Modify: `worker/index.js`
- Test: `tests/stripe-sig.test.mjs`

**Interfaces:**
- Consumes: `makeDownloadUrl`, `sendEmail`, `addContact` (Task 2) ; secrets Task 3.
- Produces: `verifyStripeSignature(payload, sigHeader, secret) → Promise<boolean>` (tolérance 5 min) ; `handleStripeWebhook(request, env)` monté sur `POST /stripe-webhook`.

- [ ] **Step 1 : Test de signature qui échoue** — `tests/stripe-sig.test.mjs` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStripeSignature } from '../worker/stripe-webhook.js';
import { hmacHex } from '../worker/lib/sign.js';

test('valid signature passes, wrong secret fails, old timestamp fails', async () => {
  const payload = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = await hmacHex('whsec_x', `${t}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_x'), true);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_y'), false);
  const old = t - 3600;
  const v1old = await hmacHex('whsec_x', `${old}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${old},v1=${v1old}`, 'whsec_x'), false);
});
```

Run: `npm test` → Expected: FAIL (`verifyStripeSignature` introuvable).

- [ ] **Step 2 : Implémenter `worker/stripe-webhook.js`**

```js
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
```

- [ ] **Step 3 : Monter la route dans `worker/index.js`**

```js
import { handleStripeWebhook } from './stripe-webhook.js';
```
et dans `routes` :
```js
  { method: 'POST', path: '/stripe-webhook', handler: handleStripeWebhook },
```

- [ ] **Step 4 : Tests unitaires**

Run: `npm test`
Expected: tous les tests passent (sign + stripe-sig).

- [ ] **Step 5 : Déployer puis test d'intégration réel**

Run: `npx wrangler deploy`
Puis paiement test du guide : ouvrir l'URL `buy.stripe.com/test_…` (guide), payer avec la carte `4242 4242 4242 4242` (date future, CVC 123), email = adresse de test de Moss.
Expected: (1) redirection vers `consultantchronicles.fr/merci.html` (404 pour l'instant — la page arrive en Task 7, c'est attendu) ; (2) email Brevo reçu avec le lien `/download?…` ; (3) dashboard Stripe → webhook → livraison 200.

- [ ] **Step 6 : Commit**

```bash
git add worker/stripe-webhook.js worker/index.js tests/stripe-sig.test.mjs
git commit -m "feat(worker): webhook Stripe + email de livraison du guide"
```

---

### Task 5: Route /download + asset privé du guide

**Files:**
- Create: `worker/download.js`
- Create: `assets-private/guide-cv-ats.pdf` (placeholder tant que le guide n'est pas écrit — Task 9)
- Modify: `wrangler.toml`, `worker/index.js`

**Interfaces:**
- Consumes: `verifyDownload` (Task 2), binding `env.ASSETS`.
- Produces: `GET /download?e&exp&sig` → PDF si signature valide, 403 sinon.

- [ ] **Step 1 : Config assets dans `wrangler.toml`**

```toml
[assets]
directory = "assets-private"
binding = "ASSETS"
run_worker_first = true
```

`run_worker_first = true` est **obligatoire** : sans lui, `assets-private/guide-cv-ats.pdf` serait servi publiquement à `/guide-cv-ats.pdf` sans passer par le code.

- [ ] **Step 2 : Créer le PDF placeholder**

Run:
```bash
mkdir -p assets-private
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF' > assets-private/guide-cv-ats.pdf
```
(gitignoré — vérifier avec `git status` qu'il n'apparaît pas.)

- [ ] **Step 3 : Implémenter `worker/download.js`**

```js
import { verifyDownload } from './lib/sign.js';

export async function handleDownload(request, env) {
  const u = new URL(request.url);
  const ok = await verifyDownload(env, u.searchParams.get('e'),
    u.searchParams.get('exp'), u.searchParams.get('sig'));
  if (!ok) {
    return new Response('Lien invalide ou expiré. Réponds à ton email de confirmation pour en recevoir un nouveau.',
      { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const asset = await env.ASSETS.fetch(new URL('/guide-cv-ats.pdf', u.origin));
  return new Response(asset.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="Guide-CV-ATS-Consultant-Chronicles.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 4 : Monter `{ method: 'GET', path: '/download', handler: handleDownload }` dans `worker/index.js`** (import en tête de fichier).

- [ ] **Step 5 : Déployer et vérifier les deux chemins**

Run: `npx wrangler deploy`
1. `curl -sI 'https://brevo-subscribe.mmossly.workers.dev/download?e=x@y.fr&exp=9999999999&sig=mauvaise'` → Expected: `403`
2. `curl -sI 'https://brevo-subscribe.mmossly.workers.dev/guide-cv-ats.pdf'` → Expected: `404` (asset non exposé directement)
3. Reprendre le lien reçu par email en Task 4 Step 5 → Expected: téléchargement du PDF placeholder (`200`, `application/pdf`).

- [ ] **Step 6 : Commit**

```bash
git add worker/download.js worker/index.js wrangler.toml
git commit -m "feat(worker): téléchargement du guide par lien signé expirant"
```

---

### Task 6: Route /audit — formulaire post-paiement + dépôt CV

**Files:**
- Create: `worker/audit.js`
- Modify: `worker/index.js`

**Interfaces:**
- Consumes: `sendEmail` (Task 2), `env.STRIPE_SECRET_KEY`, `env.NOTIFY_EMAIL`.
- Produces: `GET /audit?session_id=…` → page HTML formulaire ; `POST /audit` (multipart : `session_id`, `linkedin`, `poste`, `questions`, `cv`) → confirmation HTML. Helper interne `sessionIsPaidAudit(env, sessionId) → Promise<{ok, email?}>`.

- [ ] **Step 1 : Implémenter `worker/audit.js`**

```js
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
```

- [ ] **Step 2 : Monter les routes dans `worker/index.js`**

```js
import { handleAuditForm, handleAuditSubmit } from './audit.js';
```
```js
  { method: 'GET', path: '/audit', handler: handleAuditForm },
  { method: 'POST', path: '/audit', handler: handleAuditSubmit },
```

- [ ] **Step 3 : Déployer et tester le refus**

Run: `npx wrangler deploy`
Run: `curl -s 'https://brevo-subscribe.mmossly.workers.dev/audit?session_id=cs_test_bidon123' | grep -o 'ce lien ne fonctionne pas'`
Expected: `ce lien ne fonctionne pas`

- [ ] **Step 4 : Test du chemin heureux**

Payer l'audit test (URL Task 3, carte `4242…`). Suivre la redirection vers `/audit?session_id=…`, remplir le formulaire avec un petit PDF.
Expected: page « C'est parti » + email reçu sur `NOTIFY_EMAIL` avec le CV en pièce jointe.

- [ ] **Step 5 : Commit**

```bash
git add worker/audit.js worker/index.js
git commit -m "feat(worker): formulaire audit post-paiement avec dépôt CV"
```

---

### Task 7: Pages statiques — offres.html, merci.html, cgv.html

**Files:**
- Create: `offres.html`
- Create: `merci.html`
- Create: `cgv.html`

**Interfaces:**
- Consumes: les deux URLs Payment Links test de `docs/superpowers/plans/stripe-links.md` (Task 3) — à coller dans les constantes `STRIPE_LINK_GUIDE` / `STRIPE_LINK_AUDIT` en tête du `<script>` d'`offres.html`.

- [ ] **Step 1 : Créer `offres.html`** — même univers qu'`index.html` (fond noir, halo or, grain). Structure complète :

```html
<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Le guide CV/ATS et l'audit personnalisé d'un recruteur en activité. Méthodes concrètes, côté coulisses.">
<title>Mes offres — Consultant Chronicles</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMwRDBEMEYiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgzMC43NywzNC42Nikgc2NhbGUoMC4yMDMzKSI+PHBhdGggZD0iTTMuMTAsNTUuMTYgQTcwLDcwIDAgMSAxIDMuMTAsLTU1LjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiNDOUEzNUEiIHN0cm9rZS13aWR0aD0iMjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgLz48cGF0aCBkPSJNODkuMTAsNTUuMTYgQTcwLDcwIDAgMSAxIDg5LjEwLC01NS4xNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjQzlBMzVBIiBzdHJva2Utd2lkdGg9IjI2IiBzdHJva2UtbGluZWNhcD0icm91bmQiIC8+PGxpbmUgeDE9Ijg5LjEwIiB5MT0iLTU1LjE2IiB4Mj0iMTA5LjkwIiB5Mj0iLTgwLjM0IiBzdHJva2U9IiNDOUEzNUEiIHN0cm9rZS13aWR0aD0iMjIuMzYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik0xMjcuMTAsLTEwMS4xNiBMMTIxLjQyLC03MS43MCBMOTkuMjQsLTkwLjAyIFoiIGZpbGw9IiNDOUEzNUEiLz48L2c+PC9zdmc+">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0d0d0f;--ink-2:#151517;--panel:#1b1b1e;--line:rgba(201,163,90,.22);
    --line-soft:rgba(236,234,227,.08);--gold:#c9a35a;--gold-bright:#e6cd8b;--cream:#ecebe3;
    --muted:#9c988c;--muted-2:#726f68;--radius:16px;--maxw:540px}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--cream);
    font-family:"Archivo",-apple-system,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
  .bg{position:fixed;inset:0;z-index:-1;pointer-events:none;background:
    radial-gradient(900px 520px at 50% -8%, rgba(201,163,90,.16), transparent 60%),
    linear-gradient(180deg,#0d0d0f 0%,#0b0b0d 55%,#0d0d0f 100%)}
  .wrap{max-width:var(--maxw);margin:0 auto;padding:38px 22px 56px}
  .back{display:inline-block;color:var(--muted);text-decoration:none;font-size:13px;margin-bottom:26px}
  .back:hover{color:var(--gold)}
  h1{font-family:"Fraunces";font-weight:500;font-size:clamp(30px,8.4vw,40px);line-height:1.1;margin:0 0 10px;text-align:center}
  h1 em{font-style:italic;color:var(--gold-bright)}
  .lede{color:var(--muted);font-size:15.5px;text-align:center;max-width:430px;margin:0 auto 34px}
  .offer{background:linear-gradient(180deg,var(--panel),var(--ink-2));border:1px solid var(--line);
    border-radius:var(--radius);padding:26px 22px;margin:0 0 22px}
  .pill{display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:1.8px;
    text-transform:uppercase;color:var(--gold);border:1px solid var(--line);padding:5px 11px;
    border-radius:999px;font-weight:600}
  .offer h2{font-family:"Fraunces";font-size:24px;font-weight:600;margin:14px 0 4px;line-height:1.15}
  .price{font-family:"Fraunces";font-size:30px;color:var(--gold-bright);margin:2px 0 12px}
  .price small{font-size:12px;color:var(--muted-2);font-family:"Archivo"}
  .offer p.desc{color:var(--muted);font-size:14.5px;margin:0 0 16px}
  ul.points{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:9px}
  ul.points li{display:flex;gap:11px;font-size:14px;color:#d6d4cb}
  ul.points li::before{content:"—";color:var(--gold);flex:0 0 auto}
  a.buy{display:flex;justify-content:center;background:linear-gradient(180deg,var(--gold-bright),var(--gold));
    color:#1a1408;font-weight:700;font-size:15.5px;padding:15px 18px;border-radius:12px;text-decoration:none;
    box-shadow:0 14px 30px -12px rgba(201,163,90,.6);transition:transform .15s}
  a.buy:hover{transform:translateY(-1px)}
  a.buy.ghost{background:none;color:var(--gold);border:1px solid var(--line);box-shadow:none}
  .cap{font-size:12px;color:var(--muted-2);text-align:center;margin:10px 0 0}
  .faq{margin:36px 0 0;border-top:1px solid var(--line-soft);padding-top:28px}
  .faq h3{font-family:"Fraunces";font-size:20px;margin:0 0 14px}
  .faq dt{font-weight:600;font-size:14.5px;margin:16px 0 4px}
  .faq dd{margin:0;color:var(--muted);font-size:14px}
  footer{margin:44px 0 0;text-align:center;font-size:11px;color:var(--muted-2)}
  footer a{color:var(--muted);text-decoration:none}
</style></head><body>
<div class="bg"></div>
<main class="wrap">
  <a class="back" href="/">← Retour</a>
  <h1>Passe de l'autre côté <em>de la table.</em></h1>
  <p class="lede">Deux façons d'utiliser l'œil d'un recruteur en activité pour ta propre candidature.</p>

  <!-- GUIDE -->
  <section class="offer">
    <span class="pill">PDF · Accès immédiat</span>
    <h2>Le CV qui passe — ATS &amp; recruteurs</h2>
    <p class="price">19 € <small>TTC — TVA non applicable, art. 293 B du CGI</small></p>
    <p class="desc">Le guide complet pour franchir les deux filtres qui éliminent 80% des CV : le robot, puis les 6 secondes de lecture humaine.</p>
    <ul class="points">
      <li>Comment un ATS lit réellement ton CV — et ce qui le fait planter.</li>
      <li>La structure exacte validée côté recruteur, rubrique par rubrique.</li>
      <li>Exemples avant/après commentés comme je le ferais en cabinet.</li>
      <li>La méthode mots-clés pour matcher une offre sans bourrage.</li>
    </ul>
    <a class="buy" id="buyGuide" href="#">Recevoir le guide — 19 €</a>
    <p class="cap">Paiement sécurisé Stripe · livré par email en 2 minutes.</p>
  </section>

  <!-- AUDIT -->
  <section class="offer">
    <span class="pill">Personnalisé · 5 places / semaine</span>
    <h2>Audit CV &amp; LinkedIn</h2>
    <p class="price">99 € <small>TTC — TVA non applicable, art. 293 B du CGI</small></p>
    <p class="desc">J'analyse ton CV et ton profil LinkedIn comme si tu étais candidat sur une de mes missions. Tu reçois un audit écrit, précis et actionnable, sous 72h ouvrées.</p>
    <ul class="points">
      <li>Lecture complète côté recruteur : fond, forme, cohérence du parcours.</li>
      <li>Ce qui te dessert aujourd'hui — dit franchement, avec la correction.</li>
      <li>Tes 3 questions prioritaires traitées en détail.</li>
      <li>Plan d'action concret, applicable le jour même.</li>
    </ul>
    <a class="buy ghost" id="buyAudit" href="#">Réserver mon audit — 99 €</a>
    <p class="cap">Après paiement, tu déposes ton CV et ton contexte en 2 minutes.</p>
  </section>

  <!-- FAQ -->
  <section class="faq">
    <h3>Questions fréquentes</h3>
    <dl>
      <dt>Sous quel format arrive le guide ?</dt>
      <dd>Un PDF envoyé par email juste après le paiement, lisible partout, à garder à vie.</dd>
      <dt>72h ouvrées pour l'audit, vraiment ?</dt>
      <dd>Oui. Le volume est limité à 5 audits par semaine précisément pour tenir ce délai avec un vrai niveau d'exigence.</dd>
      <dt>Et si ça ne me convient pas ?</dt>
      <dd>Écris-moi à contact@consultantchronicles.fr. Produit numérique livré = pas de rétractation légale (tu y renonces à l'achat), mais je ne laisse personne avec un achat inutile : on trouve une solution.</dd>
      <dt>Qui es-tu ?</dt>
      <dd>Un recruteur en activité — 5 ans en recrutement, 10 ans dans les métiers. Je publie mes méthodes sur TikTok @consultantchronicles.</dd>
    </dl>
  </section>

  <footer><a href="/cgv.html">CGV</a> · <a href="/#privacy">Confidentialité</a> · © <span id="yr"></span> Consultant Chronicles</footer>
</main>
<script>
  // URLs des Stripe Payment Links — coller ici celles notées dans docs/superpowers/plans/stripe-links.md
  const STRIPE_LINK_GUIDE = "COLLER_URL_TASK3";
  const STRIPE_LINK_AUDIT = "COLLER_URL_TASK3";
  document.getElementById('buyGuide').href = STRIPE_LINK_GUIDE;
  document.getElementById('buyAudit').href = STRIPE_LINK_AUDIT;
  document.getElementById('yr').textContent = new Date().getFullYear();
</script>
</body></html>
```

- [ ] **Step 2 : Coller les vraies URLs Stripe test** dans `STRIPE_LINK_GUIDE` / `STRIPE_LINK_AUDIT` (depuis `docs/superpowers/plans/stripe-links.md`). Vérifier qu'aucun `COLLER_URL_TASK3` ne subsiste : `grep -c COLLER_URL offres.html` → Expected: `0`.

- [ ] **Step 3 : Créer `merci.html`**

```html
<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Merci — Consultant Chronicles</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,400&family=Archivo:wght@400;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#0d0d0f;color:#ecebe3;font-family:Archivo,sans-serif;line-height:1.55;
    display:grid;place-items:center;min-height:100vh}
  .box{max-width:480px;padding:40px 24px;text-align:center}
  .badge{width:64px;height:64px;border-radius:50%;margin:0 auto 20px;display:grid;place-items:center;
    background:rgba(201,163,90,.12);border:1px solid rgba(201,163,90,.35);color:#c9a35a;font-size:26px}
  h1{font-family:Fraunces,serif;font-weight:500;font-size:30px;margin:0 0 12px}
  h1 em{font-style:italic;color:#e6cd8b}
  p{color:#9c988c;font-size:15px;margin:0 0 10px}
  a{color:#c9a35a;text-decoration:none}
</style></head><body>
<div class="box">
  <div class="badge">✓</div>
  <h1>Merci pour ta <em>confiance.</em></h1>
  <p>Ton guide arrive par email dans les prochaines minutes — vérifie tes spams si besoin, et ajoute contact@consultantchronicles.fr à tes contacts.</p>
  <p>Un souci ? Réponds directement à l'email de livraison.</p>
  <p style="margin-top:26px"><a href="/">← Retour à la page d'accueil</a></p>
</div>
</body></html>
```

- [ ] **Step 4 : Créer `cgv.html`** — CGV vente en ligne, micro-entreprise, produits numériques et prestation d'audit. Sections requises (rédigées en entier dans le fichier, ton sobre, pas de gras) :
1. Éditeur : « Consultant Chronicles — [Prénom NOM], entrepreneur individuel. SIRET : [en cours d'immatriculation] » — champ SIRET complété à l'activation (étape go-live, Task 10).
2. Offres et prix : guide 19 € TTC, audit 99 € TTC, TVA non applicable art. 293 B du CGI.
3. Commande et paiement : via Stripe, exécution immédiate après confirmation.
4. Livraison : guide = lien de téléchargement par email (validité 7 jours, renouvelable sur demande) ; audit = livrable écrit par email sous 72h ouvrées après réception du dossier complet.
5. Droit de rétractation : contenu numérique fourni immédiatement — le client renonce expressément à son droit de rétractation au moment du paiement (art. L221-28 du Code de la consommation) ; pour l'audit, rétractation possible tant que la prestation n'a pas commencé.
6. Données personnelles : email utilisé pour la livraison et le suivi client ; CV et documents d'audit supprimés après livraison ; contact et désinscription à contact@consultantchronicles.fr.
7. Litiges : droit français, médiation de la consommation.
Style : même base CSS que `merci.html` (fond noir, Fraunces pour les titres), contenu dans un `.wrap{max-width:640px;margin:0 auto;padding:48px 22px}` en texte simple `<h2>`/`<p>`.

- [ ] **Step 5 : Vérification locale**

Run: `python3 -m http.server 8899` puis ouvrir `http://localhost:8899/offres.html`, `merci.html`, `cgv.html`.
Expected: cohérence visuelle avec `index.html` (fond noir, or, typos), boutons pointant vers `buy.stripe.com/test_…`, aucun lien mort entre les trois pages.

- [ ] **Step 6 : Commit**

```bash
git add offres.html merci.html cgv.html
git commit -m "feat(pages): offres, merci et CGV — mini-boutique statique"
```

---

### Task 8: Intégrer la boutique à la page bio

**Files:**
- Modify: `index.html` (après la section `<!-- OFFER + FORM -->`, avant `<!-- VALUE -->`)

**Interfaces:**
- Consumes: `offres.html` (Task 7).

- [ ] **Step 1 : Insérer le bloc « Mes offres »** dans `index.html`, juste après la `</section>` de la carte checklist (ligne ~235), avec la classe d'animation existante `rise d4` (et décaler `d4→d5`, `d5→d6` sur les sections suivantes pour garder la cascade) :

```html
  <!-- OFFRES PAYANTES -->
  <section class="rise d4" style="margin:14px 0 0">
    <a href="/offres.html" style="display:flex;align-items:center;justify-content:space-between;gap:12px;
      background:none;border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;
      color:var(--cream);text-decoration:none;transition:border-color .2s">
      <span>
        <span style="display:block;font-family:'Fraunces';font-size:17px;font-weight:600">Mes offres</span>
        <span style="display:block;font-size:13px;color:var(--muted)">Guide CV/ATS (19 €) · Audit CV &amp; LinkedIn (99 €)</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a35a" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </section>
```

- [ ] **Step 2 : Mettre à jour le footer d'`index.html`** — remplacer `<a href="#mentions">Mentions légales</a>` par `<a href="/cgv.html">CGV</a> · <a href="#mentions">Mentions légales</a>`.

- [ ] **Step 3 : Vérification locale**

Run: `python3 -m http.server 8899` → `http://localhost:8899/index.html`
Expected: le bloc « Mes offres » apparaît entre la checklist et la bande valeur, l'animation en cascade reste fluide, le formulaire checklist fonctionne (soumission → succès).

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat(bio): lien Mes offres vers la boutique + lien CGV"
```

---

### Task 9: Contenu du guide (co-écriture avec Moss — interactif)

Cette tâche ne se sous-traite pas à un subagent : le guide vend l'expérience réelle de Moss. Travail en session avec lui.

**Files:**
- Create: `_scripts/guide/plan-guide.md` (hors git, dossier `_scripts/` gitignoré)
- Create: `assets-private/guide-cv-ats.pdf` (version finale, remplace le placeholder)

**Interfaces:**
- Produces: PDF final ~30-40 pages nommé exactement `guide-cv-ats.pdf` (le nom est câblé dans `worker/download.js`).

- [ ] **Step 1 : Écrire le plan détaillé du guide** dans `_scripts/guide/plan-guide.md` — structure cible (à valider avec Moss avant rédaction) :
1. Pourquoi 80% des CV meurent avant lecture humaine (le parcours réel d'un CV en cabinet).
2. L'ATS décortiqué : ce qu'il lit, ce qu'il casse (colonnes, tableaux, images, PDF exotiques).
3. La structure qui passe : rubrique par rubrique, avec l'ordre et les intitulés exacts.
4. Les 6 secondes du recruteur : eye-tracking de ma propre lecture, ce que je regarde en premier.
5. Avant/après n°1 : profil junior (CV réel anonymisé ou reconstitué, commenté ligne à ligne).
6. Avant/après n°2 : profil confirmé en reconversion.
7. La méthode mots-clés : matcher l'offre sans bourrage, avec exemple concret offre → CV.
8. Checklist finale d'envoi (reprend et prolonge la checklist gratuite).
- [ ] **Step 2 : Rédiger avec Moss** section par section (ses anecdotes, ses exemples réels anonymisés — jamais de données Michael Page).
- [ ] **Step 3 : Mise en page PDF** : HTML print (charte : crème `#ECEBE3` en fond de page, encre noire, titres Fraunces, accents or) → impression PDF via Chrome. Gabarit dans `_scripts/guide/guide-print.html`.
- [ ] **Step 4 : Exporter vers `assets-private/guide-cv-ats.pdf`**, vérifier `git status` (le PDF ne doit PAS apparaître), puis `npx wrangler deploy`.
- [ ] **Step 5 : Test réel** : repayer le guide en mode test, vérifier que l'email livre bien le PDF final.
- [ ] **Step 6 : Commit** (seulement si le gabarit print a vocation à être versionné — sinon rien à commiter, tout est hors git) :

```bash
git status   # confirmer qu'aucun fichier du guide n'est suivi
```

---

### Task 10: Recette bout-en-bout + push + checklist d'activation

**Files:**
- Create: `docs/A-FAIRE-activation-boutique.md`

- [ ] **Step 1 : Recette complète en mode test (funnel guide)**
1. `https://consultantchronicles.fr/` → clic « Mes offres » → `offres.html` → bouton guide → paiement carte `4242…`.
2. Expected: redirection `merci.html` ; email reçu < 2 min ; lien → PDF téléchargé ; contact présent dans la liste Brevo « Clients ».

- [ ] **Step 2 : Recette complète (funnel audit)**
1. `offres.html` → bouton audit → paiement test → redirection formulaire → dépôt d'un PDF.
2. Expected: page « C'est parti » ; email à `NOTIFY_EMAIL` avec pièce jointe ; contact dans la liste « Clients ».

- [ ] **Step 3 : Contrôles négatifs**
- `curl -sI 'https://brevo-subscribe.mmossly.workers.dev/guide-cv-ats.pdf'` → `404`
- Lien de téléchargement modifié (changer un caractère de `sig`) → `403`
- `/audit?session_id=cs_test_bidon` → page de refus
- Formulaire checklist de la bio → toujours `{"success":true}`

- [ ] **Step 4 : Écrire `docs/A-FAIRE-activation-boutique.md`** — actions à la réception du SIRET, dans l'ordre :
1. Activer le compte Stripe live (infos entreprise + SIRET + IBAN).
2. Recréer produits + Payment Links + webhook en mode **live** (mêmes réglages que Task 3) ; mettre à jour `offres.html` (2 URLs) et les secrets `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (`npx wrangler secret put` + `npx wrangler deploy`).
3. Compléter `cgv.html` (SIRET réel) et les mentions légales d'`index.html`.
4. Paiement réel de 19 € pour valider le funnel live (remboursable depuis Stripe).
5. Ajouter le CTA `/offres` aux descriptions TikTok (EP02-EP05).

- [ ] **Step 5 : Push de l'ensemble**

Run: `git add docs/A-FAIRE-activation-boutique.md && git commit -m "docs: checklist d'activation boutique (post-SIRET)" && git push origin main`
Expected: GitHub Pages redéploie ; vérifier `https://consultantchronicles.fr/offres.html` en ligne.

- [ ] **Step 6 : Mettre à jour la mémoire projet** (`consultant-chronicles-project.md`) : boutique construite, en mode test, en attente SIRET ; clé Brevo tournée (fuite 16/06 close si Step Task 1.7 fait) ; renvoyer vers `docs/A-FAIRE-activation-boutique.md`.
