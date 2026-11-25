# Czech This View Publisher

Publish one prepared Instagram photo post at the start of each timed event in a selected Home Assistant calendar. Drag queue cards to change their order; the image and matching caption file are renamed together.

New installations are paused. Direct Instagram login and Home Assistant calendars are the defaults. No calendar or Instagram account is selected automatically.

## Install on Home Assistant OS

The package declares aarch64 and amd64 architectures. Raspberry Pi 5 with 64-bit Home Assistant OS uses aarch64.

1. Open **Settings → Apps → Install app**, or **Settings → Add-ons → Add-on store** on older versions.
2. In the store menu, choose **Repositories** and add `https://github.com/Jirkas-prog/home-assistant-addons` if it is not already listed.
3. Reload the store and install **Czech This View Publisher**. The first build requires internet access to download the Python base image and dependencies.
4. Keep `queue_dir` set to `/share/reality_twins/PLANNED` and `timezone` set to `Europe/Prague`, or configure another shared queue folder and IANA time zone. A host computer's drive path is not a container path.
5. Start the app and open its web interface. Enable its sidebar entry if desired.

The name changed in 0.2.0. The repository, technical slug `reality_twins` and data directories remain unchanged; update the existing app to retain its queue, settings and history.

Management traffic uses Ingress on port 8099. The `homeassistant_api` permission allows calendar reads through the Supervisor proxy; its token stays on the server. Direct login needs no public port mapping, domain or reverse proxy. Protection mode can remain enabled.

For local development, copy the entire `reality_twins` directory to the device's local apps folder, for example `/addons/reality_twins`, and reload the store. A Samba or SSH app must have access to that folder. This is separate from `/config/custom_components`.

## Standalone Docker

Home Assistant Container does not include the Supervisor app store. Use the compose.yaml distributed with this source bundle for standalone operation:

~~~console
docker compose up -d --build
docker compose logs --tail=100
~~~

