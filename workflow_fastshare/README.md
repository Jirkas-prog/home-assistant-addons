# WorkFlow FastShare

A Home Assistant add-on with its own web server, persistent download queue, email monitoring and live dashboard card. Supports aarch64 and amd64. English is the default; Czech is saved under **Settings → Interface language** for both the app and card.

## Install and use

1. Add `https://github.com/Jirkas-prog/home-assistant-addons` to the app store, install **WorkFlow FastShare**, and start it.
2. Open the Web UI. Configure your mailbox and destination in **Settings**. A FastShare account is optional. MQTT credentials are obtained automatically from the Supervisor.
3. Open **Dashboard card**, select a dashboard, and click **Add to dashboard**.

The card resource is installed and registered automatically. A FastShare tab is appended without replacing existing views; the previous dashboard is backed up first. Repeated clicks do not create duplicate tabs. Reload an already-open Home Assistant page if necessary, then copy or resize the card in the normal editor. No Grafana, HACS or manual YAML is required.

MQTT integration and a broker are required for dashboard entities. Downloads and the app's own web interface also work without MQTT. The compact `/widget` page uses authenticated Ingress; it is not an unauthenticated public URL.

## Features

- Paste file links or search FastShare. Click a provider thumbnail for a larger preview; files without images show a placeholder.
- One free download at a time without an account; configurable 1–8 concurrent downloads with an account. Speed depends on the provider plan, credit and service limits. Reducing the limit lets current transfers finish.
- Persistent SQLite queue, deduplication by file ID, pause, cancel and retry.
- Partial transfer recovery with HTTP Range and If-Range when the server provides a validator. Otherwise restart safely. Known response sizes are checked before completion; the provider supplies no cryptographic checksum.
- Temporary failures retry with increasing delays, up to six attempts. CAPTCHA and account issues require user attention. CAPTCHAs are not solved automatically.
- Larger text, square panels and controls, animated progress, countdowns, responsiveness and reduced-motion support.

## Files and email

Default destination: `/media/FastShare`. Choose a directory under `/media` or `/share`; mount network storage through Home Assistant first. Existing completed files are never overwritten. Sanitized filenames include the file ID. Incomplete files use `.part`; cancellation retains them for retry. Remove unwanted partials manually after the job stops. The app checks known remaining size plus a 64 MB reserve. Finish or cancel partial jobs before changing the destination.

Email supports Seznam (`imap.seznam.cz:993`), Gmail (`imap.gmail.com:993`) and custom IMAP with TLS certificate verification. Gmail requires an app password and two-step verification; some managed accounts prohibit app passwords. Seznam users with two-step verification need an email client password. OAuth sign-in is not included.

Only new messages after the first successful check are processed by default. Enable older messages before connecting if needed. This option applies to new mailbox/UIDVALIDITY cursors and does not rewind an existing cursor. Checks run every 30–3600 seconds, at most 100 messages per check, continuing from the saved UID. Only the first 2 MB of each message are examined. Messages are never deleted or marked as read. The cursor advances after links are committed. A From-address allowlist is optional and does not authenticate sender identity.

## MQTT and dashboard

Default base topic: `mqtt_addon/fastshare`. Discovery prefix: `homeassistant`. Automatic mode uses the Supervisor MQTT service; manual server, port, TLS, credentials and topics are supported.

Ten entities report online status, FastShare and email availability, download activity, active/queued/completed/attention counts, total speed and remaining time for the longest active transfer. The waiting queue cannot be reliably timed before file sizes are known.

Topics are `availability`, `state`, and `details`. LWT reports an unclean disconnect; state expires after 90 seconds. Discovery is republished after reconnect and HA birth messages. Old discovery is cleaned on prefix changes when the old broker is reachable; otherwise manual cleanup may be needed. The card includes up to 25 jobs and the web up to 60, while counts cover all jobs. Cards support the HA grid with 6 or more columns and automatic height. Empty states grow naturally; only long job lists scroll inside the card.

## Security and backups

No host port is exposed. The web checks the actual Ingress proxy IP and requires JSON plus a custom header for modifications. Image previews use a bounded proxy restricted to the provider's image server. File links and redirects are restricted to provider hosts.

Private settings and queue live in `/data`. Only the FastShare token is saved, not its password. Email and manual MQTT passwords are stored in `settings.json` with mode 0600, readable by device administrators. Add-on backups contain this private data. Public status and MQTT exclude credentials.

The `/homeassistant` mount installs card/translation files in `www/workflow-fastshare`. HA API access registers the resource and appends the selected view only on button press. YAML-managed dashboards are not overwritten. Previous dashboard JSON is stored in `/data/dashboard-backups`.

## Development

Python 3.9+ locally, Python 3.12 in the container. Create a virtual environment, install `requirements.txt`, run `python -m unittest discover -s tests -v`, then `python -m fastshare_app.app`. Local mode binds only to `127.0.0.1:8099`, uses `.runtime`, and starts with MQTT disabled. Downloads must stay inside that data directory. `python package.py` produces a ZIP using an explicit source allowlist; private and runtime files are excluded.

For manual installation, extract to `/addons` so `/addons/workflow_fastshare/config.yaml` exists, reload local apps, and install. The GitHub repository is the recommended user installation method.

## References

Independent protocol implementation based on the [provider's Kodi add-on](https://kodi.fastshare.cloud/addons/plugin.video.fastshare/) and observed free-download forms. Provider APIs and limits may change. See [Ingress](https://developers.home-assistant.io/docs/apps/presentation/), [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/), [custom cards](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/) and [Google app passwords](https://support.google.com/accounts/answer/185833).
