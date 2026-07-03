#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'public');
const files = fs.readdirSync(publicDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

for (const file of files) {
  const filePath = path.join(publicDir, file);
  const html = fs.readFileSync(filePath, 'utf8');
  const scripts = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  let index = 0;

  for (const match of scripts) {
    index += 1;

    try {
      new Function(match[1]);
    } catch (err) {
      err.message = `${file} inline script ${index}: ${err.message}`;
      throw err;
    }
  }
}

console.log(`Checked ${files.length} HTML files.`);
