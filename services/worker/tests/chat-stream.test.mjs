import test from 'node:test';
import assert from 'node:assert/strict';
import {streamGemini, detectFastPathReply, geminiModelCandidates} from '../src/index.js';

test('true Gemini SSE streaming emits each delta, even when network chunks split lines',async()=>{
 const old=globalThis.fetch;let called;
 const sse=['data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n','data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n'].join('');
 const encoded=new TextEncoder().encode(sse);
 globalThis.fetch=async(url,options)=>{called=String(url);return new Response(new ReadableStream({start(controller){controller.enqueue(encoded.slice(0,18));controller.enqueue(encoded.slice(18,74));controller.enqueue(encoded.slice(74));controller.close()}}),{status:200})};
 try{const output=[];for await(const chunk of streamGemini({GEMINI_API_KEY:'test'},'test-model',{contents:[]}))output.push(chunk);assert.deepEqual(output,['Hello',' world']);assert.match(called,/streamGenerateContent\?alt=sse/)}finally{globalThis.fetch=old}
});

test('streaming Gemini errors are surfaced, not replaced with an invented response',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('no',{status:429});
 try{await assert.rejects(async()=>{for await(const _ of streamGemini({GEMINI_API_KEY:'test'},'x',{})){}},/429/)}finally{globalThis.fetch=old}
});

test('streaming provider errors expose safe Google diagnostics without leaking keys',async()=>{
 const old=globalThis.fetch;const fakeKey='AIzaSy'+ 'A'.repeat(35);
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:'Key rejected: '+fakeKey}}),{status:403,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(async()=>{for await(const _ of streamGemini({GEMINI_API_KEY:'test'},'x',{})){}},error=>{
   assert.match(error.message,/HTTP 403/);assert.match(error.message,/PERMISSION_DENIED/);assert.match(error.message,/\[redacted\]/);assert.doesNotMatch(error.message,/AIzaSyA{20,}/);return true;
  });
 }finally{globalThis.fetch=old}
});

test('streaming provider timeout is reported explicitly',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{const error=new Error('timed out');error.name='TimeoutError';throw error};
 try{await assert.rejects(async()=>{for await(const _ of streamGemini({GEMINI_API_KEY:'test'},'x',{})){}},/Gemini streaming provider timed out after 120000 ms/)}finally{globalThis.fetch=old}
});

test('streaming falls back to a stable model when primary model is overloaded',async()=>{
 const old=globalThis.fetch;const called=[];
 const sse='data: {"candidates":[{"content":{"parts":[{"text":"JARVIS_FALLBACK_OK"}]}}]}\n\n';
 globalThis.fetch=async(url)=>{
  const target=String(url);called.push(target);
  if(target.includes('/models/gemini-3.8-flash:streamGenerateContent')){
   return new Response(JSON.stringify({error:{status:'UNAVAILABLE',message:'temporarily overloaded'}}),{status:503,headers:{'content-type':'application/json'}});
  }
  return new Response(sse,{status:200});
 };
 try{
  const output=[];for await(const chunk of streamGemini({GEMINI_API_KEY:'test'},'gemini-3.8-flash',{contents:[]}))output.push(chunk);
  assert.deepEqual(output,['JARVIS_FALLBACK_OK']);
  assert.equal(called.length,2);
  assert.match(called[1],/models\/gemini-3\.6-flash:streamGenerateContent/);
 }finally{globalThis.fetch=old}
});

test('streaming falls back to secondary model when primary provider times out before first byte',async()=>{
 const old=globalThis.fetch;const called=[];
 const sse='data: {"candidates":[{"content":{"parts":[{"text":"TIMEOUT_FALLBACK_OK"}]}}]}\n\n';
 globalThis.fetch=async(url)=>{
  const target=String(url);called.push(target);
  if(target.includes('/models/gemini-3.6-flash:streamGenerateContent')){
   const err=new Error('Connection timed out');
   err.name='TimeoutError';
   throw err;
  }
  return new Response(sse,{status:200});
 };
 try{
  const output=[];
  for await(const chunk of streamGemini({GEMINI_API_KEY:'test'},'gemini-3.6-flash',{contents:[]},10000)) {
   output.push(chunk);
  }
  assert.deepEqual(output,['TIMEOUT_FALLBACK_OK']);
  assert.equal(called.length,2);
  assert.match(called[1],/models\/gemini-3\.5-flash-lite:streamGenerateContent/);
 }finally{globalThis.fetch=old}
});

test('geminiModelCandidates never returns identical primary and fallback models',async()=>{
 const candidates1=geminiModelCandidates({GEMINI_MODEL:'gemini-3.6-flash',GEMINI_FALLBACK_MODEL:'gemini-3.6-flash'});
 assert.equal(candidates1.length,2);
 assert.notEqual(candidates1[0],candidates1[1]);

 const candidates2=geminiModelCandidates({GEMINI_MODEL:'gemini-3.5-flash-lite',GEMINI_FALLBACK_MODEL:'gemini-3.5-flash-lite'});
 assert.equal(candidates2.length,2);
 assert.notEqual(candidates2[0],candidates2[1]);
});

test('deterministic fast-path resolves simple greetings, thanks, and ping without calling provider',async()=>{
 assert.match(detectFastPathReply('Hello Jarvis')||'',/Hello/i);
 assert.match(detectFastPathReply('hi')||'',/Hello/i);
 assert.match(detectFastPathReply('good morning')||'',/Hello/i);
 assert.match(detectFastPathReply('thanks')||'',/welcome/i);
 assert.match(detectFastPathReply('thank you very much')||'',/welcome/i);
 assert.match(detectFastPathReply('are you online')||'',/online/i);
 assert.match(detectFastPathReply('who are you')||'',/JARVIS/i);

 // Real queries and tasks must NEVER match the fast path
 assert.equal(detectFastPathReply('Hello, what is the capital of France?'), null);
 assert.equal(detectFastPathReply('Are you online? I need you to open Notepad'), null);
 assert.equal(detectFastPathReply('Thanks for yesterday, can you summarize my emails?'), null);
 assert.equal(detectFastPathReply('Open youtube and search for jazz'), null);
});
