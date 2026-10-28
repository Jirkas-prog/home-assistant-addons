# 1.3.0

- Optional playback-only web on its own configurable port, without sign-in.
- Separate library screen with search, folder filters, subtitles, fullscreen and remembered playback position; no download or management controls.
- Server-side read-only allowlist blocks settings, queue operations, authentication routes and every mutation request on the player port.
- Shared library/player templates preserve the existing design and functionality in both interfaces; English and Czech supported.
- Automated checks cover anonymous streaming and seeking, rejected admin routes, port mapping, immediate disabling and preserved full-web authentication.

# 1.2.1

- Preserve the selected row height inside the Home Assistant card wrapper and add-on preview.

# 1.2.0

- Persistent queue ordering, one-slot priority and exclusive downloads with automatic return to normal limits.
- Local video library with search, folder filters, direct browser playback, byte-range seeking, saved position and sidecar subtitles.
- Optional authenticated LAN web with a configurable port and address, one-use Home Assistant sign-in links and optional password.
- Automatic port mapping and app restart; existing Ingress access stays available.
- Dashboard card Auto / 2 / 3 / 4 row layouts and a visual card editor.
- Green dropdown highlights, English defaults and Czech translations for the new interface.
- Media path confinement, authentication, range and migration tests. No video transcoding dependency.

# 1.1.2

- Custom film-inbox illustration for an empty download queue.
- Versioned card translations to refresh cached resources after updates.

# 1.1.1

- Content-sized app and dashboard cards; empty messages never become scroll panes.
- Themed square scrollbars and safe wrapping on narrow screens.

# 1.1.0

- English by default, with a saved Czech language option for the app and card.
- Clickable provider thumbnails in search results.
- Angular identity, diagonal graphic accents, larger typography and connected status cells with labels above values.
- Image-first search cards with an enlarged preview dialog.
- Distribution through the shared Home Assistant add-on repository.

# 1.0.0

- FastShare login, search and free/authenticated download queue.
- Persistent jobs, partial transfer recovery, IMAP TLS monitoring and MQTT discovery.
- Responsive card with automatic dashboard setup and Ingress Web UI.
