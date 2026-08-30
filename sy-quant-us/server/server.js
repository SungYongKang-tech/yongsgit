'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MODE = String(process.env.TRADING_MODE || 'PAPER').toUpperCase();

if (PORT === 3000) {
  throw new Error('SY Quant US must not use KR port 3000');
}

if (MODE !== 'PAPER') {
  throw new Error('SY Quant US initial mode must be PAPER');
}

app.use(cors());
app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    server: 'sy-quant-us',
    mode: MODE,
    port: PORT,
    file: __filename,
    cwd: process.cwd(),
    time: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('SY Quant US PAPER server listening on port ' + PORT);
});
