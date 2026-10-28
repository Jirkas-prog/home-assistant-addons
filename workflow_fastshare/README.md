# WorkFlow FastShare

A Home Assistant add-on with its own web server, persistent download queue, email monitoring, local media library, browser player and live dashboard card. Supports aarch64 and amd64. English is the default; Czech is saved under **Settings → Interface language** for both the app and card.

## Install and use

1. Add `https://github.com/Jirkas-prog/home-assistant-addons` to the app store, install **WorkFlow FastShare**, and start it.
2. Open the Web UI. Configure your mailbox and destination in **Settings**. A FastShare account is optional. MQTT credentials are obtained automatically from the Supervisor.
3. Open **Dashboard card**, select a dashboard, and click **Add to dashboard**.

The card resource is installed and registered automatically. A FastShare tab is appended without replacing existing views; the previous dashboard is backed up first. Repeated clicks do not create duplicate tabs. Reload an already-open Home Assistant page if necessary, then copy or resize the card in the normal editor. No Grafana, HACS or manual YAML is required.

MQTT integration and a broker are required for dashboard entities. Downloads and the app's own web interface also work without MQTT. The compact `/widget` page uses Ingress authentication or the local web sign-in described below.

## Features

- Paste file links or search FastShare. Click a provider thumbnail for a larger preview; files without images show a placeholder.
- One free download at a time without an account; configurable 1–8 concurrent downloads with an account. Speed depends on the provider plan, credit and service limits. Reducing the limit lets current transfers finish.
- Persistent SQLite queue, deduplication by file ID, pause, cancel and retry.
- Partial transfer recovery with HTTP Range and If-Range when the server provides a validator. Otherwise restart safely. Known response sizes are checked before completion; the provider supplies no cryptographic checksum.
- Temporary failures retry with increasing delays, up to six attempts. CAPTCHA and account issues require user attention. CAPTCHAs are not solved automatically.
- Larger text, square panels and controls, animated progress, countdowns, responsiveness and reduced-motion support.

## Files and email

Use the queue's arrow buttons to move a waiting file up, down or to the front. The displayed queue numbers reflect the saved order. **Prioritize** opens two choices: **Free one slot** pauses the most recently started other transfer when a slot is needed; **Download alone** pauses all other transfers until the chosen file finishes. Either choice resumes a globally paused queue. An already active file can also be made exclusive. The scheduler waits for stopped workers to release their slots before starting another transfer, so the free-account limit remains one.

**Resume normal queue** ends the override early. Completion, cancellation or a final error restores normal limits automatically; temporary retries keep the chosen priority, and exclusive mode waits through those retries. Order and priority survive restarts. Partial files are retained and resumed with the provider's byte-range support; when the server cannot safely resume, that file starts again. A pending network read can take up to its timeout to stop.

Default destination: `/media/FastShare`. Choose a directory under `/media` or `/share`; mount network storage through Home Assistant first. Existing completed files are never overwritten. Sanitized filenames include the file ID. Incomplete files use `.part`; cancellation retains them for retry. Remove unwanted partials manually after the job stops. The app checks known remaining size plus a 64 MB reserve. Finish or cancel partial jobs before changing the destination.

Email supports Seznam (`imap.seznam.cz:993`), Gmail (`imap.gmail.com:993`) and custom IMAP with TLS certificate verification. Gmail requires an app password and two-step verification; some managed accounts prohibit app passwords. Seznam users with two-step verification need an email client password. OAuth sign-in is not included.

Only new messages after the first successful check are processed by default. Enable older messages before connecting if needed. This option applies to new mailbox/UIDVALIDITY cursors and does not rewind an existing cursor. Checks run every 30–3600 seconds, at most 100 messages per check, continuing from the saved UID. Only the first 2 MB of each message are examined. Messages are never deleted or marked as read. The cursor advances after links are committed. A From-address allowlist is optional and does not authenticate sender identity.

## MQTT and dashboard

Default base topic: `mqtt_addon/fastshare`. Discovery prefix: `homeassistant`. Automatic mode uses the Supervisor MQTT service; manual server, port, TLS, credentials and topics are supported.

Ten entities report online status, FastShare and email availability, download activity, active/queued/completed/attention counts, total speed and remaining time for the longest active transfer. The waiting queue cannot be reliably timed before file sizes are known.

Topics are `availability`, `state`, and `details`. LWT reports an unclean disconnect; state expires after 90 seconds. Discovery is republished after reconnect and HA birth messages. Old discovery is cleaned on prefix changes when the old broker is reachable; otherwise manual cleanup may be needed. The card includes up to 25 jobs and the web up to 60, while counts cover all jobs. Cards support the HA grid with 6 or more columns. Choose **Auto**, **2**, **3** or **4 rows** in the add-on preview or Home Assistant card editor. Auto grows with content; only long lists scroll. Two rows show counts, three show one transfer, and four show two. All counts still include the entire queue. The Layout tab can also set 2–4 rows. For YAML use `rows: 3` and `grid_options: {columns: 6, rows: 3}`; an explicit grid height takes precedence.

