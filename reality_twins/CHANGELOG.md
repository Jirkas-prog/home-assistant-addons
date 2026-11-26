# Changelog

## 0.6.2

- Set an explicit portrait screen orientation for the mobile Instagram editor and restore desktop orientation for feed publishing.
- Cover the browser's screen orientation, legacy orientation value and responsive media query when switching modes.
- Include bounded image dimensions and orientation in pre-send diagnostics without logging image URLs or page contents.

## 0.6.1

- Recognize the mobile Instagram header's unlabelled create control when named controls are unavailable, while rejecting ambiguous or covered candidates.
- Still require the exact Story menu, selected-image preview, verified account and a separate publication receipt.
- Add focused browser regression coverage and safe header-control diagnostic counts.

## 0.6.0

- Add companion Stories after confirmed feed posts, using the same private Instagram browser session.
- Render a full-image branded Story on a warm-to-blue/teal gradient, with editable text and a saved-template preview.
- Support `/nostory` in calendar event descriptions and a per-post Story choice for manual publishing.
- Track Story delivery separately from feed delivery; retry only confirmed pre-send failures and require review of uncertain results.
- Add **Add Story** to published items in history, with an image preview and destination account confirmation; historical posts are never sent automatically.
- Replace the beige interface with navy, teal and cyan, with distinct success, warning and destructive-action colors.
- Cover scheduling, migration, Story rendering, archived-image integrity, independent delivery, UI confirmation and browser editor transitions with regression tests.

## 0.5.4

- Add a mobile view to the private Instagram browser for inspecting available account features.
- Keep the same private session and restore the desktop view before verified feed publishing.
- Match viewer clicks to the active screen size and cover the transition with Chromium tests.

## 0.5.3

- Prefer the unique crop icon's nearest clickable parent so nested button wrappers do not falsely block the Instagram crop step.
- Add regression coverage for nested clickable crop controls while keeping ambiguous controls blocked before Share.

## 0.5.2

- Recognize repeated crop control labels and crop/expand icons within the active Instagram crop dialog, while preserving the original image proportions.
- Distinguish opening crop options from selecting Original in preparation errors, with diagnostic counts that exclude page contents and credentials.
- Stop before Share when crop preparation fails and retain the editor for inspection.

## 0.5.1

- Select the upload belonging to the active Instagram post editor instead of requiring a single file input on the whole page.
- Wait for each crop, edit and caption step before advancing, including delayed editor transitions.
- Read contenteditable caption lines without the extra blank lines introduced by browser `innerText`, while requiring all text and internal paragraphs to match.
- Report the exact failed preparation step without exposing page contents or credentials.
- Keep a failed pre-publication editor available in the private browser view for inspection.
- Preserve original image proportions, account checks and the single final Share action; uncertain outcomes still require review.
- Cover asynchronous editors, unrelated upload inputs and contenteditable captions with isolated Chromium fixtures.

## 0.5.0

- Add **Publish next now** to publish the first queued post immediately, in addition to scheduled posts.
- Show the selected photo, caption and destination account before manual publication.
- Preserve calendar events and the scheduler's enabled or paused state; manual posting is available while scheduling is paused.
- Reuse publication history, account verification and recovery checks, with protection against duplicate requests and a changed queue head.
- Add regression coverage for immediate publication, concurrent requests, failure handling and unchanged scheduling.

## 0.4.1

- Recognize signed-in profile navigation with account names, avatar labels and Czech/English text instead of requiring the exact word `Profile`.
- Verify account identity independently of the post creation control, and ignore hidden navigation duplicates.
- Support the current `Post` entry point alongside the older `Create` navigation.
- Preserve the private browser session, import folder, queue and calendar during the update.
- Keep the saved calendar visible while loading the available calendars, so saving other settings cannot clear it accidentally.
- Add real-browser regression fixtures for current profile navigation and rejection of unrelated profiles.

## 0.4.0

- Add an app-owned Instagram browser view for real website sign-in and account verification, using its persistent private session for scheduled publication.
- Keep browser access behind Ingress with restricted navigation, bounded input and an expiring interactive view; opening sign-in pauses publishing.
- Submit each browser publication once and require a confirmed media receipt; ambiguous results remain blocked for review.
- Add a mounted-folder picker and optional automatic import of stable photo/TXT pairs, preserving source files and deduplicating across restarts and published history.
- Preserve the existing calendar, queue, storage identity and working connection methods during migration.
- Add browser fixture, import recovery, source integrity, settings migration and authorization tests.

The browser fixture uses synthetic pages and does not establish successful login or publication on a real Instagram account.

## 0.3.0

- Rebuild the interface with an angular layout, readable typography, a compact status strip and a coral/blue palette.
- Put the queue first, with a single task navigation and concise setup actions instead of repeated welcome panels.
- Add full-image previews with complete captions and a photo alongside the caption editor.
- Preserve queue controls during unchanged background refreshes.
- Validate image/caption pairing and image proportions before upload; report the imported count and missing captions.
- Fetch the actual selected calendar week instead of displaying a truncated list of upcoming events as an empty week.
- Keep publishing paused unless explicitly enabled; preserve the account, calendar, queue identity and storage paths.

## 0.2.0

- Rename the app to Czech This View Publisher while preserving its technical slug, queue paths and existing data.
- Make direct Instagram login the default, with local photo upload and no public domain or Meta app requirement.
- Support two-factor codes and private session reuse after restart; keep passwords in memory only, with a ten-minute pending login lifetime.
- Direct account checkpoints to the official Instagram app or website for verification.
- Keep the official Instagram API connection as an advanced alternative.
- Preserve calendar-driven posting and block blind retries after uncertain upload results.
- Document adding a Home Assistant Local calendar when none is available.

Direct login uses the unofficial instagrapi client. Live account login and publication require verification on the intended account; automated tests use simulated responses.

## 0.1.0

- Add a numbered photo queue with paired caption files and drag-to-reorder filename updates.
- Read timed events from an existing Home Assistant calendar; ignore all-day events.
- Provide an explicit internal weekly/one-off scheduler as an alternative.
- Connect a professional Instagram account through official Instagram Login or a compatible long-lived token.
- Separate the Ingress dashboard from temporary media delivery and the OAuth callback.
- Record publication attempts and require review when the outcome is uncertain.
- Start new installations paused with no connected account or selected calendar.
- Include a standalone Docker Compose configuration.

This initial preview requires account, calendar and public HTTPS configuration. Source publication does not establish that physical Home Assistant installation or live Instagram publishing has been verified.
