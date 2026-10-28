# WorkFlow FastShare

Open the Web UI. In **Settings**, choose English or Czech, connect your IMAP mailbox, and select a destination under `/media` or `/share`. Gmail needs an app password. A FastShare account is optional; free downloads run one at a time. Search thumbnails open a larger preview.

MQTT is obtained automatically from the Supervisor. On **Dashboard card**, select a dashboard and click **Add to dashboard**. The resource and new tab are registered automatically. Reload an already-open Home Assistant page if necessary; copy or resize the card using the normal editor. MQTT integration and a broker are required for dashboard entities.

English is the default. Language selection persists for the app and card. New messages are monitored after the first successful check unless older messages are explicitly enabled. Messages are never deleted or marked as read.

Open **Library & player** to play downloaded or existing videos. Add other folders under `/media` or `/share` in **Settings → Media library**. The player supports seeking, fullscreen, remembered position and matching SRT/VTT subtitle files. Files stream directly without conversion; MP4/H.264/AAC is broadly supported, other codecs depend on your browser.

For a separate address, enable **Local web & player**, choose a port and optionally enter your own DNS name. Use **Open local web** to sign in once, or set a separate password for direct visits. Port changes restart the add-on. The DNS name must already resolve to Home Assistant; the add-on does not configure your DNS or remote access.

The dashboard card supports **Auto / 2 / 3 / 4 rows**, selectable in the card editor. Compact sizes retain all counts and show zero, one or two transfers respectively. Auto grows with the content.

For a separate player without sign-in, enable **Settings → Playback-only web** and choose a free port (default **8110**). **Open player** opens only the library and playback controls. Anyone who can reach that port can watch the videos; settings, queue actions and file changes are blocked on the server. The normal local web still requires sign-in. Both modes share the same media folders and language.

See README.md for limits, configuration, backup and privacy details.
