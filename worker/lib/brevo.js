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
