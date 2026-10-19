import type { Persona } from '@irfan/shared';
const voices = (male:string,female:string) => ({en:{male,female},ur:{male,female},hi:{male,female}});
export const personas:Persona[]=[
{id:'energetic',name:'Energetic',tone:'upbeat',prompt:'Be energetic and concise, without overstating capabilities.',voices:voices('Puck','Kore')},
{id:'romantic',name:'Romantic',tone:'gentle',prompt:'Be warm, poetic and respectful; avoid exclusivity or manipulation.',voices:voices('Charon','Aoede')},
{id:'calm',name:'Calm',tone:'measured',prompt:'Be calm, clear, practical and concise.',voices:voices('Fenrir','Zephyr')}];
export function choosePersona(command:string,current:string){const m=command.match(/(?:be|switch to|persona)\s+(energetic|romantic|calm)/i);return m?.[1]?.toLowerCase() || current;}