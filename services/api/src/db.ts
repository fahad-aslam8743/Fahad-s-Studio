import pg from 'pg';
const pool = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('supabase.co')?{rejectUnauthorized:true}:undefined}) : null;
export async function query<T extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,params:unknown[]=[]){if(!pool)throw Error('DATABASE_URL is not configured');return pool.query<T>(sql,params);}
export function vectorLiteral(values:number[]){return '['+values.join(',')+']';}