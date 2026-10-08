# Cat personality behavior

The companion decorates the interface. It cannot click, move records, complete tasks,
read typed text or change an attachment. It needs no network calls, assets or new
backend service. Settings use the existing revision-protected per-space settings
API, backup format and undo history. Missing personality fields normalize to
`classic`; invalid IDs are rejected before saving.

## Personality policy

| Mode | Rhythm and resting | Preferred edges | Cursor |
| --- | --- | --- | --- |
| Explorer (original) | Original short walk, groom, explore, peek, sleep cycle | Text inputs and existing frame edges | 650 ms anticipation; three-second catch |
| Quiet companion | 12–20 second pauses, slow 30–60 px walks, 35–65 second naps | Window frame, reader, writing area | Watches; never hunts |
| Curious researcher | 4–6.2 second pauses, sniffing and visits to unfamiliar edges; rests after seven actions | Preview, writing, calendar, checkpoints | 850 ms anticipation; two-second catch; longer cooldown |
| Playful acrobat | 2.8–4.4 second pauses, hops and paw taps; rests after eight actions | Tabs, board columns, calendar | 450 ms anticipation; 2.5-second catch |

Durations use the host's visible-time clock. Four recently visited surfaces guide
exploration without retaining document content or growing memory. A new window or
changed task tab triggers its routine once; scroll, resize, progress updates and
ordinary React renders do not restart it. A trip is retargeted continuously when
its destination changes. Personality switching preserves the current position,
and an ongoing leap lands through the normal movement system.

## Window interactions for new personalities

| Context | Curious researcher | Playful acrobat | Quiet companion |
| --- | --- | --- | --- |
| Task details | Inspect, walk along edge, watch | Hop, tap, watch | Watch, groom |
| Attachments | Sniff, tap, peek | Peek, tap, hop | Watch, groom |
| Document preview | Inspect, watch, groom | Inspect, tap, watch | Watch, sleep |
| Checkpoints | Inspect, watch, tap | Tap, watch, hop | Watch, groom |
| Comments / activity | Watch, groom or walk | Peek or watch, then rest | Watch, groom |
| Journal | Watch, groom, sleep | Peek, groom, watch | Watch, sleep |
| General editor | Inspect, watch | Peek, watch | Watch, groom |
| Calendar / timeline | Walk and watch, inspect | Walk, tap or watch, hop | Watch, groom |
| Task board | Explore new edges, inspect, peek | Hop, peek, explore | Watch, groom |
| Map | Watch, explore free edges, peek | Explore, watch, hop | Watch, groom |
| Library / inventory | Inspect edges, walk or watch | Peek or inspect, walk or tap | Watch, groom |
| Settings | Watch, groom | Watch, groom | Watch, groom |
| Backups / transfer | Watch, sleep | Watch, groom, sleep | Watch, sleep |

The routines select **available, unobstructed edges**; a small window may only have
one usable perch. Context changes do not download content or previews. The map is
never loaded for the pet. The host measures group containers rather than every
record or calendar event. Landing intervals exclude visible controls and title
text. Only the cat silhouette and the ball's touch target intercept input; empty
space around the cat remains clickable. Existing scrolling geometry is retained.

After the entrance routine, personalities continue their own cycle. In journals,
editors, comments and settings, new personalities replace roaming/hops with quiet
watching. Throughout backup sessions they only watch, groom and sleep, with no
cursor hunts. Typing suppresses new games for six seconds after the last keystroke
(twelve for Quiet), releases an existing catch, lets a current journey land and
does not wake an ordinary nap. Clicking or dragging always releases a cursor game.

## Performance and accessibility

- Local SVG cat and yarn with CSS poses; no image downloads or extra dependencies.
- Animation frames run only for movement, an active yarn game or following a caught pointer. Idle
  decisions use timers; geometry is measured on relevant mutations, resize and
  scroll, coalesced into a single pending frame.
- Hidden tabs pause both CSS animation and the behavior clock. No missed actions
  accumulate. Reduced/still motion overrides every personality.
- Settings use keyboard-accessible native radios styled as application cards,
  descriptions and a responsive single-column layout on phones. Changes apply on
  Save, respecting the existing unsaved-change guard.
