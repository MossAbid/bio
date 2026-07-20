import { CORS, handleSubscribe } from './subscribe.js';
import { handleStripeWebhook } from './stripe-webhook.js';
import { handleDownload } from './download.js';
import { handleAuditForm, handleAuditSubmit } from './audit.js';

const routes = [
  { method: 'POST', path: '/', handler: handleSubscribe },
  { method: 'POST', path: '/stripe-webhook', handler: handleStripeWebhook },
  { method: 'GET', path: '/download', handler: handleDownload },
  { method: 'GET', path: '/audit', handler: handleAuditForm },
  { method: 'POST', path: '/audit', handler: handleAuditSubmit },
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
