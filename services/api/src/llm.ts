import {GoogleGenAI} from '@google/genai';
export interface AIProvider {generate(prompt:string):Promise<string>; stream(prompt:string):AsyncIterable<string>; embed(text:string):Promise<number[]>; transcribe(wav:string,mime:string):Promise<string>; speak(text:string,voice:string):Promise<string>}
export class GeminiProvider implements AIProvider {
  private client:GoogleGenAI;
  constructor(){if(!process.env.GEMINI_API_KEY)throw Error('GEMINI_API_KEY is missing');this.client=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});}
  async generate(prompt:string){const r=await this.client.models.generateContent({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',contents:prompt});return r.text||'';}
  async *stream(prompt:string){const stream=await this.client.models.generateContentStream({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',contents:prompt});for await(const part of stream)if(part.text)yield part.text;}
  async embed(text:string){const r=await this.client.models.embedContent({model:process.env.GEMINI_EMBED_MODEL||'gemini-embedding-001',contents:text,config:{outputDimensionality:768}});return r.embeddings?.[0]?.values || [];}
  async transcribe(wav:string,mime:string){const r=await this.client.models.generateContent({model:process.env.GEMINI_STT_MODEL||'gemini-3.8-flash',contents:[{inlineData:{data:wav,mimeType:mime}},'Transcribe the speech verbatim. Output only transcript, preserving spoken language.']});return r.text||'';}
  async speak(text:string,voice:string){const r=await this.client.models.generateContent({model:process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts',contents:[{parts:[{text:'Read aloud naturally: '+text}]}],config:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}});return r.candidates?.[0]?.content?.parts?.find(p=>p.inlineData)?.inlineData?.data||'';}
}
export function provider():AIProvider {return new GeminiProvider()}