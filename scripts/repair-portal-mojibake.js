'use strict';

const fs = require('fs');
const path = require('path');

const files = [
  'public/admin.html',
  'public/js/client-detail-data.js',
  'public/js/client-detail-exports.js',
  'public/js/client-detail-tabs-primary.js',
  'public/js/client-detail-tabs-secondary.js',
  'public/js/client-detail-tabs-tertiary.js'
];

const replacements = [
  ['\u00c3\u0161', 'Ú'],
  ['\u00c3\u2014', '×'],
  ['\u00c3\u2030', 'É'],
  ['\u00e2\u20ac\u201d', '—'],
  ['\u00e2\u20ac\u201c', '–'],
  ['\u00e2\u20ac\u00a2', '•'],
  ['\u00e2\u20ac\u00a6', '…'],
  ['\u00e2\u2020\u0090', '←'],
  ['\u00e2\u2020\u2019', '→'],
  ['\u00e2\u0153\u008f\u00ef\u00b8\u008f', '✏️'],
  ['\u00e2\u0161\u2122\u00ef\u00b8\u008f', '⚙️'],
  ['\u00e2\u0153\u2026', '✅'],
  ['\u00e2\u009d\u0152', '❌'],
  ['\u00e2\u2020\u2022\u00ef\u00b8\u008f', '↕️'],
  ['\u00f0\u0178\u2018\u00a5', '👥'],
  ['\u00f0\u0178\u2018\u02c6', '👇'],
  ['\u00f0\u0178\u201c\u00a5', '📥'],
  ['\u00f0\u0178\u201c\u0160', '📊'],
  ['\u00f0\u0178\u201c\u2039', '📋'],
  ['\u00f0\u0178\u201d\u20ac', '🔀'],
  ['\u00f0\u0178\u201c\u00a6', '📆'],
  ['\u00f0\u0178\u0178\u00a2', '🏢'],
  ['\u00f0\u0178\u2018\u00a4', '👤'],
  ['\u00f0\u0178\u201c\u0081', '📁'],
  ['\u00f0\u0178\u201c\u201e', '📄'],
  ['\u00e2\u20ac\u201c', '─']
];

function repairFile(filePath) {
  const absPath = path.resolve(filePath);
  let text = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '');

  // First pass: recover plain Latin-1 mojibake substrings.
  text = text.replace(
    /(?:[\u00C2\u00C3][\u0080-\u00FF]|[\u00E2\u00F0][\u0080-\uFFFF]{1,3})+/g,
    (match) => {
      try {
        return Buffer.from(match, 'latin1').toString('utf8');
      } catch {
        return match;
      }
    }
  );

  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }

  fs.writeFileSync(absPath, text, 'utf8');
}

for (const file of files) {
  repairFile(file);
  console.log(`repaired ${file}`);
}
