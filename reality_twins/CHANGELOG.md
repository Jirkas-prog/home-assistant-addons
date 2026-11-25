# Changelog

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
