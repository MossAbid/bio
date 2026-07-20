# À faire — Activation de la boutique (post-SIRET)

La boutique (Guide CV/ATS 19 € + Audit CV & LinkedIn 99 €) est construite et validée
de bout en bout **en mode test Stripe**. Tant que le SIRET n'est pas là, tout reste en
test : aucun paiement réel n'est possible, et c'est voulu. Voici, dans l'ordre, ce qu'il
reste à faire une fois le statut d'entrepreneur individuel officialisé.

## 1. Activer le compte Stripe en mode live
Dans le dashboard Stripe : renseigner les informations de l'entreprise (SIRET, adresse,
IBAN pour les virements). Stripe demande une validation d'identité — prévoir quelques
jours de délai possible.

## 2. Recréer produits + Payment Links + webhook en mode **live**
Refaire exactement ce qui a été fait en mode test (Task 3) :
- 2 produits : Guide 19 € (metadata `product=guide`) et Audit 99 € (metadata `product=audit`)
- 2 Payment Links, avec les mêmes redirections qu'en test :
  - Guide → `https://consultantchronicles.fr/merci.html`
  - Audit → `https://brevo-subscribe.mmossly.workers.dev/audit?session_id={CHECKOUT_SESSION_ID}`
- Un webhook live sur `checkout.session.completed`, pointant vers
  `https://brevo-subscribe.mmossly.workers.dev/stripe-webhook`
- Les metadata `product` ne sont pas éditables dans le dashboard Payment Links —
  passer par le Shell Workbench Stripe (`stripe payment_links update plink_... -d
  "metadata[product]=guide"`), comme en Task 3.

Puis :
```bash
# Remplacer les 2 URLs test dans offres.html par les 2 nouvelles URLs live
# (const STRIPE_LINK_GUIDE / STRIPE_LINK_AUDIT)

npx wrangler secret put STRIPE_SECRET_KEY        # clé secrète live (sk_live_...)
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # secret du nouveau webhook live
npx wrangler deploy
```

⚠️ Les secrets `wrangler secret put` lisent une entrée masquée — vérifier que les
caractères s'affichent bien avant de valider (un collage raté a stocké un secret vide
deux fois pendant le développement, causant une erreur 500 silencieuse sur le webhook).

## 3. Compléter les mentions légales
- `cgv.html` : remplacer `[Prénom NOM]` et `[en cours d'immatriculation]` par l'identité
  réelle et le SIRET définitif (section 1, « Éditeur »).
- `index.html` : compléter la section mentions légales (`#mentions`) avec les mêmes
  informations si elle contient encore des placeholders.

## 4. Paiement réel de validation
Effectuer un vrai paiement de 19 € (le guide) pour confirmer que le funnel live
fonctionne de bout en bout — webhook, email, téléchargement. Le paiement est
remboursable directement depuis le dashboard Stripe une fois vérifié.

## 5. Ajouter le CTA boutique aux vidéos TikTok
Ajouter un lien ou une mention vers `/offres.html` dans les descriptions des épisodes
à venir (EP02 à EP05, cf. pipeline dans `CLAUDE.md`) une fois le funnel confirmé en live.

## 6. Autres rappels
- Le compte Stripe reste en mode test tant que le SIRET n'est pas confirmé — pas de
  bascule live sans l'accord explicite de Moss, même les clés en main.
- La clé Brevo qui avait fuité dans un ancien résumé de conversation (voir `CLAUDE.md`,
  section Sécurité) doit être vérifiée comme révoquée si ce n'est pas déjà confirmé.
- L'expéditeur transactionnel Brevo tombe actuellement en fallback sur
  `contact@11398975.brevosend.com` au lieu de `contact@consultantchronicles.fr` —
  valider le domaine d'expéditeur dans Brevo avant le lancement réel, sinon les emails
  de livraison du guide risquent d'atterrir en spam.
