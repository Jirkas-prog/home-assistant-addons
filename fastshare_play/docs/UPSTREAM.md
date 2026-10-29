# Upstream provenance

Inspected and cloned on 2026-10-28:

| Repository | Pinned revision |
| --- | --- |
| nova-video-player/aos-AVP | `5c5d4ec81b47ba59be8f91c9d877b49b0ab1c01e` |
| nova-video-player/aos-MediaLib | `fba68119be9b704bfa0cad78f7ca8422df0e5cfb` |
| nova-video-player/aos-Video | `4bf05901637678fbc9453a7e10feccd075b34b71` |
| nova-video-player/aos-FileCoreLibrary | `56fc8dfa00ba25d01fa98bd3aed4398ed3e74efc` |

Each inspected repository contains an Apache 2.0 LICENSE.txt. No upstream NOTICE
file was present in those checkouts. The original license is retained verbatim
in this repository's LICENSE; our NOTICE records attribution and changes.

The following MediaLib classes informed or contributed selected logic in
`fastshare_play/player_app/nova.py`:

- `src/com/archos/mediascraper/preprocess/ParseUtils.java`
- `src/com/archos/mediascraper/preprocess/MovieDefaultMatcher.java`
- `src/com/archos/mediascraper/saxhandler/NfoMovieHandler.java`
- `src/com/archos/mediascraper/saxhandler/NfoEpisodeHandler.java`
- `src/com/archos/mediascraper/NfoWriter.java`
- `src/com/archos/mediacenter/utils/videodb/XmlDb.java`

Changes: Python rather than Java; bounded local XML; no Android database/provider;
no network XML entities; additional Czech/Slovak release suffixes; Kodi seconds
versus NOVA milliseconds; imports only, with timestamp precedence against SQLite
watch state. Local artwork is confined to configured media roots. No upstream
API keys, binary assets, Android UI, native decoder or trademark artwork is used.

The source application and Python web app use Apache 2.0. License and copyright
notices accompany distributions, and adapted source prominently identifies the
modification. About links to NOVA and the source repositories. No NOVA endorsement
or affiliation is claimed.

FFmpeg/FFprobe are separate subprocesses, installed unmodified using Debian's
package manager at container build time. Their own package copyright and license
files remain installed. This repository distributes no compiled FFmpeg artifacts.
If publishing binary images later, provide the exact corresponding source and
all applicable dependency license notices for those images.
