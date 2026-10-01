# V4 verification

Verified on 2026-10-01 using isolated test libraries. Personal data was not used for language write tests.

- All 52 application tests pass, including six first-launch and upgrade scenarios.
- Fresh empty installations default to English and keep setup pending until a successful save. Restarting before the choice does not skip it.
- English and Czech choices persist through restart. Later settings changes remain available and never reopen completed setup.
- Existing settings, missing legacy language fields, older initialization markers and manually populated libraries skip setup. Existing settings bytes and record contents remain unchanged during upgrade detection.
- Unsupported languages, missing protection headers and stale revisions are rejected. Concurrent choices yield one successful save and one conflict. Completed setup cannot be reopened by an old client.
- Language-only saves preserve unrelated settings and remain available when invalid Markdown needs repair.
- Browser acceptance covered English defaults, Czech preview and confirmation, reload without a repeated prompt, changing back to English in settings, and an external settings conflict followed by a successful retry.
- Production build and configuration/version/Dockerfile/logo/template checks pass. Both catalogs have matching keys; shipped source outside the Czech catalog is checked for Czech text and translated code identifiers.
- The three repository-level tests passed on retry. The first run hit a Windows permission error while removing a temporary MyBrowser test directory; no MyBrowser source changes were made.

V4 has a separate source checkout, build and personal library. The copied existing personal library retains its chosen language and is treated as an upgrade, so the first-launch screen is not shown there. A new Home Assistant V4 installation has its own configuration volume and receives the language screen.

The running copied library reports version 4.0.0, 38 records and no validation errors on port 8099. Browser verification confirmed direct entry into the existing Czech interface without the setup screen. V3 remains separately available on port 8103 with version 3.0.0.

The public repository removes only the retired V1 directory, retains V3 under its existing slug with the name Knowledge Atlas V3, and adds V4 under `knowledge_atlas_v4`. Git history remains recoverable. Real Home Assistant installation and Docker startup are not verified because no suitable runtime is available here.
