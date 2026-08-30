'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const BASE_URL = String(process.env.KIWOOM_US_BASE_URL || '').replace(/\/$/, '');
const APP_KEY = process.env.KIWOOM_US_APP_KEY;
const SECRET_KEY = process.env.KIWOOM_US_SECRET_KEY;
const MODE = String(process.env.TRADING_MODE || '').toUpperCase();
const TOKEN_FILE = path.join(__dirname, 'token.txt');

const MIN_REMAINING_MS = 12 * 60 * 60 * 1000;
const REVOKE_SETTLE_MS = 2000;
const FALLBACK_EXPIRY_BUFFER_MS = 5000;
const MAX_FALLBACK_WAIT_MS = 2 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseKiwoomExpiry(value) {
  const text = String(value || '').trim();
  if (!/^\d{14}$/.test(text)) {
    throw new Error('Invalid expires_dt format');
  }

  const iso =
    text.slice(0, 4) + '-' +
    text.slice(4, 6) + '-' +
    text.slice(6, 8) + 'T' +
    text.slice(8, 10) + ':' +
    text.slice(10, 12) + ':' +
    text.slice(12, 14) + '+09:00';

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Unable to parse expires_dt');
  }

  return timestamp;
}

function remainingMs(expiresDt) {
  return parseKiwoomExpiry(expiresDt) - Date.now();
}

async function issueToken() {
  const response = await fetch(BASE_URL + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: APP_KEY,
      secretkey: SECRET_KEY
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Token issuance response is not valid JSON');
  }

  if (!response.ok || !data.token || !data.expires_dt || Number(data.return_code ?? 0) !== 0) {
    throw new Error('Token issuance failed: ' + (data.return_msg || data.message || response.status));
  }

  return data;
}

async function revokeToken(token) {
  const response = await fetch(BASE_URL + '/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      appkey: APP_KEY,
      secretkey: SECRET_KEY,
      token
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Token revoke response is not valid JSON');
  }

  if (!response.ok || Number(data.return_code ?? -1) !== 0) {
    throw new Error('Token revoke failed: ' + (data.return_msg || data.message || response.status));
  }
}

function saveToken(token) {
  const tempFile = TOKEN_FILE + '.tmp';
  fs.writeFileSync(tempFile, token + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tempFile, 0o600); } catch {}
  fs.renameSync(tempFile, TOKEN_FILE);
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

async function issueFreshAfterRevoke() {
  await sleep(REVOKE_SETTLE_MS);

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const data = await issueToken();
      const left = remainingMs(data.expires_dt);
      if (left >= MIN_REMAINING_MS) return data;
      lastError = new Error('Fresh token still has insufficient remaining lifetime');
    } catch (err) {
      lastError = err;
    }

    if (attempt < 5) await sleep(3000);
  }

  throw lastError || new Error('Fresh token issuance failed after revoke');
}

async function obtainSafeToken() {
  let data = await issueToken();
  let left = remainingMs(data.expires_dt);

  if (left >= MIN_REMAINING_MS) {
    return data;
  }

  console.log('Near-expiry token received; safe refresh required');
  console.log('remaining_minutes:', Math.max(0, Math.floor(left / 60000)));

  try {
    await revokeToken(data.token);
  } catch (revokeError) {
    left = remainingMs(data.expires_dt);

    if (left > 0 && left <= MAX_FALLBACK_WAIT_MS) {
      const waitMs = left + FALLBACK_EXPIRY_BUFFER_MS;
      console.log('Immediate refresh unavailable; waiting for current token expiry');
      console.log('wait_seconds:', Math.ceil(waitMs / 1000));
      await sleep(waitMs);

      data = await issueToken();
      left = remainingMs(data.expires_dt);
      if (left >= MIN_REMAINING_MS) return data;
    }

    throw new Error('Unable to obtain safely valid token: ' + revokeError.message);
  }

  return issueFreshAfterRevoke();
}

async function main() {
  if (MODE !== 'PAPER') throw new Error('SY Quant US token issuance requires PAPER mode');
  if (BASE_URL !== 'https://mockapi.kiwoom.com') throw new Error('Unexpected Kiwoom US PAPER API URL');
  if (!APP_KEY || !SECRET_KEY) throw new Error('Missing Kiwoom US App Key or App Secret');

  const data = await obtainSafeToken();
  const left = remainingMs(data.expires_dt);

  if (left < MIN_REMAINING_MS) {
    throw new Error('Token lifetime safety check failed');
  }

  saveToken(data.token);

  console.log('SY Quant US PAPER token ready');
  console.log('expires_dt:', data.expires_dt);
  console.log('remaining_hours:', (left / 3600000).toFixed(2));
  console.log('token saved:', TOKEN_FILE);
}

main().catch(err => {
  console.error('SY Quant US token error:', err.message);
  process.exit(1);
});
