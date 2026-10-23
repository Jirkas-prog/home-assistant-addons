# MyBrowser

MyBrowser is a Home Assistant panel for device setup pages. Keep the original web interfaces of your local devices, external services, and hosted websites together in a persistent tab strip. Brave runs inside the add-on and renders the live pages without rewriting their HTML or device API requests.

English is used by default. Open **Edit panel → Interface language** to choose English or Czech. This setting, saved links, pins, and tab order survive restarts and upgrades.

On a fresh installation, **MyBrowser Guide** appears in the library. It is a real hosted website with a short introduction to uploads, previews, the public gateway, and server management. You can edit or permanently remove it.

## Quick start

1. Enable **Show in sidebar** on the Home Assistant add-on page. Open MyBrowser, then **Edit panel → Add device or website**. Enter a name and an HTTP/HTTPS address such as `http://device.local/`.
2. Leave **Pinned** checked to put the page in the top strip. Drag tabs or use their arrow buttons in edit mode to set the order. **Done** returns to normal use, where there are no close or reorder controls.
3. Click a tab to use the original device interface. Switching tabs does not reload it or discard an unfinished form during the current Brave runtime. This is not a promise to restore unsaved forms after restarting the add-on or a browser crash.
4. **Library** also opens saved but unpinned pages. Unpinning keeps the saved link and offline history. Existing favorites are pinned once on upgrade; favorites and pins are independent after that.
5. **Edit panel → Add hosted website** opens the upload workflow. A managed website receives a numbered folder such as `/share/Websites/001_WebsiteName` and a gateway address such as `http://HOME_ASSISTANT_IP:3000/website-name/`. Keep the management page open until background uploads finish. Return to the setup panel to pin the new website.
6. **Library and hosting management → Server management** retains startup, settings, logs, and the file browser with folders, bulk operations, and downloads.

## Availability and offline use

Green means the add-on received an HTTP response from the site's web server; red means there was no successful connection. Gray means not checked yet. The tooltip includes the check time and HTTP status when available. Authentication responses, redirects, and HTTP error pages still count as a responding server, not proof that every device feature works.

Checks use `HEAD /` on the saved URL's origin, never its path or query string. Results are shared for 30 seconds with at most four checks in parallel per request. Checking availability does not refresh the visible page or run a device command. Invalid TLS certificates are not silently accepted.

No internet connection is required for LAN devices while Home Assistant and the device remain reachable on the local network. Pages that depend on external resources can still need internet access. **Save a copy** creates a separate historical archive; **Saved copy** displays a clearly labeled, read-only reference. Scripts, forms, links, and automatic redirects are disabled in this panel view. An unavailable device cannot be controlled from a saved copy. Dynamic data and authenticated pages may be incomplete because the archive downloader does not inherit Brave cookies.

## Sessions and access

The browser engine is the bundled Brave/Selkies runtime, not an external Brave add-on or a direct cross-origin iframe of the device. The setup panel uses kiosk/fullscreen mode; layout controls belong to MyBrowser's edit mode.

There is currently one shared Brave desktop and login profile. Two simultaneous viewers can change the same active page. Use one active operator at a time; independent per-user browser sessions are not implemented. Edit mode prevents accidental layout changes, but is not authorization. Keep access limited to trusted Home Assistant users; this add-on's panel remains administrator-only.

The **Copy address** action copies the original website URL, not a temporary Home Assistant ingress token. Direct LAN links in another dashboard require a client that can reach that address. A permanent deep-link integration for individual tabs is not included.

A static server expects `index.html`. An npm or Bun project expects `package.json` and a configured script. Brave downloads are stored in `/share/MyBrowser/Downloads`.

## Important notes

- Ad blocking targets known sources but cannot guarantee removal of every advertisement.
- Saving an offline copy does not emulate the device, its API, or its hardware.
- The public gateway and optional dedicated ports use HTTP and are directly available on the LAN.
- Private and local links are enabled by default so Home Assistant, LAN, and VPN services work. Disable `allow_private_links` if MyBrowser is used by people who must not be able to fetch internal addresses.
- The Brave desktop is available only through Home Assistant Ingress. Its Selkies and DevTools ports are bound to loopback inside the add-on.
- Port 3000 is the default public gateway; port 8099 is reserved for management.
- Run only trusted npm and Bun projects.

See the repository `README.md` for full documentation.
