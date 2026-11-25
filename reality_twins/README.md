# Czech This View Publisher

A Home Assistant app for a numbered Instagram photo queue. A timed event in a selected Home Assistant calendar publishes the next post. Dragging a card changes the order and renames its image and caption together: `0001__example.jpg` + `0001__example.txt`.

- Home Assistant Ingress interface with saved English/Czech language selection.
- Folder scanning, validated paired image/TXT upload, full-image previews, caption editing and keyboard-accessible ordering.
- Existing Home Assistant calendars, plus an optional internal schedule.
- Sign in on the real Instagram website in an app-owned browser, with local photo upload and no public domain requirement.
- Complete Instagram verification in that browser and reuse its private profile after restart.
- Choose a mounted import folder; stable photo/TXT pairs are copied into the queue once, without changing source files.
- Optional official Instagram API connection for Creator and Business accounts.
- Persistent publication history, crash recovery and manual review of ambiguous results.

Install from [Jirkas-prog/home-assistant-addons](https://github.com/Jirkas-prog/home-assistant-addons), then select **Czech This View Publisher** in the Home Assistant app store. The app starts empty with publishing paused.

Open **Settings → Instagram → Open Instagram sign-in**, complete the real Instagram page, then verify the displayed account. The browser runs inside the app, so the same private session is available for scheduled posts. The dashboard and browser view stay behind Home Assistant Ingress. Instagram may request further verification or change its web interface. See [setup, calendar and recovery instructions](DOCS.md).

Version 0.4.1 improves account recognition for current Instagram profile navigation and supports the `Post` creation entry point. Browser sign-in and automatic folder import are available in Settings. Existing working direct/API connections remain available as advanced alternatives. The technical slug, calendar, queue and existing `reality_twins` data paths remain unchanged. Automated tests cover queue integrity, scheduling, authorization and simulated publishing; they do not establish that a real account login or publication has been verified.
