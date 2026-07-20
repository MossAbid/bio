import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStripeSignature } from '../worker/stripe-webhook.js';
import { hmacHex } from '../worker/lib/sign.js';

test('valid signature passes, wrong secret fails, old timestamp fails', async () => {
  const payload = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = await hmacHex('whsec_x', `${t}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_x'), true);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_y'), false);
  const old = t - 3600;
  const v1old = await hmacHex('whsec_x', `${old}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${old},v1=${v1old}`, 'whsec_x'), false);
});