Open [http://localhost:8099](http://localhost:8099) on the Docker host. Private state is stored in ./data and shared files in ./share. Both host ports bind to 127.0.0.1 by default. Use an SSH tunnel or an authenticated internal proxy for remote management rather than exposing the dashboard publicly.

The built-in Home Assistant calendar connection requires a Supervisor token supplied by Home Assistant OS. The standalone package can use the explicit internal scheduler instead; it does not read a remote Home Assistant calendar automatically.

After source changes, run the Compose build command again. Back up data and share together. Do not include either directory in a public repository or release package.

## Prepare the queue

Place copies of final JPEG/PNG posts and their caption files in PLANNED, or upload them through the dashboard. Captions are UTF-8 text. Each image needs one unambiguous matching caption: either the same stem with .txt, or the same stem followed by __caption.txt.

~~~text
0001__church__WORLD-CZECHIA.jpg
0001__church__WORLD-CZECHIA__caption.txt
0002__butterfly__AI-SLOP-REALITY.png
0002__butterfly__AI-SLOP-REALITY.txt
~~~

The app discovers files periodically and offers a manual scan. Drag cards to reorder them. It updates numeric prefixes such as 0001__ and 0002__ on both image and caption; descriptive filename parts remain. Do not rename or overwrite files concurrently in another application while reordering.

Keep original photographs and any other application's catalogued output folders outside the managed queue. Reordering is a real filesystem operation. Use a dedicated directory of copies, not another workflow's recorded source files.

Instagram receives a separate JPEG copy. The publishing path checks image size and aspect ratio and prepares sRGB data. It does not invent a caption or change the scene. The shared image preparation accepts ratios from 4:5 to 1.91:1, a width of at least 320 pixels and a prepared JPEG smaller than 8 MB.

## Connect Instagram directly

1. Select the direct connection method in the app's Instagram settings.
2. Enter the username and password for the intended account and start the connection.
3. If Instagram requests two-factor authentication, enter its current verification code. The pending login expires after ten minutes; start again if it expires.
4. If an account checkpoint is required, complete it in the official Instagram app or website, then reconnect here.
5. Check the displayed account, queue and next calendar event before enabling publishing.

This connection uploads image data directly from the app. It needs no public domain, Meta application or Creator/Business account. It uses the [unofficial instagrapi client](https://github.com/subzeroid/instagrapi); Instagram can request revalidation or limit automated access.

The password stays only in memory during login and, if needed, the pending two-factor step. It is not saved to disk. The authenticated session is stored in private app data and reused after restart. Expired or rejected sessions require a new login. Account verification and upload failures are shown in the dashboard rather than handled by repeated blind login or publication attempts.

## Optional official Instagram API

The advanced official connection is separate from direct login. It requires an Instagram **Creator or Business** account, a Meta application and public HTTPS for media and the OAuth callback. Instagram Login does not require a linked Facebook Page. For this method, enter the Instagram password only on Instagram's authorization page.

1. Create a Meta application with the Instagram product and Instagram Login in [Meta for Developers](https://developers.facebook.com/). Add the account you own or manage as an app user/tester and accept any tester invitation in Instagram.
2. Configure public HTTPS as described below. Register its exact OAuth redirect URI in Meta: the public base URL followed by /oauth/callback.
3. Select the official connection method, then enter the public media base URL, Instagram App ID and Instagram App Secret. Keep the secret on the device; do not put it in Git or screenshots.
4. Start the Instagram connection, sign in to the intended account, and grant instagram_business_basic and instagram_business_content_publish.
5. After returning, verify the displayed account. Review the queue and calendar before enabling the scheduler.

Accounts owned or managed by the app owner and added in Meta can use Standard Access. Serving other people's accounts requires the corresponding Advanced Access and Meta review.

Manual connection accepts a valid long-lived **Instagram User access token** for the same Instagram Login flow. Facebook Page and obsolete Basic Display tokens are not interchangeable. Long-lived tokens need renewal before expiry. Revoked permissions or an expired token require reconnection. The app must be running to execute publishing and renewal work.

### Public HTTPS for the official method

Meta downloads each photo from a URL. A local path, private network address or authenticated Home Assistant Ingress URL cannot provide that download. This section is unnecessary for direct login.

| Port | Purpose | Access |
| --- | --- | --- |
| 8099 | Queue, calendar and settings | Home Assistant Ingress or local administration |
| 8098 | Temporary media links, OAuth callback and endpoint identity check | Public HTTPS reverse proxy |

For Home Assistant, assign the optional 8098/tcp container port to a free host port, then point an existing HTTPS reverse proxy at it. Host mapping is disabled initially. Do not forward port 8099 to the internet.

For Compose, port 8098 binds to the Docker host's loopback. A proxy running in another container needs a shared Docker network or another appropriate route. This Caddy example applies only when Caddy runs directly on the same host as Compose:

~~~caddyfile
ig-media.example.com {
    reverse_proxy 127.0.0.1:8098
}
~~~

Replace the example domain with your own domain, DNS and public HTTPS. Set https://your-domain.example as the app's public base URL and register https://your-domain.example/oauth/callback in Meta. Do not use an /api/hassio_ingress/ address.

The public listener provides only a limited endpoint identity response, the OAuth callback and unguessable time-limited image links. It does not provide the queue dashboard, account settings or directory listings. OAuth callbacks require a valid one-use login state. Meta must be able to access images without an additional proxy login.

Before enabling publication through the official connection, the app checks that the HTTPS address reaches this installation's media listener. Verify the first real publication to confirm Meta's download and account permissions.

## Use an existing Home Assistant calendar

Select **Home Assistant** as the schedule source. The app loads available calendar entities through the Supervisor. Choose the existing calendar entity intended for publication.

If no calendar exists, add **Local calendar** under **Settings → Devices & services → Add integration**, give it a name, then refresh the app's calendar list. See the [Home Assistant Local calendar guide](https://www.home-assistant.io/integrations/local_calendar/).

For one post daily at 16:00, create a **timed event with daily recurrence**, starting at 16:00 in the intended time zone, such as Europe/Prague. Each event start consumes one item from the front of the queue. All-day events are ignored. Event titles are shown for orientation and do not select a particular photograph.

Edit event times and recurrence in Home Assistant or the original calendar provider. This app only reads them. Use a calendar dedicated to publication so ordinary appointments do not become posting instructions.

Check upcoming events, time zone, account and queue before enabling publication. If Home Assistant cannot provide the selected calendar, the app must not switch silently to the internal schedule.

The scheduler checks a short due-time window. It does not replay a day's backlog after a long outage. Keep the app running for scheduled starts; inspect history before adding replacement events after an interruption.

## Optional internal schedule

The internal weekly and one-off scheduler is an explicit alternative. Select it only if you want this app to manage times itself. Its initial rule is daily at 16:00 in Europe/Prague; it is not a second concurrent source while Home Assistant is selected.

Weekly times use an IANA time zone. Nonexistent local times during a spring clock change are skipped; the first occurrence is used when an autumn change repeats an hour. A 16:00 rule stays at the same local time across seasonal changes.

## Publication results and recovery

An attempt is recorded before sending. A known successful post is removed from the active queue and retained with history and archived files. If the response is ambiguous, automatic retry is blocked.

When an attempt requires review, inspect the Instagram profile. Record either the verified post URL or a note confirming it was not published before returning it to the queue. A network error does not prove publication failed.

Missing files, invalid captions, rejected sessions and Instagram processing errors can block the queue. Resolve the reported problem before continuing.

## Backups and updates

Back up `/data` and the queue/archive directory together. Private state includes authenticated sessions, so protect backups as account access. Pause scheduling, preserve those directories, update the app, then check the account, queue and next event before resuming.

## Validation scope

Automated checks cover queue integrity, scheduling, request authorization and simulated publication. They do not verify a real Instagram login or post. Validate the intended account connection and first authorized publication on the target installation.

## Technical references

- [Home Assistant local apps and repositories](https://contributors.home-assistant.io/apps/how-apps-work/)
- [Home Assistant app configuration](https://contributors.home-assistant.io/apps/reference/configuration/)
- [Home Assistant Ingress](https://contributors.home-assistant.io/apps/guides/ingress/)
- [Supervisor API access](https://contributors.home-assistant.io/apps/guides/communication/)
- [Home Assistant calendar REST API](https://contributors.home-assistant.io/core/internals/rest-api/)
- [instagrapi documentation and session persistence](https://github.com/subzeroid/instagrapi)
- [Instagram Login and token lifecycle](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Instagram photo specifications](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Instagram container state](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container)
- [Instagram publish responses](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish)
