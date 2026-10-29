# 2.1.4

Distribute FastShare Play alongside WorkFlow FastShare in the shared
`Jirkas-prog/home-assistant-addons` repository. Update installation/source links
and document full private-storage migration for existing Play installations.

# 2.1.3

Add a quiet email countdown to every dashboard card size, driven by the actual
mail polling schedule. Show checking, disabled and offline states without a
misleading looping timer.

# 2.1.2

Version the dashboard card resource with the app release so Home Assistant
loads the current card after updates instead of reusing an old browser cache.

# 2.1.1

Style the cinema navigation as a prominent square lime action button and keep
header controls readable and within the viewport on narrow screens.

# 2.1.0

Complete replacement for WorkFlow FastShare: download queue, email intake,
FastShare account, MQTT diagnostics and dashboard widgets alongside the advanced
cinema. Shared language/folders/playback settings, separate authenticated and
anonymous listeners, and migration preserving existing account and queue data.

# 2.0.2

Keep the preview worker idle when every frame is already cached; show generation
status only while a movie is actually being processed.

# 2.0.1

Normalize extracted frames to full-range JPEG, including movies with explicit
limited-range video flags. Show probed duration in movie details.

# 2.0.0

First separate FastShare Play release: local movie library, three cached video
previews, cycling gallery, persistent resume/favorites/watched state, NOVA/Kodi
sidecar import, episode navigation, English/Czech UI and an optional standalone
playback port. Existing FastShare downloader installations are unaffected.
