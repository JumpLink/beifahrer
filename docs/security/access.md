# Host access, grants and asking

## Host access follows the policy

Host permissions are *optional* and requested per origin when the person raises that
origin's level. A write needs level `write`, the browser's grant for the origin, and
the person's confirmation, unless they switched confirmation off for that origin.

## Temporary access is temporary

"All sites" and a prompt's "For this session" are `Grant`s (`policy.ts`) in
`storage.session`, never in the stored policy; `decide` checks their end at decision
time, and `grants.ts` gives the host access back when they end (`hostsToRelease`).

An explicit rule beats the wildcard, an explicit `none` blocks every grant and every
prompt, and a write only a grant allows asks unless the person switched asking off
for that grant (`Grant.confirmWrites`, `*` only, read from the grant live for the
session asking, [ADR 0013](../adr/0013-all-sites-without-asking.md)) —
`page.evaluate` answers only to `confirmScripts`
([ADR 0016](../adr/0016-scripts-without-asking.md)).

Session-bound grants name the extension's own id for the connection, never the
bridge's.

## Asking on demand fails closed

Below the level, `gate` may open the confirm window (`access-prompt.ts`): not when
paused, not for a switched-off feature (preflight refuses first), not for a blocked
site or a non-web page, not when the person switched asking off. One prompt per site
and session; timeout, close or Deny is `forbidden`. The host permission is requested
in the answer's own click.

## Redaction

A tab on a `none` origin shows its host only: never title, path or query.

## Passwords and one-time codes

Never fill a password field; never switch the person's tab (screenshots refuse a tab
that is not the active one). The one thing typed for the person is a one-time code
they relayed, only via `page.enterCode` into a field marked as one, behind the
off-by-default switch `oneTimeCodes`, redacted everywhere
([ADR 0020](../adr/0020-one-time-codes-the-person-relays.md)). A login QR code is
decoded only by `page.readQr` for the person to scan, behind the off-by-default
switch `qrCodes` ([ADR 0022](../adr/0022-login-qr-code-for-the-person.md)). Never
read or replay credentials, tokens or cookies.
