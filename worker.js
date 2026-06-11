export default {
  async fetch(request) {

    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Répondre au preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    try {
      const { email, prenom } = await request.json();

      if (!email) {
        return new Response(JSON.stringify({ error: 'Email requis' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      const payload = {
        email,
        listIds: [2],
        updateEnabled: true,
        ...(prenom && { attributes: { PRENOM: prenom } })
      };

      const brevo = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: {
          'api-key': '***BREVO_KEY_REVOKED***',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = brevo.ok ? { success: true } : await brevo.json();

      // 400 duplicate = déjà inscrit → on affiche succès quand même
      if (!brevo.ok && data?.code !== 'duplicate_parameter') {
        return new Response(JSON.stringify(data), {
          status: brevo.status, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }
};
