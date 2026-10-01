# Permanent channel verification

Verified on 2026-10-01 for stable `5.0.1` and development `5.0.1-dev.1`.

- All 57 application tests pass independently in each channel, including backup/restore, persistence, concurrent changes and both language choices across restart/update.
- Both production builds, add-on configuration checks and English/Czech language audits pass. Each catalog has 701 matching translation keys.
- The repository channel check verifies exactly two permanent channel folders, fixed names and slugs, synchronized versions, Docker metadata, empty first launches and unchanged configuration-volume paths.
- Separate local production servers report their correct channel name/version, start empty and have distinct library identities. The browser confirms stable in Czech and Dev in English, with their permanent names and package-derived versions.
- All three inherited repository tests pass. One first-run MyBrowser cleanup failed with a Windows temporary-directory `EPERM`; an independent rerun passed without source changes.
- Source and staged-file checks exclude private libraries, archives, runtime files and machine-specific content. Fakturocel and MyBrowser are unchanged.
- The stable slug and data paths match the previous V5 manifest. A verified local Git bundle preserves all previous remote branch tips and their complete history before cleanup.

No real Home Assistant Supervisor installation or update was available for verification. Compatibility is based on retaining the repository URL, original stable slug and configuration volume, as specified by the official Home Assistant app configuration documentation.
