# Appearance

Appearance is a per-space server preference, not a modification to records. The five visual directions share the same navigation, dialog structure and interaction behavior. Switching a theme should never move tasks, rebuild the map or load attachments.

| Theme    | Visual direction                                                                 | Intended use                       |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| Original | Retained dark atlas with green accents and the pre-illumination component colors | Familiar compact workspace         |
| Lime     | Illuminated sage surfaces, bright lime actions and warm orbital decoration       | Energetic everyday work            |
| Paper    | Warm ivory, olive accents, restrained shadows and editorial headings             | Journaling, reading and reflection |
| Graphite | Slate surfaces, lavender accents, tighter corners and reduced decoration         | Dense project work                 |
| Tide     | Pale blue surfaces, teal actions, rounded cards and a soft sand highlight        | An airy, bright alternative        |

## Inspiration and implementation

[Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) emphasizes visual hierarchy, quieter surfaces and consistent theme behavior. Graphite applies those principles to the existing Atlas structure. [Notion's appearance preferences](https://www.notion.com/help/account-settings) informed the simple selection model, while Paper uses a document-oriented treatment. The [Awwwards minimalist gallery](https://www.awwwards.com/websites/minimal/) provided a broader reference for spacing and restrained decoration. These are design references; this release adds no third-party UI code or downloaded assets.

Core palettes live in `shared/appearance.js`. Semantic variables drive controls, panels, text and focus states. Original has scoped restoration rules for legacy component colors; the illuminated and additional themes have scoped decorative styles. Canvas renderers receive the same palette directly, since CSS cannot recolor their pixels. User-assigned record colors and dark urgency bars retain their meaning; light themes use dark text on pale event fills.

The Appearance radio group is keyboard-accessible and provides miniature local previews, names, descriptions and light/dark labels. Selection applies a temporary client preview. Closing it restores the server preference; saving follows the existing revision-protected settings path and history. A per-path browser hint displays the last saved choice while the space loads. Denied browser storage falls back safely to the server preference. No preview is written to the cache.

Old settings without `appearance` default to Lime. Invalid values are rejected rather than becoming CSS or HTML. Full backups preserve the field; partial imports preserve destination settings. The palette is independent from the cat personality, map layout and user records.

## Review criteria

- Check the calendar, board, forms, record text and map surfaces, including focus and selected states.
- Keep normal primary, secondary and muted palette text at least 4.5:1 against the main surfaces in new themes. The original palette remains intentionally unchanged. This token check is not a complete accessibility certification for arbitrary user colors.
- Keep previews usable at narrow widths, with no horizontal document overflow.
- Keep changes local and lightweight: no theme image requests, external fonts, dependencies or additional animation loops.
