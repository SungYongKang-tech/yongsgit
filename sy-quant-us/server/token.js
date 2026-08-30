'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const BASE_URL = String(process.env.KIWOOM_US_BASE_URL || '').replace(/\/$/, '');
const APP_KEY = process.env.KIWOOM_US_APP_KEY;
const SECRET_KEY = process.env.KIWOOM_US_SECRET_KEY;
const MODE = String(process.env.TRADING_MODE || '').toUpperCase();
const TOKEN_FILE = path.join(__dirname, 'token.txt');

async function main() {
  if (MODE !== 'PAPER') throw new Error('SY Quant US token issuance requires PAPER mode');
  if (BASE_URL !== 'https://mockapi.kiwoom.com') throw new Error('Unexpected Kiwoom US PAPER API URL');
  if (!APP_KEY || !SECRET_KEY) throw new Error('Missing Kiwoom US App Key or App Secret');

  const response = await fetch(BASE_URL + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: APP_KEY,
      secretkey: SECRET_KEY
    })
  });

  const data = await response.json();

  if (!response.ok || !data.token) {
    throw new Error('Token issuance failed: ' + (data.return_msg || data.message || response.status));
  }

  fs.writeFileSync(TOKEN_FILE, data.token + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}

  console.log('SY Quant US PAPER token issued successfully');
  console.log('expires_dt:', data.expires_dt || '(unknown)');
  console.log('token saved:', TOKEN_FILE);
}

main().catch(err => {
  console.error('SY Quant US token error:', err.message);
  process.exit(1);
});
