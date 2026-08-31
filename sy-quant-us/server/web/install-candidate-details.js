'use strict';

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'performance.html');
if (!fs.existsSync(htmlPath)) {
  throw new Error(`performance.html not found: ${htmlPath}`);
}

let html = fs.readFileSync(htmlPath, 'utf8');
const tag = '  <script src="/us-performance-candidate-details.js?v=20260831-candidate-v1"></script>';

if (!html.includes('us-performance-candidate-details.js')) {
  const performanceScriptRegex = /\s*<script\s+src="\/us-performance\.js\?v=[^"]+"><\/script>/i;
  const match = html.match(performanceScriptRegex);
  if (match) {
    html = html.replace(match[0], `${match[0]}\n${tag}`);
  } else if (html.includes('</body>')) {
    html = html.replace('</body>', `${tag}\n</body>`);
  } else {
    throw new Error('performance script or </body> not found');
  }
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('[US 대시보드] 후보 상세 표시 패치 적용 완료');
