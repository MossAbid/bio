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
