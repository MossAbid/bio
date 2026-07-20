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
