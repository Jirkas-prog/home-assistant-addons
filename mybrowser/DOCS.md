# MyBrowser

MyBrowser combines a personal website library, historical offline archive, full Chromium browser, and management for static, npm, and Bun servers.

English is used by default. To use Czech, open **Server Management → Add-on Settings** and change **Interface language** to **Czech**. The preference is saved immediately and the interface reloads automatically.

On a fresh installation, **MyBrowser Guide** appears in the library. It is a real hosted website with a short introduction to uploads, previews, the public gateway, and server management. You can edit or permanently remove it.

## Quick start

1. Select **Add**, then choose a hosted website or an external link. A hosted website receives a numbered path such as `/share/Websites/001_WebsiteName` and a gateway address such as `http://IP:3000/website-name/`. Drop website files into the left panel and an optional custom cover image into the right panel.
2. Click a card to open the website inside a full Chromium session in the main workspace. CSS, JavaScript, forms, cookies, history, keyboard input, scrolling, and file selection remain available. Use the star to mark favorites and drag favorite cards to reorder them.
3. External links can block known advertising sources and create any number of immutable offline versions. Older versions are never overwritten.
4. Configure hosted websites under **Server Management**. The regular sidebar is replaced with a website list while the selected server remains visible in the main workspace.
5. Use the **Files** tab to create folders, filter content, download or rename files, and copy, move, or delete multiple selected items.

A static server expects `index.html`. An npm or Bun project expects `package.json` and a configured script. Downloads from Chromium are stored in `MyBrowser/Downloads` next to the default `Websites` folder.

## Important notes

- Ad blocking targets known sources but cannot guarantee removal of every advertisement.
- Dynamic or authenticated websites may not be complete in an offline version.
- The public gateway and optional dedicated ports use HTTP and are directly available on the LAN.
- Port 3000 is the default public gateway; port 8099 is reserved for management.
- Run only trusted npm and Bun projects.

See the repository `README.md` for full documentation.
