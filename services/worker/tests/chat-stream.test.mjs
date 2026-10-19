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
