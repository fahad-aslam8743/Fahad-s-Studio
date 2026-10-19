import test from 'node:test';
import assert from 'node:assert/strict';
import {mime} from '../src/email.js';
test('Gmail MIME is RFC line-wrapped, UTF-8 roundtrips, and outer raw uses base64url',()=>{
 const data={to:'someone@example.com',subject:'Café meeting',body:'Hello 👋 世界 '.repeat(600)};
 const raw=mime(data);
 assert.match(raw,/^[A-Za-z0-9_-]+$/);
 const message=Buffer.from(raw,'base64url').toString('utf8');
 assert.match(message,/^To: someone@example.com\r\n/);
 assert.match(message,/\r\nContent-Transfer-Encoding: base64\r\n/);
 const encoded=message.split('\r\n\r\n')[1];
 assert.ok(encoded.split('\r\n').every(line=>line.length<=76));
 assert.equal(Buffer.from(encoded.replace(/\r\n/g,''),'base64').toString('utf8'),data.body);
});
test('Gmail reply headers reject CRLF injection',()=>{
 assert.throws(()=>mime({to:'friend@example.com',subject:'Normal\r\nBcc: bad@example.com',body:'hello'}),/Invalid header/);
 assert.throws(()=>mime({to:'friend@example.com\r\nBcc: bad@example.com',subject:'Normal',body:'hello'}),/Invalid recipient/);
});
