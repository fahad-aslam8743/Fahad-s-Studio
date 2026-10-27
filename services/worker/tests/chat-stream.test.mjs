import test from 'node:test';
import assert from 'node:assert/strict';
import {streamGemini} from '../src/index.js';
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
