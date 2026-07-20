// The ONE predicate for "does this Postgres URL need TLS" — Neon always does;
// anything else opts in via sslmode=require in the URL or PGSSL=require in the
// environment. Callers choose their driver's option shape (postgres.js takes
// ssl:"require"; pg takes {rejectUnauthorized:false}); the decision lives here.
// (Architecture review 2026-07-20, W3 — previously copy-pasted five times.)
export function needsSsl(url: string): boolean {
  return /neon\.tech|sslmode=require/.test(url) || process.env.PGSSL === "require";
}
