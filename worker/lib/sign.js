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
