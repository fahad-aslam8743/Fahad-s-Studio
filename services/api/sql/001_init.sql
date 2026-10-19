CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS memories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fact text NOT NULL, importance real NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1), embedding vector(768), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS conversation_summaries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tool_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tool text NOT NULL, risk text NOT NULL, arguments jsonb NOT NULL, result jsonb, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());