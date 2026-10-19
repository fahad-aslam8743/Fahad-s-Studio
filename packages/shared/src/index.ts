import { z } from 'zod';
export const risk = z.enum(['SAFE','CONFIRM','BLOCKED']);
export const toolDefinition = z.object({name:z.string(),description:z.string(),risk,executor:z.enum(['backend','local']),inputSchema:z.record(z.unknown())});
export type ToolDefinition = z.infer<typeof toolDefinition>;
export type Role = 'user'|'assistant'|'tool';
export type TranscriptItem = {role:Role;content:string;time?:string};
export type Persona = {id:string;name:string;tone:string;prompt:string;voices:Record<string,{male:string;female:string}>};
export type ToolProposal = {id:string;name:string;args:Record<string,unknown>;risk:'SAFE'|'CONFIRM'|'BLOCKED'};