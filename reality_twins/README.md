# Czech This View Publisher

A Home Assistant app for a numbered Instagram photo queue. A timed event in a selected Home Assistant calendar publishes the next post. Dragging a card changes the order and renames its image and caption together: `0001__example.jpg` + `0001__example.txt`.

- Home Assistant Ingress interface with saved English/Czech language selection.
- Folder scanning, validated paired image/TXT upload, full-image previews, caption editing and keyboard-accessible ordering.
- Existing Home Assistant calendars, plus an optional internal schedule.
- Publish the next queued post immediately as an extra post, without changing calendar times or the scheduler's paused/enabled state.
- Sign in on the real Instagram website in an app-owned browser, with local photo upload and no public domain requirement.
- Complete Instagram verification in that browser and reuse its private profile after restart.
- Choose a mounted import folder; stable photo/TXT pairs are copied into the queue once, without changing source files.
- Optional official Instagram API connection for Creator and Business accounts.
- Persistent publication history, crash recovery and manual review of ambiguous results.
- Optional companion Stories with a full-post card on a gradient background, editable English labels and a read-only preview.
- Add `/nostory` to an event's description to skip its Story while publishing the feed post normally.
- Create a missing Story for an already-published post from History, with a separate receipt and no repeated feed publication.

Install from [Jirkas-prog/home-assistant-addons](https://github.com/Jirkas-prog/home-assistant-addons), then select **Czech This View Publisher** in the Home Assistant app store. The app starts empty with publishing paused.

Open **Settings → Instagram → Open Instagram sign-in**, complete the real Instagram page, then verify the displayed account. The browser runs inside the app, so the same private session is available for scheduled posts. The dashboard and browser view stay behind Home Assistant Ingress. Instagram may request further verification or change its web interface. See [setup, calendar and recovery instructions](DOCS.md).

The navy-to-teal interface supports desktop and narrow screens. **Publish next now** sends one extra post without moving calendar events. Companion Stories use the same private browser session and have their own result in History. Existing direct/API connections remain advanced alternatives for feed posts. The technical slug, calendar, queue and existing `reality_twins` data paths remain unchanged. Automated tests cover queue integrity, scheduling, authorization and simulated publishing; they do not establish that a real account login or publication has been verified.
