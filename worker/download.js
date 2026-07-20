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
