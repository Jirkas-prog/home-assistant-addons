# Reality Twins Publisher

A Home Assistant app for a numbered Instagram photo queue. A timed event in a selected Home Assistant calendar publishes the next post. Dragging a card changes the order and renames its image and caption together: `0001__example.jpg` + `0001__example.txt`.

- Home Assistant Ingress interface with saved English/Czech language selection.
- Folder scanning, image upload, caption editing and keyboard-accessible ordering.
- Existing Home Assistant calendars, plus an optional internal schedule.
- Official Instagram Login for Creator and Business accounts.
- Persistent publication history, crash recovery and manual review of ambiguous results.

Install from `https://github.com/Jirkas-prog/home-assistant-addons`, then select **Reality Twins Publisher** in the Home Assistant app store. The app starts empty with publishing paused.

Instagram setup requires a professional account, a Meta developer app and a public HTTPS media endpoint. The dashboard remains behind Home Assistant Ingress. See [setup, calendar and recovery instructions](DOCS.md).

Version 0.1.0 is an initial experimental release. Automated tests cover queue integrity, scheduling, authorization and simulated publishing. A real Instagram publication still requires configured credentials and verification on the target account.