- Automated checks cover legacy behavior, context transitions, continuous
  retargeting, cursor timing, typing, backup restraint, ten-minute bounded runs,
  reduced motion, validation, space isolation, restart and backup restoration.

## Carrying and landing

In cursor-playing personalities, hold the pointer just above the cat until she
catches it, then move her above the desired control. At the end of the catch
(or when a click/keystroke releases her), she drops onto the first usable upper
edge beneath her paws. Buttons, fields, links, tabs and disclosure controls can
support her, including narrow buttons where the tail hangs over the edge. This
never dispatches a click or changes the control. Normal user clicks retain their
usual meaning; simply waiting for release does not activate the target.

Landing checks the current visible controls only at release, with clipping,
headroom and occlusion checks. Directly underlying edges win over nearby edges;
if none is usable she may nudge sideways by up to 48 px, then uses the viewport
floor as a last resort. She never jumps upward to return to the original panel.
The drop accelerates with gravity, stretches the legs, and ends with a soft
landing pose. She stays on the chosen perch for roughly eight seconds before
resuming her personality's routine. The position is temporary, not a saved pin.

Only the occupied control joins normal geometry tracking. Scrolling carries the
resting cat with it; scrolling during a fall updates the destination without
restarting gravity. A removed or raised target triggers a fresh downward landing.
Hidden tabs pause the clock, and disabled/reduced animation still overrides play.

## Independent yarn game

Pet settings include **Yarn game → Drop yarn when clicking an empty background**.
The `catYarnEnabled` boolean defaults to true and is independent of personality:
even Quiet companion plays when explicitly offered yarn. The setting is stored
per space, participates in settings history and survives backups and updates.
Cat visibility and still/reduced motion remain the outer controls.

A short primary click/tap on a non-interactive background creates one ball at the
pointer. It drops with gravity and a small bounce onto a usable edge underneath,
or the viewport floor if none is available. The cat plans a route through visible
perches, pats the ball, bats it away and follows it for two or three more rounds.
She finishes by hiding it behind herself or making a digging motion as it fades
into the supporting edge, then resumes her normal routine. Another background
click replaces the current toy; balls never accumulate or enter the database.

Disabled controls, labels, links, fields, menus, map/timeline gestures, selected
text, long presses, modified clicks, keyboard activation and drags do not spawn
toys. Background spawning does not consume the original click or activate a control.
Typing, navigation or changing the dialog ends play. Switching the yarn setting
off removes the toy and settles the cat. Hidden pages pause the same clock used
by the cat, without accumulating work for later.

Only visible controls join the route during play. Geometry is refreshed on layout
events rather than each frame, and routes are replanned after landings. Scrolling
carries resting yarn with its supporting edge; removing the edge makes it fall
again. Each game has a one-minute visible-time bound, no network traffic, no
external assets and no backend animation service.

## Direct interaction and throws

Click/tap the cat to send her to another perch, with an extended pause before she
returns to play. Click/tap the yarn to remove it immediately. Hold and drag either
with a mouse, pen or finger to carry it. The grab keeps its original offset and
overrides roaming. Release slowly to drop onto a supporting edge; flick to throw.
Recent pointer velocity controls momentum, gravity pulls down, walls reflect a
throw and surfaces damp it. Yarn bounces and rolls more than the cat. The cat
settles her paws on a perch and stays there for about eight seconds.

Native pointer capture retains the gesture when leaving the silhouette; a
six-pixel movement threshold distinguishes a click from a drag. Pausing before
release cancels old throw velocity. Escape, lost capture, a hidden tab or window
blur releases without a throw or click-through. Keyboard Enter/Space sends the
focused cat away or dismisses focused yarn. Explicit cat carrying still works
with animation disabled, placing her immediately without inertia.

**Yarn game → Ball position relative to the cat** selects **In front** (default)
or **Behind**. `catYarnLayer` is validated and saved per space, including settings
history and backups. Ball positions and throws are temporary and need no network
requests. Physics uses bounded substeps against visible rails in the existing
animation loop; it never operates application controls or modifies records.
