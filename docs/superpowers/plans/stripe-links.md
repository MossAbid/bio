# Stripe Payment Links — mode TEST

Créés le 19/07/2026 (dashboard Stripe, mode test — à recréer en mode live à la
réception du SIRET, voir docs/A-FAIRE-activation-boutique.md à la Task 10).

| Produit | Prix | metadata.product | URL |
|---|---|---|---|
| Guide CV/ATS | 19 € TTC | `guide` | https://buy.stripe.com/test_14A28reDT2GL9EMbzFgA800 |
| Audit CV/LinkedIn | 99 € TTC | `audit` | https://buy.stripe.com/test_eVq7sLdzP5SXcQY1Z5gA801 |

Redirections post-paiement :
- Guide → `https://consultantchronicles.fr/merci.html`
- Audit → `https://brevo-subscribe.mmossly.workers.dev/audit?session_id={CHECKOUT_SESSION_ID}`

Webhook : `https://brevo-subscribe.mmossly.workers.dev/stripe-webhook`,
événement `checkout.session.completed` uniquement.
