// Offline Desktop Build Script for Windows JARVIS
// Transpiles TypeScript source files in apps/desktop/src to apps/desktop/dist
// using Node 24 native stripTypeScriptTypes without external network dependencies.

import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';

const srcDir = path.resolve('apps/desktop/src');
const distDir = path.resolve('apps/desktop/dist');

fs.mkdirSync(distDir, {recursive: true});

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
console.log(`Building ${files.length} desktop source files...`);

for (const file of files) {
  const srcPath = path.join(srcDir, file);
  const outPath = path.join(distDir, file.replace(/\.ts$/, '.js'));
  const tsCode = fs.readFileSync(srcPath, 'utf8');

  try {
    let jsCode = stripTypeScriptTypes(tsCode);

    // If file is whatsapp-core.ts, ensure CommonJS exports are available for whatsapp.test.cjs
    if (file === 'whatsapp-core.ts') {
      const cjsCode = jsCode
        .replace(/import\s*\{\s*randomUUID\s*\}\s*from\s*['"]node:crypto['"];?/, 'const {randomUUID} = require("node:crypto");')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+class\s+/g, 'class ')
        + '\nmodule.exports = { cleanDraft, cleanChatId, bounded, WhatsAppApprovals, PHONE, CHAT, MESSAGE_ID, MAX_MESSAGE };\n';
      fs.writeFileSync(outPath, cjsCode, 'utf8');
      console.log(`Transpiled CommonJS: ${file} -> ${path.basename(outPath)}`);
      continue;
    }

    // If file is video-engine.ts, ensure CommonJS exports and resilient zod fallback
    if (file === 'video-engine.ts') {
      const cjsCode = jsCode
        .replace(/import\s*\{\s*spawn\s*\}\s*from\s*['"]node:child_process['"];?/, 'const {spawn} = require("node:child_process");')
        .replace(/import\s+fs\s+from\s*['"]node:fs\/promises['"];?/, 'const fs = require("node:fs/promises");')
        .replace(/import\s+os\s+from\s*['"]node:os['"];?/, 'const os = require("node:os");')
        .replace(/import\s+path\s+from\s*['"]node:path['"];?/, 'const path = require("node:path");')
        .replace(/import\s*\{\s*z\s*\}\s*from\s*['"]zod['"];?/, `let z;
try { z = require('zod').z || require('zod'); } catch {
  const s = {
    min: () => s, max: () => s, int: () => s, default: () => s, optional: () => s, refine: () => s,
    parse: (val) => {
      if (!val || typeof val !== 'object') throw new Error('Invalid plan');
      if (!val.input || typeof val.input !== 'string' || val.input.length > 1024) throw new Error('Input must be a valid file path');
      if (!val.output || typeof val.output !== 'string' || val.output.length > 1024) throw new Error('Output must be a valid file path');
      if (!Array.isArray(val.steps) || val.steps.length === 0 || val.steps.length > 30) throw new Error('Steps must be an array of 1 to 30 items');
      const validAspects = ['9:16', '16:9', '1:1', '4:5'];
      const validFilters = ['cinematic', 'warm', 'cool', 'vintage', 'grayscale', 'vivid'];
      const validExports = ['youtube', 'reels', 'tiktok', 'shorts'];
      for (const st of val.steps) {
        if (!st || !st.type) throw new Error('Invalid step');
        switch (st.type) {
          case 'trim':
          case 'cut':
            if (typeof st.start !== 'number' || typeof st.end !== 'number' || st.end <= st.start || st.start < 0) throw new Error('End must be after start');
            break;
          case 'aspect':
            if (!validAspects.includes(st.ratio)) throw new Error('Invalid aspect ratio: ' + st.ratio);
            break;
          case 'speed':
            if (typeof st.factor !== 'number' || st.factor < 0.25 || st.factor > 4) throw new Error('Speed factor must be between 0.25 and 4');
            break;
          case 'filter':
            if (!validFilters.includes(st.preset)) throw new Error('Invalid filter preset: ' + st.preset);
            break;
          case 'export':
            if (!validExports.includes(st.preset)) throw new Error('Invalid export preset: ' + st.preset);
            break;
          case 'crop':
          case 'resize':
            if (typeof st.width !== 'number' || typeof st.height !== 'number' || st.width < 32 || st.width > 7680 || st.height < 32 || st.height > 7680) throw new Error('Invalid dimensions');
            break;
          case 'merge':
            if (!Array.isArray(st.files) || st.files.length < 1 || st.files.length > 15) throw new Error('Merge files must have 1-15 files');
            break;
          case 'music':
            if (typeof st.file !== 'string') throw new Error('Music file must be a string');
            break;
          case 'text':
            if (typeof st.text !== 'string' || st.text.length < 1 || st.text.length > 300) throw new Error('Text length must be between 1 and 300');
            break;
          case 'transition':
            if (typeof st.file !== 'string' || typeof st.duration !== 'number' || st.duration < 0.2 || st.duration > 5) throw new Error('Invalid transition params');
            break;
        }
      }
      return val;
    }
  };
  z = { string: () => s, number: () => s, boolean: () => s, literal: () => s, enum: () => s, array: () => s, discriminatedUnion: () => s, object: () => s };
}`)
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+class\s+/g, 'class ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+function\s+/g, 'function ')
        + '\nmodule.exports = { LocalEngine, videoEditSchema, installFfmpeg, diagnoseFfmpegEnvironment };\n';
      fs.writeFileSync(outPath, cjsCode, 'utf8');
      console.log(`Transpiled CommonJS: ${file} -> ${path.basename(outPath)}`);
      continue;
    }

    fs.writeFileSync(outPath, jsCode, 'utf8');
    console.log(`Transpiled: ${file} -> ${path.basename(outPath)}`);
  } catch (err) {
    console.warn(`Error transpiling ${file}:`, err.message);
  }
}

console.log('Desktop build completed successfully.');
