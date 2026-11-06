# Frames

A frame is gated on its OWN origin, never on the page's (issue #32). The page agent
is injected into every frame (`allFrames`, and only when a call asks — there is no
`content_scripts` entry, so it costs nothing on a page nobody is reading), each frame
is addressed on its own, and the policy is asked about the FRAME's URL: a frame from
an origin below `read` is never asked, so it is invisible in the outline, in `read`
and in `find` while the page around it stays readable.

Granting a site does not grant what that site embeds — the clickjacking case that
`all_frames` in a manifest would have opened silently.

Refs carry their frame (`b2e12`), because each frame has its OWN registry and an
ambiguous ref in a write is a write on the wrong element; the confirm window names
the FRAME's origin, and the pill says "this embedded page" so the words do not name
the top site.

Frames are learned by announcing themselves (`FRAME_HELLO`, the only thing a content
script may send unprompted besides Stop) — `sender.frameId` comes from the browser,
so the table needs no permission. The order matters: inject into all frames FIRST,
since a frame only announces itself once its agent is INJECTED, and wait for a frame
with a real web URL (re-asked, not remembered), never a sleep
([code facts](../traps-extension-code.md)).
