# Security rules

The hard rules from [AGENTS.md](../../AGENTS.md) are summarized there. This directory
holds the rationale, incident history and implementation notes for each group.

| Document | Holds |
|---|---|
| [policy.md](policy.md) | Where policy is enforced, fail-closed behaviour, check order, pause control, visibility |
| [evaluate.md](evaluate.md) | The `page.evaluate` exception and why it is fenced the way it is |
| [frames.md](frames.md) | Frame identity, `allFrames`, `FRAME_HELLO`, per-frame refs |
| [access.md](access.md) | Host permissions, temporary grants, the confirm window, redaction, passwords and one-time codes |
| [data.md](data.md) | No telemetry, one connection per session, recipes as data, fixtures, i18n |
