# FastShare Play

A complete Home Assistant app for FastShare downloads and your film collection. Three real frames
from each movie, a sharp navy-and-lime library, saved playback position and NOVA
resume compatibility. No API keys, metadata accounts or cloud lookup required.

Version 2.1 includes the established WorkFlow FastShare download queue, email
monitor, FastShare sign-in, MQTT diagnostics and dashboard card. Open Library &
player for the enhanced cinema. Play can also index films obtained elsewhere.
The original add-on is a separate installation and can be stopped after migration.

## Install

1. Add `https://github.com/Jirkas-prog/home-assistant-addons` to Home Assistant's app
   store repositories, install **FastShare Play**, then start it.
2. Open its web UI through Home Assistant and select media folders in Settings,
   for example `/media/movies`. The download engine can write to `/media` and
   `/share`; the player never edits source movies or sidecars. The dashboard
   installer writes its card assets to `/homeassistant/www/workflow-fastshare`.
3. To open the player directly on your network, enable **Playback without
   sign-in** and select a free port (default **8111**). Save; the app restarts
   automatically when the port mapping changes. The separate player has no
   settings or file management operations.

The optional hostname setting builds a convenient URL. Create your own DNS
record pointing that name to the Home Assistant host. It does not configure a
DNS server, router, external access or certificates.

English is the default; Czech is selectable in Settings.

## Downloads and migration

- Configure FastShare, IMAP email, destination, parallel limits and MQTT in the
  main Settings page. Download order, priority slots and exclusive downloads
  work as in WorkFlow FastShare. Resume the queue when ready; new installations
  start paused with MQTT off to avoid duplicate workers during migration.
- Language, media folders and playback port are shared between both interfaces.
- To migrate an existing installation, stop both apps, back up their private
  storage, then copy the old private storage into Play's `/data/downloader/`.
  Keep Play's `/data/library.sqlite3`, `/data/previews/` and `/data/settings.json`.
  Copy the complete closed SQLite database, including any WAL/SHM files.
- Map Play container port `8096/tcp` to the old authenticated web host port and
  `8098/tcp` to the old playback host port. Stop and disable automatic startup
  of the original before starting the migrated service. Do not run both MQTT
  publishers or download workers with the same configuration.
- Existing MQTT entity IDs and topics remain stable. Existing dashboard cards
  need their `addon` setting changed to the new installation slug.
- Account sessions, passwords, local sign-in key, queue/history and email cursors
  stay in private storage and never belong in this repository.

## Moving from the standalone Play repository

Both **WorkFlow FastShare** and **FastShare Play** are distributed from this
repository. Moving an existing Play installation between repositories changes
its Home Assistant installation ID. Stop both Play installations, back up and
copy the **entire** old Play `/data` directory into the new installation, and
transfer its Supervisor port mappings and startup preferences. This preserves
settings, credentials, queue, previews, watched state and playback positions.
Update dashboard card `addon` references to the new installation ID, then start
the new installation and keep the old one stopped. Do not use the downloader-only
copy procedure above for a Play-to-Play move.

## Library and playback

- Search titles and filenames; sort newest added, title, year, rating, last played
  or episode order. Filter movies, series, favorites, unwatched, year, folder,
  collection and genre. Genre, collection, cast and rating require local NFO
  data; they cannot be inferred reliably from video frames.
- Three previews are sampled at stable random positions, one in each third of
  the middle 60% of the film. They cycle every six seconds while visible and
  expand in the detail gallery. Reduced-motion preferences disable cycling.
- Previews and watch state live in private app storage, never alongside the
  source movie. One low-priority FFmpeg process runs at a time with one decoding
  thread, bounded timeouts and 640-pixel output. Existing previews are reused.
  First indexing of a large collection takes time; normal browsing uses cached
  JPEGs. Preview generation can be disabled without deleting saved previews.
- Resume, watched and favorites persist across restarts and browser devices.
  State is shared by the household, not split into user profiles. A newer
  playback session prevents an older tab from overwriting its progress.
- NOVA `.archos.resume.xml` and local NOVA/Kodi NFO progress are imported when
  newer than the saved browser state. This is **one-way import**; source sidecars
  and movie files are never written. SRT/VTT sidecar subtitles are supported.
- No plot descriptions or online movie lookup are used. Local NFO titles,
  genres, collections, cast, ratings and local posters are recognized.
- Direct video delivery supports HTTP Range/HEAD for seeking. The browser
  decodes the original file. There is **no live transcoding**: MP4/H.264/AAC is
  widely supported, but MKV/AVI, HEVC/DTS and embedded subtitles depend on the
  browser and device. Your existing Android/TV player remains useful for those.
- The anonymous listener exposes only the cinema and watch state/favorites.
  It cannot reach settings, download actions, email or credentials. The full
  interface uses Home Assistant Ingress or a separate authenticated LAN port.
  Network and player administration require Home Assistant Ingress.

## NOVA attribution and scope

Selected filename, NFO and resume parsing logic was ported from
[NOVA Video Player](https://github.com/nova-video-player/aos-AVP), with attribution
and modification notices under Apache 2.0. This is a browser adaptation, **not a
complete Android code port**. Android decoders, Trakt, torrents, audio passthrough
and Android TV UI are not included. Credits are in About and source notices.

See [LICENSE](LICENSE), [NOTICE](NOTICE) and [upstream details](docs/UPSTREAM.md).
FFmpeg is a separate Debian program with its own licenses; its copyright files
remain in the locally built container. This repository publishes source, not
prebuilt container images or FFmpeg binaries.

## Development and checks

Python 3.9+ (container: 3.12), Node for syntax/translation checks, FFmpeg/FFprobe
for real preview extraction. From the repository root:

```sh
cd fastshare_play
pip install -r requirements.txt
python -m unittest discover -s tests -v
node --check www/app.js
python -m player_app.service
```

Local development serves administration only to loopback on port 8099. Media
must be under `PLAY_DATA/downloader` (default `.runtime/downloader`). In Home Assistant,
only configured `/media` and `/share` paths are accepted. Tests cover public
access restrictions, path confinement, range requests, sidecar parsing,
persistence, stale sessions, replacement files, preview caching and real FFmpeg
extraction when the executables are installed.

Limits: 5,000 videos, 30,000 directory entries and 16 nested levels per scan;
12 configured roots; sidecar XML 1 MB; subtitle files 2 MB. Missing mounts do
not wipe saved progress. Replacing a file resets its old watch position.
