# Monétisation B2C — Consultant Chronicles

Design validé le 17/07/2026. Contexte stratégique : la monétisation B2C (candidats/particuliers)
vit sur Consultant Chronicles, pas sur Ihsan Partners — le B2B executive search reste dormant
jusqu'au départ de Moss de Michael Page (voir mémoire projet `ihsan-partners-project`).

## Objectif

Transformer la page lien-en-bio (`consultantchronicles.fr`, repo `MossAbid/bio`,
GitHub Pages + Cloudflare Worker + Brevo) en mini-boutique à deux produits,
prête à encaisser dès réception du SIRET micro-entreprise (démarche en cours côté Moss).

## L'offre au lancement

Deux produits, exclusivement côté candidat (jamais côté entreprise — frontière avec
l'activité salariée chez Page) :

1. **Guide CV/ATS — 19 € TTC.** PDF ~30-40 pages, angle « ce que voit vraiment le
   recruteur » : comment un ATS traite le CV, les 6 secondes de lecture humaine,
   exemples avant/après commentés côté recruteur. Suite payante de la checklist
   gratuite existante (lead magnet inchangé). Prolonge l'épisode TikTok EP01.
2. **Audit CV/LinkedIn — 99 € TTC.** Asynchrone, rendu sous 72h ouvrées, format
   écrit structuré (option mémo audio à trancher à la production). Volume affiché
   limité (« 5 places par semaine ») pour protéger le temps de Moss et créer la rareté.

Ateliers/formations : hors périmètre, mentionnés nulle part pour l'instant.

## Architecture retenue (approche A)

Étendre la stack existante — aucun nouveau service payant, aucune nouvelle codebase :

- **Pages statiques** (GitHub Pages, charte noir `#0D0D0F` / or `#C9A35A`,
  Fraunces + Archivo) :
  - `offres.html` — une section par produit : promesse, contenu détaillé, prix,
    bouton d'achat (Stripe Payment Link), FAQ courte (formats, délais, remboursement).
  - `merci.html` — page de remerciement post-paiement (redirection Stripe).
  - `cgv.html` — CGV vente en ligne (voir Légal).
  - `index.html` — ajout d'un lien proéminent « Mes offres » au-dessus des liens
    existants ; mentions légales complétées (SIRET, hébergeur) à l'activation.
- **Paiement** : deux Stripe Payment Links (guide, audit), créés en mode test
  pendant le build, basculés en production à la réception du SIRET.
- **Livraison du guide** : webhook Stripe `checkout.session.completed` → nouvelle
  route sur le Worker Cloudflare existant (`worker.js`) → email transactionnel
  Brevo contenant le lien de téléchargement + ajout du client à une liste Brevo
  « clients » (distincte de la liste prospects #2). Le PDF est servi par le Worker
  via un lien à jeton signé et expirant — jamais commité dans le repo public
  (stockage : R2 ou asset privé du Worker, à fixer au plan d'implémentation).
- **Flux audit** : après paiement, redirection vers un formulaire servi par le
  Worker : dépôt du CV + lien LinkedIn + contexte (poste visé, 3 questions max).
  Notification email à Moss avec le dossier complet ; livraison manuelle par email
  sous 72h. Aucune automatisation de l'analyse (c'est l'œil du recruteur qu'on
  vend ; évite tout sujet IA/données).

## Légal — bloquant pour l'activation, pas pour le build

- **SIRET requis avant le premier encaissement** (création du compte Stripe incluse).
  Immatriculation micro-entreprise : action Moss, en parallèle du build.
- Franchise de TVA : prix affichés « TTC — TVA non applicable, art. 293 B du CGI ».
- CGV : produit numérique = renonciation expresse au droit de rétractation au moment
  de l'achat (case à cocher côté Stripe), délais de l'audit, politique de remboursement.
- Ne jamais utiliser de données ou candidats issus de Michael Page. Rappel : Claude
  n'est pas juriste ; la compatibilité fine avec le contrat de travail de Moss
  (exclusivité, non-concurrence) n'a pas été vérifiée.

## Séquencement

1. **Build (maintenant)** : rédaction du guide (le plus gros du travail, co-écrit
   avec Moss), `offres.html`, `merci.html`, `cgv.html`, route webhook Worker,
   formulaire audit, Stripe en mode test.
2. **Activation (à réception du SIRET)** : compte Stripe activé, Payment Links en
   production, mentions légales complétées, mise en ligne.
3. **Lancement** : les épisodes TikTok en pipeline (EP02-EP05) intègrent un CTA
   vers `consultantchronicles.fr/offres`.

## Critères de succès

- Funnel achat guide fonctionnel de bout en bout (paiement test → email Brevo
  avec le PDF) avant l'activation.
- Funnel audit fonctionnel (paiement test → formulaire → notification à Moss).
- Aucun fichier payant accessible publiquement sans achat.
- Pages conformes à la charte graphique existante de Consultant Chronicles.
