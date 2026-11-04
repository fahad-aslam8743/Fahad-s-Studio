'use client';
import {useState,useEffect} from 'react';

export interface PersonaItem {
 id: string;
 name: string;
 tone: string;
 prompt: string;
 voice_male: string;
 voice_female: string;
 builtin: boolean;
 is_default?: boolean;
}

const VOICE_OPTIONS = ['Puck', 'Charon', 'Kore', 'Aoede', 'Fenrir', 'Zephyr'];

export default function PersonaManager({
 request,
 currentPersona,
 onSelectPersona
}:{
 request:(route:string,init?:RequestInit)=>Promise<any>;
 currentPersona:string;
 onSelectPersona:(id:string)=>void;
}){
 const [personas,setPersonas]=useState<PersonaItem[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [editing,setEditing]=useState<Partial<PersonaItem>|null>(null);
 const [saving,setSaving]=useState(false);

 async function loadPersonas(){
  setLoading(true);
  try{
   const data=await request('/personas');
   if(Array.isArray(data)){
    // Normalize if backend returned array of strings (legacy) or objects
    const list=data.map((item:any)=>{
     if(typeof item==='string') return {id:item,name:item[0].toUpperCase()+item.slice(1),tone:item,prompt:'',voice_male:'Puck',voice_female:'Kore',builtin:true};
     return item;
    });
    setPersonas(list);
   }
   setError('');
  }catch(e){
   setError('Could not load personas: '+String(e));
  }finally{
   setLoading(false);
  }
 }

 useEffect(()=>{void loadPersonas();},[]);

 async function savePersona(){
  if(!editing?.name?.trim() || !editing?.prompt?.trim()){
   setError('Name and instructions prompt are required');
   return;
  }
  setSaving(true);
  setError('');
  try{
   if(editing.id && !editing.builtin){
    await request('/personas/'+editing.id,{
     method:'PUT',
     body:JSON.stringify({
      name:editing.name,
      tone:editing.tone||'custom',
      prompt:editing.prompt,
      voice_male:editing.voice_male||'Puck',
      voice_female:editing.voice_female||'Kore'
     })
    });
   }else{
    await request('/personas',{
     method:'POST',
     body:JSON.stringify({
      name:editing.name,
      tone:editing.tone||'custom',
      prompt:editing.prompt,
      voice_male:editing.voice_male||'Puck',
      voice_female:editing.voice_female||'Kore'
     })
    });
   }
   setEditing(null);
   await loadPersonas();
  }catch(e){
   setError('Failed to save persona: '+String(e));
  }finally{
   setSaving(false);
  }
 }

 async function deletePersona(id:string){
  if(!confirm('Delete this custom persona?')) return;
  try{
   await request('/personas/'+id,{method:'DELETE'});
   if(currentPersona===id) onSelectPersona('jarvis');
   await loadPersonas();
  }catch(e){
   setError('Failed to delete persona: '+String(e));
  }
 }

 return (
  <div className="glass rounded-xl p-5 space-y-4">
   <div className="flex justify-between items-center">
    <div>
     <h2 className="text-cyan-300 text-xl font-semibold tracking-wider">PERSONA STUDIO</h2>
     <p className="text-xs text-cyan-600">Customize JARVIS personality, behavior, voice, and system instructions</p>
    </div>
    <button className="btn" onClick={()=>setEditing({name:'',tone:'professional',prompt:'',voice_male:'Puck',voice_female:'Kore',builtin:false})}>
     + New Persona
    </button>
   </div>

   {error&&<p role="alert" className="text-xs text-red-400 p-2 border border-red-800 rounded">{error}</p>}

   {/* Persona list */}
   <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
    {personas.map(p=>(
     <div
      key={p.id}
      className={`p-3 rounded-lg border transition-all ${
       currentPersona===p.id
        ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
        : 'border-cyan-900 bg-cyan-950/20 hover:border-cyan-700'
      }`}
     >
      <div className="flex justify-between items-start mb-2">
       <div>
        <h3 className="text-sm font-semibold text-cyan-200 flex items-center gap-1.5">
         {p.name}
         {p.builtin&&<span className="text-[10px] px-1 py-0.2 rounded bg-cyan-900/60 text-cyan-400">Preset</span>}
        </h3>
        <span className="text-[11px] text-cyan-600 capitalize">Tone: {p.tone}</span>
       </div>
       <button
        className={`px-2 py-0.5 text-xs rounded border ${
         currentPersona===p.id
          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
          : 'border-cyan-800 hover:border-cyan-600 text-cyan-400'
        }`}
        onClick={()=>onSelectPersona(p.id)}
       >
        {currentPersona===p.id ? 'Active' : 'Select'}
       </button>
      </div>

      <p className="text-xs text-cyan-300/80 line-clamp-3 mb-2">{p.prompt || '(Standard preset prompt)'}</p>

      <div className="text-[11px] text-cyan-500 flex justify-between items-center border-t border-cyan-900/50 pt-2">
       <span>Voices: {p.voice_male||'Puck'} / {p.voice_female||'Kore'}</span>
       {!p.builtin&&(
        <div className="flex gap-1.5">
         <button className="text-cyan-400 hover:text-cyan-200" onClick={()=>setEditing(p)}>Edit</button>
         <button className="text-red-400 hover:text-red-300" onClick={()=>deletePersona(p.id)}>Delete</button>
        </div>
       )}
      </div>
     </div>
    ))}
   </div>

   {/* Editor Modal */}
   {editing&&(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
     <div className="glass max-w-lg w-full p-5 rounded-xl border border-cyan-700 space-y-3 bg-[#030815]/95">
      <h3 className="text-lg font-semibold text-cyan-200">
       {editing.id ? 'Edit Persona' : 'Create Custom Persona'}
      </h3>

      <div>
       <label className="text-xs text-cyan-400 block mb-1">Persona Name</label>
       <input
        className="input w-full"
        value={editing.name||''}
        onChange={e=>setEditing({...editing,name:e.target.value})}
        placeholder="e.g. Senior Architect, Coding Buddy"
        maxLength={80}
       />
      </div>

      <div className="grid grid-cols-2 gap-2">
       <div>
        <label className="text-xs text-cyan-400 block mb-1">Tone</label>
        <input
         className="input w-full"
         value={editing.tone||''}
         onChange={e=>setEditing({...editing,tone:e.target.value})}
         placeholder="e.g. analytical, witty"
         maxLength={40}
        />
       </div>
       <div>
        <label className="text-xs text-cyan-400 block mb-1">Male Voice</label>
        <select
         className="input w-full"
         value={editing.voice_male||'Puck'}
         onChange={e=>setEditing({...editing,voice_male:e.target.value})}
        >
         {VOICE_OPTIONS.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
       </div>
      </div>

      <div>
       <label className="text-xs text-cyan-400 block mb-1">Female Voice</label>
       <select
        className="input w-full"
        value={editing.voice_female||'Kore'}
        onChange={e=>setEditing({...editing,voice_female:e.target.value})}
       >
        {VOICE_OPTIONS.map(v=><option key={v} value={v}>{v}</option>)}
       </select>
      </div>

      <div>
       <label className="text-xs text-cyan-400 block mb-1">System Instructions / Personality Prompt</label>
       <textarea
        className="input w-full text-xs"
        rows={4}
        value={editing.prompt||''}
        onChange={e=>setEditing({...editing,prompt:e.target.value})}
        placeholder="Describe how this persona should think, speak, and format answers..."
        maxLength={2000}
       />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-cyan-900">
       <button className="btn" type="button" onClick={()=>setEditing(null)} disabled={saving}>Cancel</button>
       <button className="btn border-cyan-400 text-cyan-200" type="button" onClick={savePersona} disabled={saving}>
        {saving?'Saving...':'Save Persona'}
       </button>
      </div>
     </div>
    </div>
   )}
  </div>
 );
}
