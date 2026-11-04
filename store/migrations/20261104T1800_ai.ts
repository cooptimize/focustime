// AI-0: the AI request log and the app's monthly AI spend. Only adds (D468). ai_requests is a person's log of every AI
// request that got past their switches: the task's name, its client (null for "none"), the model, token counts, the
// estimated cost in millionths of a dollar, latency and the outcome. Never the instructions, the input or the answer.
// ai_app_spend is the app's (not a person's) running total per calendar month (UTC), for the app-wide cap.
import type { NamedMigration } from "./named.ts";

export const ai: NamedMigration = {
  name: "20261104T1800_ai",
  sqlite: `CREATE TABLE ai_requests (
     user_id TEXT NOT NULL,
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     task TEXT NOT NULL,
     client_key TEXT,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cost_micros INTEGER NOT NULL DEFAULT 0,
     latency_ms INTEGER NOT NULL DEFAULT 0,
     outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'invalid', 'provider_error', 'over_budget')),
     detail TEXT
   );
   CREATE INDEX ai_requests_at ON ai_requests (user_id, at);
   CREATE TABLE ai_app_spend (
     month TEXT NOT NULL PRIMARY KEY,
     cost_micros INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );`,
  sqlserver: `CREATE TABLE ai_requests (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  at datetime2(7) NOT NULL,
  task nvarchar(64) NOT NULL,
  client_key nvarchar(100) NULL,
  model nvarchar(100) NOT NULL,
  input_tokens int NOT NULL CONSTRAINT ai_requests_in_default DEFAULT 0,
  output_tokens int NOT NULL CONSTRAINT ai_requests_out_default DEFAULT 0,
  cost_micros bigint NOT NULL CONSTRAINT ai_requests_cost_default DEFAULT 0,
  latency_ms int NOT NULL CONSTRAINT ai_requests_latency_default DEFAULT 0,
  outcome nvarchar(20) NOT NULL CONSTRAINT ai_requests_outcome_check CHECK (outcome IN ('ok', 'refused', 'invalid', 'provider_error', 'over_budget')),
  detail nvarchar(40) NULL
);
CREATE INDEX ai_requests_at ON ai_requests (user_id, at);
CREATE TABLE ai_app_spend (
  month nchar(7) NOT NULL PRIMARY KEY,
  cost_micros bigint NOT NULL CONSTRAINT ai_app_spend_cost_default DEFAULT 0,
  updated_at datetime2(7) NOT NULL
);`,
};
