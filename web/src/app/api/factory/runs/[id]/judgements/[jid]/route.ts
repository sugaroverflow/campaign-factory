// POST /api/factory/runs/[id]/judgements/[jid] — thin signed proxy. Body is a
// JudgementAnswerRequest { action: "answer"|"defer"|"accept_default", answer? }.
// Nonblocking: the worker records the answer and emits judgement.resolved.
// Caller auth: requires the run-scoped stream token (held by the run creator's
// client); forwarded to the worker, which verifies it against the run.

import { NextResponse } from "next/server";
import { forwardSigned, streamTokenFrom, STREAM_TOKEN_HEADER } from "../../../../_lib/worker";

export const runtime = "nodejs";

const ANSWER_MAX_CHARS = 2000;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; jid: string }> }) {
  const { id, jid } = await ctx.params;

  const streamToken = streamTokenFrom(req);
  if (!streamToken) {
    return NextResponse.json(
      { error: "A run stream token is required to answer a judgement." },
      { status: 401 },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const answer = (body as { answer?: unknown })?.answer;
  if (answer !== undefined && typeof answer !== "string") {
    return NextResponse.json({ error: "answer must be a string." }, { status: 400 });
  }
  if (typeof answer === "string" && answer.length > ANSWER_MAX_CHARS) {
    return NextResponse.json(
      { error: `answer must be at most ${ANSWER_MAX_CHARS} characters.` },
      { status: 400 },
    );
  }

  const r = await forwardSigned("POST", `/runs/${id}/judgements/${jid}`, body, {
    [STREAM_TOKEN_HEADER]: streamToken,
  });
  return NextResponse.json(r.body, { status: r.status });
}
