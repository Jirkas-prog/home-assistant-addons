# Home Assistant Add-ons

Custom add-ons for Home Assistant. This repository contains **Fakturocel** and **MyBrowser**.

## Add this repository to Home Assistant

1. Open **Settings → Add-ons → Add-on Store**.
2. Open the menu and select **Repositories**.
3. Add `https://github.com/Jirkas-prog/home-assistant-addons`.
4. Select the add-on you want to install.

## Fakturocel

Fakturocel is a self-hosted invoicing application with invoices and quotes, annual reports, PDF and encrypted Excel export, archived-document reprinting, encrypted backups, calculators, review tasks, and a visual invoice-template editor.

It starts with an empty database and contains no personal business data. English is the default interface language; Czech can be selected under **Settings and data → Language**, and the preference is stored with the application data. See the [Fakturocel documentation](fakturocel/DOCS.md) for installation, configuration, backup, recovery, and security details.

## MyBrowser

MyBrowser is a personal website library, historical offline archive, full Brave desktop, and manager for small web servers. Its card-based home page presents hosted websites and saved links with previews, favorites, ordering, and visit statistics.

English is the default language. Open **Server Management → Add-on Settings → Interface language** to switch the entire MyBrowser interface to Czech. The preference is stored in the add-on data and survives restarts and upgrades.

## Features

- one library for hosted websites and external links;
- website previews, view counters, and last-visit timestamps;
- favorites with drag-and-drop ordering;
- automatic alphabetical ordering for other items;
- a persistent full Brave desktop for external links, hosted websites, and web searches;
- optional blocking of known advertising sources for each link;
- immutable historical offline versions with common images, styles, fonts, and scripts;
- static/SPA servers and npm or Bun projects;
- immediate drag-and-drop uploads that continue in the background;
- file browser with folders, search, downloads, rename, copy, move, and bulk deletion;
- automatic startup for selected hosted websites;
- a removable **MyBrowser Guide** website created once on a fresh installation;
- English and Czech user interfaces.

## Installation

The recommended installation method is the custom repository described above. For a manual installation:

1. Copy the `mybrowser` directory to `/addons/mybrowser` on Home Assistant OS.
2. Reload the Add-on Store.
3. Install the local **MyBrowser** add-on.
4. Adjust `/share/Websites`, the public gateway port, and upload/archive limits on the **Configuration** tab if needed.
5. Start the add-on, enable automatic startup, and open its Web UI.

A package produced by `package.ps1` extracts to `/addons/mybrowser` with `config.yaml` and `Dockerfile` directly inside that directory.

## Library and favorites

The **Add** button provides two choices:

- **Hosted website** — a static/SPA website or an npm/Bun project.
- **Website link** — an external HTTP/HTTPS page with automatically loaded title, description, Open Graph image, or favicon.

The star adds an item to Favorites. Favorite cards can be reordered by dragging them on Home or the Favorites page. Non-favorite items are sorted alphabetically according to the selected interface language.

The three-dot menu can hide an item from Home without deleting it, open settings, copy its address, open it separately, save it offline, or remove it completely. Hidden items remain available under **Hosted** or **Links**.

## Brave browser and ad blocking

External links and hosted websites open inside a complete Brave desktop streamed by Selkies. This is the normal browser UI with tabs, its own address bar, browser settings, extensions, cookies, sign-ins, downloads, clipboard, audio, and standard Chromium rendering. The desktop is embedded behind Home Assistant Ingress; its internal streaming and DevTools ports are loopback-only.

MyBrowser can open cards and searches directly in the active Brave tab through the local DevTools interface. The Brave profile is persistent. Downloads are stored in `/share/MyBrowser/Downloads`; the exact path is shown in MyBrowser settings.

Brave provides its normal Shields protection while browsing. The **Block ads** option also filters known advertising resources and containers when MyBrowser creates an offline version. This is a practical filter rather than a guarantee that every advertisement is removed.

## Offline archive

**Save offline** creates a new immutable historical version. MyBrowser stores the main HTML document and common images, stylesheets, fonts, and scripts. Links to other pages remain external. Dynamic applications that depend on APIs, authentication, DRM, or service workers may not be fully available offline.

Every download receives its own directory. Older versions remain available until they are individually deleted. Offline pages cannot make network requests and open in a sandboxed viewer.

The default per-version limit is 100 MB and can be changed with `max_archive_mb`. There is no automatic retention period.

## Hosted websites

Hosted website management is available under **Server Management**:

- a static server expects `index.html` and can use SPA fallback;
- an npm/Bun project expects `package.json` and a configured start script;
- the default public address uses the shared gateway, for example `http://192.168.0.234:3000/my-website/`;
- a custom public reverse-proxy URL or a dedicated port can be selected instead;
- npm/Bun projects behind the gateway receive an internal `PORT`, `HOST=127.0.0.1`, `HOSTNAME=127.0.0.1`, and `BASE_PATH=/my-website/`;
- dedicated-port projects receive `HOST=0.0.0.0`;
- dependencies can be installed and projects built from the Logs tab;
- large uploads are split into smaller chunks for Home Assistant Ingress and display real percentage progress;
- a custom card image can be uploaded, otherwise MyBrowser captures a static 1900 × 1069 PNG preview after files change.

On a fresh installation, MyBrowser creates a normal managed website named **MyBrowser Guide**. It demonstrates the gateway, uploads, previews, startup, and the integrated browser. It can be edited or removed; removal is remembered and the guide is not recreated automatically.

Accessible storage roots are `/share`, `/media`, and the add-on's public `/config`. The default `/share/Websites` directory can be changed in add-on configuration.

## Network and security

MyBrowser uses `host_network: true`. The shared public gateway uses port `3000` by default and can be changed with `gateway_port`. Port `8099` is reserved for the management Ingress. Websites using dedicated ports can listen on user-selected ports from 1024 through 65535. Brave uses internal loopback ports `6080`–`6082` and `9221`; they are not exposed as public add-on ports.

Private and local links are allowed by default so addresses on LAN, Tailscale/VPN, localhost, and Home Assistant itself can be added, previewed, and archived. Set `allow_private_links: false` on the add-on Configuration tab to restore public-internet-only metadata and offline fetching. Keep MyBrowser limited to trusted Home Assistant users while private access is enabled.

Hosted websites do not automatically receive authentication or HTTPS. Expose them only inside a trusted LAN/VPN or place your own reverse proxy in front of them. npm and Bun projects are executable code with access to the add-on's mapped folders; run only trusted projects.

## Development and verification

```powershell
cd D:\03_Projekty\30_MyBrowser\mybrowser
npm test

cd ..
.\package.ps1
```

The test suite covers static, npm, and Bun hosting; uploads; file operations; favorites and ordering; private-link metadata; ad filtering; view counters; preserved offline versions; Brave Ingress path rewriting; icon loading; localization preference persistence; and one-time guide installation.
