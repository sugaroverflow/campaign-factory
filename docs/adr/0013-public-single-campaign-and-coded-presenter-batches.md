# ADR 0013: Public single campaign and coded presenter batches

## Status

Accepted — 15 July 2026

## Context

Five concurrent multi-agent campaigns create the intended conference spectacle but may cost tens of dollars per batch. Allowing every audience member to run repeated batches would expose the project budget. Requiring audience BYOK would add provider compatibility, encrypted credential storage, and unfamiliar API-key setup to the conference prototype.

The presenter must run many five-campaign batches during development, rehearsal, and the show, and needs the same capability on a backup device.

## Decision

- The public Campaign Factory experience creates exactly one campaign per launch, funded by the project account and protected by existing run and spending controls.
- After launch, the public single-campaign experience opens its Campaign Assembly View directly, with desktop Agent Work Cards or Compact Build View on mobile. It does not render the multi-campaign Factory Gallery or Batch Receipt.
- A dedicated presenter route accepts a reusable presenter code and creates a Presenter Session.
- Presenter Sessions may launch batches of one to five campaigns repeatedly during the configured rehearsal and conference window.
- The presenter code is stored only in server configuration, compared server-side with attempt throttling, and never stored in browser localStorage, campaign state, Factory Events, or analytics.
- Successful authentication creates a Secure, HttpOnly, SameSite cookie with a configured expiry. The same presenter code may establish sessions on the primary and backup presentation devices.
- Presenter capability is limited to larger batches and demo controls. It does not grant destructive admin actions or in-product Replay Promotion.
- Presenter Sessions bypass ordinary per-session and per-IP run-count caps so repeated rehearsals and backup devices do not lock themselves out.
- Presenter batches have a separate configurable spending ceiling and remain subject to the twenty-five-call global concurrency cap.
- The presenter code and all Presenter Sessions can be disabled or rotated immediately and expire after the event.
- BYOK and additional model providers are deferred from the conference prototype.

## Consequences

- Audience cost is bounded to one campaign per launch while the stage retains the full five-campaign reveal.
- Presenter authentication adds one deliberate code prompt only on the dedicated demo route.
- Rehearsal and backup-device use do not require code changes or manual session transfer.
- The application avoids storing audience model-provider credentials and avoids a cross-provider compatibility project before the conference.