## Library and player

Open **Library & player** to search, filter, play or download completed video files. The download directory is included automatically. Add up to 12 folders under `/media` or `/share` in **Settings → Media library**; files are read in place, including videos obtained elsewhere. Network storage must already be mounted by Home Assistant. Refresh after adding files. Scans are cached for 20 seconds, bounded to 5,000 videos / 20,000 scanned entries / 16 directory levels, and show unavailable folders. `.part`, hidden and empty files are excluded.

The browser receives byte ranges from the original file, supports seeking and fullscreen, and remembers playback position on that browser. No transcoding, media-server dependency or external metadata service is used. MP4 with H.264 and AAC is broadly supported; MKV, HEVC, AVI and other codecs depend on the browser and device. An unsupported file can be downloaded for another player. A container extension alone cannot guarantee playback or audio support. This is not a YouTube-style conversion service.

Sidecar subtitles such as `Movie.cs.srt` or `Movie.en.vtt` appear in the native player's subtitle menu (up to 16 tracks, 2 MB each; UTF-8 or Windows-1250 SRT). Embedded subtitle extraction is not included. Direct Play mainly uses disk and network bandwidth; a 20 Mbit/s video requires about 2.5 MB/s per viewer. Downloads and viewers share storage/network resources. No video encoding runs on Home Assistant.

## Local web address

In **Settings → Local web & player**, enable access and choose an unused host port (1024–65535, default 8099). The add-on applies the port mapping and restarts itself. Ingress stays available. Set a DNS name or IPv4 address for the displayed/opened URL, for example `fastshare-play.home`; leave it blank to use the current Home Assistant hostname. The server listens on the mapped host interfaces. This field does not create a DNS record or bind to a DNS name: configure name resolution yourself. DNS labels use hyphens, not underscores. Routing, certificates and remote access are managed by the user.

**Open local web** generates a one-use, 60-second sign-in link from Home Assistant. Alternatively set a separate local web password (10–256 characters) for direct visits. A local sign-in lasts 14 days in that browser. Password changes, password removal and disabling LAN access invalidate sessions. Sign-out clears the current browser session. Local web credentials and port settings can only be managed through Ingress. The hostname opens an HTTP URL; TLS may be supplied by the user's reverse proxy. A local web sign-in grants access to the queue, media and normal add-on settings, so share it only with trusted users.

## Security and backups

No host port is exposed by default. Ingress checks the actual proxy IP. The optional LAN listener requires its own signed, HttpOnly, SameSite cookie. Passwords are hashed and login attempts are rate limited. Port 8098 inside the container is mapped to the chosen external port; 8099 remains Ingress-only. Modifications require JSON plus a custom header, and LAN requests reject a mismatched Origin. Image previews use a bounded proxy restricted to the provider's image server. File links and redirects are restricted to provider hosts.

Private settings and queue live in `/data`. Only the FastShare token is saved, not its password. Email and manual MQTT passwords are stored in `settings.json` with mode 0600, readable by device administrators. Add-on backups contain this private data. Public status and MQTT exclude credentials. The persistent web signing key is stored in `/data/web-session.key`; back it up with the settings. Media references are signed and resolved against configured roots on every request, including streams and subtitles.

The `/homeassistant` mount installs card/translation files in `www/workflow-fastshare`. HA API access registers the resource and appends the selected view only on button press. YAML-managed dashboards are not overwritten. Previous dashboard JSON is stored in `/data/dashboard-backups`.

## Development

Python 3.9+ locally, Python 3.12 in the container. Create a virtual environment, install `requirements.txt`, run `python -m unittest discover -s tests -v`, then `python -m fastshare_app.app`. Local mode initially binds only to `127.0.0.1:8099`, uses `.runtime`, and starts with MQTT disabled. Downloads and additional media folders must stay inside that data directory. In local development, choose a LAN port different from the main `PORT` (default 8099), then restart the process after enabling or changing it. `python package.py` produces a ZIP using an explicit source allowlist; private and runtime files are excluded.

For manual installation, extract to `/addons` so `/addons/workflow_fastshare/config.yaml` exists, reload local apps, and install. The GitHub repository is the recommended user installation method.

## References

Independent protocol implementation based on the [provider's Kodi add-on](https://kodi.fastshare.cloud/addons/plugin.video.fastshare/) and observed free-download forms. Provider APIs and limits may change. See [Ingress](https://developers.home-assistant.io/docs/apps/presentation/), [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/), [custom cards](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/) and [Google app passwords](https://support.google.com/accounts/answer/185833).
