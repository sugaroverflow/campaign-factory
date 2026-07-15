// POST /api/factory/runs/[id]/cancel — thin signed proxy to the worker. The
// worker marks the run cancelled + aborts in-flight work; its finalise node is
// the single writer of run.cancelled. Caller auth: the run-scoped stream token
// (held by the run creator's client, verified by the worker) or a valid
// presenter session cookie — never open to anonymous callers.

import { NextResponse } from "next/server";
import { forwardSigned, streamTokenFrom, STREAM_TOKEN_HEADER, readCookie } from "../../../_lib/worker";
import { PRESENTER_COOKIE, verifyPresenterToken } from "../../../present/session";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const streamToken = streamTokenFrom(req);
  if (streamToken) {
    const r = await forwardSigned("POST", `/runs/${id}/cancel`, undefined, {
      [STREAM_TOKEN_HEADER]: streamToken,
    });
    return NextResponse.json(r.body, { status: r.status });
  }

  // Presenter-originated cancel (gallery): valid presenter cookie stands in for
  // the run's stream token.
  const presenterCookie = readCookie(req.headers.get("cookie"), PRESENTER_COOKIE);
  if (verifyPresenterToken(presenterCookie)) {
    const r = await forwardSigned("POST", `/runs/${id}/cancel`, { presenter: true });
    return NextResponse.json(r.body, { status: r.status });
  }

  return NextResponse.json(
    { error: "A run stream token or presenter session is required to cancel a run." },
    { status: 401 },
  );
}
