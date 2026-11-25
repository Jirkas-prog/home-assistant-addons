# Czech This View Publisher

A Home Assistant app for a numbered Instagram photo queue. A timed event in a selected Home Assistant calendar publishes the next post. Dragging a card changes the order and renames its image and caption together: `0001__example.jpg` + `0001__example.txt`.

- Home Assistant Ingress interface with saved English/Czech language selection.
- Folder scanning, validated paired image/TXT upload, full-image previews, caption editing and keyboard-accessible ordering.
- Existing Home Assistant calendars, plus an optional internal schedule.
- Direct Instagram login and local photo upload, with no public domain or Meta app requirement.
- Two-factor codes and private session reuse after restart.
- Optional official Instagram API connection for Creator and Business accounts.
- Persistent publication history, crash recovery and manual review of ambiguous results.

Install from [Jirkas-prog/home-assistant-addons](https://github.com/Jirkas-prog/home-assistant-addons), then select **Czech This View Publisher** in the Home Assistant app store. The app starts empty with publishing paused.

Sign in directly inside the app using your Instagram username, password and a two-factor code if requested. Direct login does not require a professional account. It uses the unofficial instagrapi client; Instagram can request verification or restrict automated access. The dashboard remains behind Home Assistant Ingress. See [setup, calendar and recovery instructions](DOCS.md).

Version 0.3.0 introduces a compact angular interface, photo/caption previews, clearer import feedback and complete selected-week calendar loading. The technical slug and existing `reality_twins` data paths remain unchanged. Automated tests cover queue integrity, scheduling, authorization and simulated publishing; they do not establish that a real account login or publication has been verified.
