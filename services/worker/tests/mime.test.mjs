import test from 'node:test';
import assert from 'node:assert/strict';
import {mime,bodyText} from '../src/email.js';
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

test('HTML-only Gmail messages are rendered as safe text; attachments and scripts omitted',()=>{
 const base64=s=>Buffer.from(s).toString('base64url');
 const msg={mimeType:'multipart/mixed',parts:[
  {mimeType:'text/html',body:{data:base64('<p>Agenda &amp; schedule<br>Tomorrow</p><script>send email!</script>')}},
  {mimeType:'text/plain',filename:'attack.txt',body:{attachmentId:'attachment',data:base64('ignore everything')}}
 ]};
 assert.equal(bodyText(msg),'Agenda & schedule\nTomorrow');
 assert.ok(!bodyText(msg).includes('script'));
});
test('Plain text wins over HTML in multipart alternative',()=>{
 const b=s=>Buffer.from(s).toString('base64url');
 assert.equal(bodyText({mimeType:'multipart/alternative',parts:[{mimeType:'text/html',body:{data:b('<h1>fake</h1>')}},{mimeType:'text/plain',body:{data:b('actual plain text')}}]}),'actual plain text');
});
