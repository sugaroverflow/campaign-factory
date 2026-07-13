import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { overBudget } from "@/lib/spend/ledger";
import { parseSid, runCount } from "@/lib/session";

// GET /api/status — what the client needs to decide whether to show the entry
// form, prompt for an access code, or show the "we're at capacity" page.
export async function GET(req: Request) {
  const sid = parseSid(req.headers.get("cookie"));
  const used = sid ? runCount(sid) : 0;
  const capacity = config.readonly || overBudget();
  return NextResponse.json({
    accessRequired: !!config.accessCode,
    readonly: config.readonly,
    capacity,
    reason: config.readonly ? "closed" : overBudget() ? "budget" : null,
    runCap: config.runCap,
    runsUsed: used,
    runsRemaining: Math.max(0, config.runCap - used),
  });
}
