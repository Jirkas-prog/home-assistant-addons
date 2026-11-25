# Changelog

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
