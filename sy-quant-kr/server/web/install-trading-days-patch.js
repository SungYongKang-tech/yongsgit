'use strict';

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'performance.html');
const scriptTag = '    <script src="./performance-trading-days.js?v=20260831-trading-days-v1"></script>';

if (!fs.existsSync(htmlPath)) {
  throw new Error(`performance.html not found: ${htmlPath}`);
}

let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/최근 7일 전략별 실현손익/g, '최근 7거래일 전략별 실현손익');

if (!html.includes('performance-trading-days.js')) {
  const marker = /([ \t]*<script src="\.\/performance\.js\?v=[^"]+"><\/script>)/;
  if (!marker.test(html)) {
    throw new Error('performance.js script tag not found');
  }
  html = html.replace(marker, `$1\n${scriptTag}`);
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('[KR 대시보드] 최근 7거래일 패치 적용 완료');
