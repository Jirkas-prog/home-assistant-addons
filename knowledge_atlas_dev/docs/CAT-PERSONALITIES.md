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
record or calendar event. Text fields and controls remain usable because the pet
has no pointer events or focus, and landing intervals exclude visible controls
and title text. Existing scrolling and fallback geometry are retained.

After the entrance routine, personalities continue their own cycle. In journals,
editors, comments and settings, new personalities replace roaming/hops with quiet
watching. Throughout backup sessions they only watch, groom and sleep, with no
cursor hunts. Typing suppresses new games for six seconds after the last keystroke
(twelve for Quiet), releases an existing catch, lets a current journey land and
does not wake an ordinary nap. Clicking or dragging always releases a cursor game.

## Performance and accessibility

- One existing SVG with CSS poses; no image downloads or extra dependencies.
- Animation frames run only for movement or following a caught pointer. Idle
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
