# Changelog

## 0.7.0

- changed the default and all public repository documentation to English;
- added persistent English/Czech interface selection under Add-on Settings;
- added server-side localization so the selected language is applied before the page loads;
- translated the standalone viewer and all Home Assistant add-on metadata;
- changed fresh-install defaults to `/share/Websites`, `MyBrowser/Downloads`, and **MyBrowser Guide**;
- retained migration recognition for the earlier Czech guide slug;
- translated server, Chromium, archive, upload, and validation messages to English;
- strengthened port allocation in the integration tests.

## 0.6.0

- replaced the original HTML proxy in the main workspace with a real Chromium session;
- external and hosted websites now load their original CSS, images, JavaScript, cookies, and forms;
- added back/forward history, reload, and navigation by URL or search phrase;
- forwarded clicks, scrolling, keyboard input, and JavaScript dialogs to Chromium;
- added local file selection for forms inside the active website;
- made the Chromium profile persistent and stored downloads in a shared folder;
- made the live Chromium viewport responsive and released sessions on close.

## 0.5.1

- moved the three-dot menu from the preview into the right-hand information column;
- placed the favorite star directly below that menu.

## 0.5.0

- expanded the Files tab into a full file browser;
- added folders and breadcrumb navigation;
- added file downloads and file/folder rename;
- added individual and bulk selection;
- added bulk copy, move, and delete;
- added current-folder search and destination browsing;
- validated website roots, name collisions, and invalid self-nesting operations.

## 0.4.0

- added card menus for Home visibility, settings, copy, separate opening, offline archive, and removal;
- added MyBrowser gateway, custom public gateway, and dedicated-port access modes;
- started uploads immediately after files are dropped and continued them safely in the background;
- added concurrent website creation with per-job percentage progress;
- added integrated web search and “Make available offline” for the active page.

## 0.3.2

- removed the experimental-stage marker from the add-on manifest.

## 0.3.1

- embedded the main icon directly in the UI for reliable Home Assistant Ingress loading;
- verified image endpoints through complete Ingress paths;
- added a one-time bundled guide website;
- remembered guide deletion so it would not be recreated.

## 0.3.0

- added a configurable public gateway with an individual path for every website;
- added transparent HTTP and WebSocket proxying for npm/Bun applications;
- opened hosted and external websites inside the MyBrowser workspace;
- replaced live iframe previews with stored 1900 × 1069 PNG captures;
- refreshed automatic previews only after website files changed;
- included Chromium and visual brand assets in the Docker image;
- migrated existing dedicated-port websites without losing their configuration.

## 0.2.3

- uploaded large files through Home Assistant Ingress in 2 MB chunks;
- displayed real upload progress and percentage values;
- retried interrupted chunks up to three times.

## 0.2.2

- fixed icon loading under Home Assistant Ingress without a trailing slash;
- replaced the empty-state letter with the MyBrowser icon;
- used the same safe Ingress path for favicon and Apple Touch icon.

## 0.2.1

- made Server Management replace the primary sidebar instead of adding a second sidebar;
- restored normal navigation when leaving server management;
- redesigned the sidebar and fixed long-name overflow.

## 0.2.0

- renamed the add-on to MyBrowser;
- added website cards, previews, views, favorites, manual ordering, and external links;
- added optional ad blocking and immutable historical offline versions;
- protected the proxy from private and local network access;
- separated the library from technical server management;
- added numbered managed folders and cover-image uploads.

## 0.1.0

- first functional release;
- hosted static and SPA websites;
- added npm and Bun runtimes, dependency installation, and build scripts;
- added multiple websites, autostart, files, processes, logs, and settings through Home Assistant Ingress;
- restricted paths to `/share`, `/media`, and the add-on's public `/config`.
