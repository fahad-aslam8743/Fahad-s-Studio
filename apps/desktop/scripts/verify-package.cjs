const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'release','win-unpacked');
const resources=path.join(out,'resources');
const pkg=path.join(resources,'app.asar');
assert.ok(fs.existsSync(pkg),'Missing installed app.asar');
assert.ok(fs.existsSync(path.join(resources,'ui','index.html')),'Bundled UI index.html missing from resources');
assert.ok(fs.existsSync(path.join(resources,'ui','_next')),'Next.js runtime assets absent from installed resources');
assert.ok(fs.existsSync(path.join(resources,'scripts','tools.ps1')),'Windows tool helper missing');
assert.ok(fs.readdirSync(out).some(x=>x.endsWith('.exe')),'Windows executable missing');
const files=asar.listPackage(pkg).map(x=>x.replace(/\\/g,'/'));
for(const required of ['dist/main.js','dist/preload.js','dist/whatsapp.js','dist/local-agent.js',
                        'node_modules/whatsapp-web.js/index.js','node_modules/qrcode/lib/index.js']){
 const found=files.some(x=>x.endsWith('/'+required));
 assert.ok(found,'Missing production bundle dependency: '+required);
}
console.log('Windows release payload OK: desktop preload, WhatsApp bridge, native tools, production libraries and Next.js UI are bundled.');
