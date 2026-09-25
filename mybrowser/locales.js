'use strict';

const CS_REPLACEMENTS = [
  ["Logs", "Logy"],
  ["Search", "Hledat"],
  ["${entries.length} of ${currentFileEntries.length} items", "${entries.length} z ${currentFileEntries.length} položek"],
  ["aria-label=\"Select ${esc(entry.name)}\"", "aria-label=\"Vybrat ${esc(entry.name)}\""],
  ["Change the storage and limit values on the add-on Configuration tab, then restart MyBrowser.", "Hodnoty úložiště a limitů změňte na kartě Konfigurace add-onu a restartujte MyBrowser."],
  ["Remove “${item.name}” from MyBrowser?", "Odebrat web „${item.name}“ z MyBrowseru?"],
  ["Also delete folder ${item.path}?", "Smazat také složku ${item.path}?"],
  ["The item was removed.", "Položka byla odebrána."],
  ["The link was copied.", "Odkaz byl zkopírován."],
  ["Cover image preview", "Náhled úvodního obrázku"],
  ["hosted websites running", "hostovaných webů běží"],
  ["offline versions", "offline verzí"],
  ["Public custom gateway address", "Veřejná adresa vlastní brány"],
  ["Internal port", "Interní port"],
  ["Back to MyBrowser", "Zpět do MyBrowseru"],
  ["Existing path", "Existující cesta"],
  ["npm project", "npm projekt"],
  ["Bun project", "Bun projekt"],
  ["Build script", "Build skript"],
  ["Start script", "Spouštěcí skript"],
  ["Choose image", "Vybrat obrázek"],
  ["JPG, PNG, WebP, GIF, or AVIF", "JPG, PNG, WebP, GIF nebo AVIF"],
  ["Access", "Přístup"],
  ["Source", "Zdroj"],
  ["Servers", "Servery"],
  ["Saving…", "Ukládám…"],
  ["Forward", "Vpřed"],
  ["Back", "Zpět"],
  ["Moved", "Přesunuto"],
  ["Copied", "Zkopírováno"],
  ["Deleted", "Odstraněno"],
  ["upload failed", "nahrávání selhalo"],
  [
    "Interface language",
    "Jazyk rozhraní"
  ],
  [
    "English",
    "Angličtina"
  ],
  [
    "Czech",
    "Čeština"
  ],
  [
    "Uploading starts immediately after files are dropped. You can close this dialog as soon as the website is created.",
    "Nahrávání začne okamžitě po přetažení. Dialog můžete zavřít hned po vytvoření webu."
  ],
  [
    "Add a hosted website or an external link. Hidden items remain available under Hosted and Links.",
    "Přidejte hostovanou stránku nebo externí odkaz. Skryté položky zůstávají v částech Hostované a Odkazy."
  ],
  [
    "Chromium is not available in this installation. Reinstall the add-on from the latest release.",
    "Chromium není v této instalaci dostupné. Přeinstalujte add-on z aktuálního release."
  ],
  [
    "Every download creates a new historical version without overwriting earlier copies.",
    "Každé stažení vytváří novou historickou verzi a nepřepisuje předchozí."
  ],
  [
    "The folder structure is preserved and files are uploaded into the currently open folder.",
    "Struktura složek zůstane zachována a soubory se nahrají do právě otevřené složky."
  ],
  [
    "The link was saved. Its preview is loading in the background.",
    "Odkaz byl uložen. Náhled se načítá na pozadí."
  ],
  [
    "A new offline download has started. Earlier versions will be preserved.",
    "Stahování nové offline verze začalo. Starší verze zůstanou zachované."
  ],
  [
    "The website was added to the library and its offline version is being prepared.",
    "Web byl přidán do knihovny a jeho offline verze se připravuje."
  ],
  [
    "Change these values on the add-on Configuration tab, then restart MyBrowser.",
    "Hodnoty změňte na kartě Konfigurace add-onu a restartujte MyBrowser."
  ],
  [
    "Remove “${link.name}” and all of its offline versions?",
    "Odebrat odkaz „${link.name}“ včetně všech jeho offline verzí?"
  ],
  [
    "Remove “${item.name}” including its offline versions?",
    "Odebrat odkaz „${item.name}“ včetně offline verzí?"
  ],
  [
    "Delete ${paths.length} ${paths.length===1?'item':'items'}? This action cannot be undone.",
    "Opravdu odstranit ${paths.length} ${paths.length===1?'položku':'položek'}? Tuto akci nelze vrátit."
  ],
  [
    "Preview, view statistics, ad blocking, and historical offline copies.",
    "Náhled, statistiky, omezení reklam a historické offline kopie."
  ],
  [
    "Static, npm, and Bun servers hosted on this Home Assistant instance.",
    "Statické, npm a Bun servery na tomto Home Assistantu."
  ],
  [
    "External websites with previews, ad filtering, and an offline archive.",
    "Externí weby s náhledy, filtrem reklam a offline archivem."
  ],
  [
    "Host a website directly or save it as an external link.",
    "Web můžete hostovat přímo, nebo uložit jako externí odkaz."
  ],
  [
    "Choose the website location, files, and cover image.",
    "Zvolte umístění, soubory webu a jeho úvodní obrázek."
  ],
  [
    "MyBrowser loads the page title, description, and available image.",
    "MyBrowser načte titulek, popis a dostupný obrázek stránky."
  ],
  [
    "Drop website files or an entire folder",
    "Přetáhněte soubory nebo celou složku webu"
  ],
  [
    "Drop files or an entire folder",
    "Přetáhněte soubory nebo celou složku"
  ],
  [
    "Drop a website cover image",
    "Přetáhněte úvodní obrázek webu"
  ],
  [
    "Files are uploaded to the selected path after the website is created.",
    "Soubory se po vytvoření nahrají do uvedené cesty."
  ],
  [
    "It appears on the home page and in the website library.",
    "Zobrazí se na homepage a v knihovně webů."
  ],
  [
    "Block ads in MyBrowser and offline copies",
    "Omezovat reklamy v MyBrowseru a offline kopii"
  ],
  [
    "Drag cards into your preferred order.",
    "Přetáhněte karty do požadovaného pořadí."
  ],
  [
    "Drag cards to arrange them manually.",
    "Přetáhněte karty do vlastního pořadí."
  ],
  [
    "Automatically sorted alphabetically.",
    "Automaticky seřazeno podle abecedy."
  ],
  [
    "Opens results directly in MyBrowser · Enter",
    "Otevře výsledky přímo v MyBrowseru · Enter"
  ],
  [
    "Loading a full browser session.",
    "Načítám plnohodnotnou relaci prohlížeče."
  ],
  [
    "The offline archive is available for external websites.",
    "Offline archiv je určený pro externí webové stránky."
  ],
  [
    "No offline version has been created yet.",
    "Zatím nebyla vytvořena žádná offline verze."
  ],
  [
    "Open the destination folder and select “Paste here”.",
    "Otevřete cílovou složku a zvolte „Vložit sem“."
  ],
  [
    "There are no matching items in this folder.",
    "V této složce nejsou žádné odpovídající položky."
  ],
  [
    "Files can optionally be deleted for a managed folder.",
    "U spravované složky lze volitelně smazat i soubory."
  ],
  [
    "Website “${job.site.name}” finished uploading.",
    "Nahrávání webu „${job.site.name}“ bylo dokončeno."
  ],
  [
    "Finishing website “${job.site.name}” failed: ${error.message}",
    "Dokončení webu „${job.site.name}“ selhalo: ${error.message}"
  ],
  [
    "An address already routed to this website through your own reverse proxy.",
    "Adresa, kterou už směrujete na tento web přes vlastní reverse proxy."
  ],
  [
    "Add to the home page",
    "Přidat na domovskou obrazovku"
  ],
  [
    "Remove from the home page",
    "Odebrat z domovské obrazovky"
  ],
  [
    "The item was added to Home.",
    "Položka byla přidána na Domů."
  ],
  [
    "The item was removed from Home.",
    "Položka byla odebrána z Domů."
  ],
  [
    "Remove from MyBrowser…",
    "Odebrat z MyBrowseru…"
  ],
  [
    "All your websites in one place",
    "Vaše weby na jednom místě"
  ],
  [
    "Add a website or change your search.",
    "Přidejte web nebo změňte hledání."
  ],
  [
    "Add a static website or an npm/Bun project.",
    "Přidejte statickou stránku nebo npm/Bun projekt."
  ],
  [
    "The website is available and its process is running.",
    "Web je dostupný a proces běží."
  ],
  [
    "The website is ready but is not currently running.",
    "Web je připravený, ale nyní neběží."
  ],
  [
    "The website could not be started: ",
    "Web se nepodařilo spustit: "
  ],
  [
    "Opened inside MyBrowser",
    "Otevření uvnitř MyBrowseru"
  ],
  [
    "The process is not running",
    "Proces právě neběží"
  ],
  [
    "The process is active",
    "Proces je aktivní"
  ],
  [
    "Technical information",
    "Technické informace"
  ],
  [
    "waiting for the first capture",
    "čeká na první zachycení"
  ],
  [
    "waiting for an update",
    "čeká na aktualizaci"
  ],
  [
    "Dependency installation started.",
    "Instalace byla spuštěna."
  ],
  [
    "The build started.",
    "Sestavení bylo spuštěno."
  ],
  [
    "The action was completed.",
    "Akce byla provedena."
  ],
  [
    "Another upload is already in progress",
    "Jiné nahrávání ještě probíhá"
  ],
  [
    "The server connection failed during upload",
    "Spojení se serverem během nahrávání selhalo"
  ],
  [
    "The upload was interrupted",
    "Nahrávání bylo přerušeno"
  ],
  [
    "Preparing upload",
    "Připravuji nahrávání"
  ],
  [
    "Uploading in the background",
    "Nahrávání na pozadí"
  ],
  [
    "Upload failed: ",
    "Nahrávání selhalo: "
  ],
  [
    "Uploaded · waiting for website creation",
    "Nahráno · čeká na vytvoření webu"
  ],
  [
    "some files could not be uploaded",
    "část souborů se nepodařilo nahrát"
  ],
  [
    "Files are uploaded",
    "Soubory jsou nahrané"
  ],
  [
    "uploading and startup continue in the background.",
    "nahrávání a spuštění pokračuje na pozadí."
  ],
  [
    "Settings were saved.",
    "Nastavení bylo uloženo."
  ],
  [
    "The link and its offline archive were removed.",
    "Odkaz a jeho offline archiv byly odstraněny."
  ],
  [
    "The offline version was removed.",
    "Offline verze byla odstraněna."
  ],
  [
    "Delete this historical offline version?",
    "Odstranit tuto jedinou historickou offline verzi?"
  ],
  [
    "The hosted website is not running. Its management page was opened.",
    "Hostovaný web neběží. Otevřela se jeho správa."
  ],
  [
    "The cover image must be JPG, PNG, WebP, GIF, or AVIF",
    "Úvodní obrázek musí být JPG, PNG, WebP, GIF nebo AVIF"
  ],
  [
    "Default website folder",
    "Výchozí složka webů"
  ],
  [
    "Upload file limit",
    "Limit nahraného souboru"
  ],
  [
    "Offline version limit",
    "Limit offline verze"
  ],
  [
    "Public custom gateway address",
    "Veřejná adresa vlastní brány"
  ],
  [
    "Enter the public custom gateway address.",
    "Zadejte veřejnou adresu vlastní brány."
  ],
  [
    "No files have been selected yet.",
    "Zatím nejsou vybrané žádné soubory."
  ],
  [
    "Automatically from the page",
    "Automaticky podle stránky"
  ],
  [
    "Add to favorites",
    "Přidat mezi oblíbené"
  ],
  [
    "Open settings",
    "Přejít do nastavení"
  ],
  [
    "Copy link",
    "Zkopírovat odkaz"
  ],
  [
    "Open separately",
    "Otevřít zvlášť"
  ],
  [
    "Save offline",
    "Uložit offline"
  ],
  [
    "More options",
    "Další možnosti"
  ],
  [
    "Favorite order was saved.",
    "Pořadí oblíbených bylo uloženo."
  ],
  [
    "Nothing here yet",
    "Nic tu zatím není"
  ],
  [
    "Add a link first",
    "Nejdřív přidejte odkaz"
  ],
  [
    "New offline version",
    "Nová offline verze"
  ],
  [
    "Downloading now…",
    "Stahování právě probíhá…"
  ],
  [
    "Server management",
    "Správa serverů"
  ],
  [
    "No matching server.",
    "Žádný odpovídající server."
  ],
  [
    "All servers are stopped",
    "Všechny servery jsou zastavené"
  ],
  [
    "No hosted website",
    "Žádný hostovaný web"
  ],
  [
    "managed folder",
    "spravovaná složka"
  ],
  [
    "existing project",
    "existující projekt"
  ],
  [
    "Primary address",
    "Hlavní adresa"
  ],
  [
    "Server overview",
    "Přehled serveru"
  ],
  [
    "Server status",
    "Stav serveru"
  ],
  [
    "Website views",
    "Zobrazení webu"
  ],
  [
    "Automatic startup",
    "Automatický start"
  ],
  [
    "Manual startup",
    "Ruční start"
  ],
  [
    "Custom public gateway",
    "Vlastní veřejná brána"
  ],
  [
    "Dedicated network port",
    "Samostatný síťový port"
  ],
  [
    "New folder",
    "Nová složka"
  ],
  [
    "Choose files",
    "Vybrat soubory"
  ],
  [
    "Choose file…",
    "Vybrat soubor…"
  ],
  [
    "Choose files…",
    "Vybrat soubory…"
  ],
  [
    "Choose folder",
    "Vybrat složku"
  ],
  [
    "Clear selection",
    "Vymazat výběr"
  ],
  [
    "Search this folder…",
    "Hledat v této složce…"
  ],
  [
    "Select all",
    "Vybrat vše"
  ],
  [
    "Move",
    "Přesunout"
  ],
  [
    "Copy",
    "Kopírovat"
  ],
  [
    "Rename",
    "Přejmenovat"
  ],
  [
    "Download",
    "Stáhnout"
  ],
  [
    "New folder name:",
    "Název nové složky:"
  ],
  [
    "New name:",
    "Nový název:"
  ],
  [
    "The folder was created.",
    "Složka byla vytvořena."
  ],
  [
    "The item was renamed.",
    "Položka byla přejmenována."
  ],
  [
    "Logs and packages",
    "Logy a balíčky"
  ],
  [
    "Process, installation, and build output.",
    "Výstup procesu, instalace a sestavení."
  ],
  [
    "Install dependencies",
    "Instalovat závislosti"
  ],
  [
    "Clear log",
    "Vymazat log"
  ],
  [
    "No log entries yet.",
    "Zatím bez záznamů."
  ],
  [
    "Remove hosted website",
    "Odebrat hostovaný web"
  ],
  [
    "Start script",
    "Spouštěcí skript"
  ],
  [
    "Start automatically",
    "Automaticky spustit"
  ],
  [
    "Remove website ${site.name}?",
    "Odebrat web ${site.name}?"
  ],
  [
    "Also delete folder ${site.path}?",
    "Smazat také složku ${site.path}?"
  ],
  [
    "The website was removed.",
    "Web byl odebrán."
  ],
  [
    "The website was created",
    "Web byl vytvořen"
  ],
  [
    "Search your library or the web…",
    "Hledat v knihovně nebo na webu…"
  ],
  [
    "Search the web",
    "Hledat na webu"
  ],
  [
    "Go to or search",
    "Přejít na nebo hledat"
  ],
  [
    "Results: ",
    "Výsledky: "
  ],
  [
    "Add to MyBrowser",
    "Přidat do MyBrowseru"
  ],
  [
    "Hosted website",
    "Hostovaný web"
  ],
  [
    "A static/SPA website or a project started with npm or Bun.",
    "Statický/SPA web nebo projekt spuštěný přes npm či Bun."
  ],
  [
    "Website link",
    "Odkaz na web"
  ],
  [
    "New hosted website",
    "Nový hostovaný web"
  ],
  [
    "Website address",
    "Adresa webu"
  ],
  [
    "Custom name (optional)",
    "Vlastní název (volitelné)"
  ],
  [
    "Remove link",
    "Odebrat odkaz"
  ],
  [
    "Save link",
    "Uložit odkaz"
  ],
  [
    "Add-on settings",
    "Nastavení add-onu"
  ],
  [
    "Values from the Home Assistant Configuration tab.",
    "Hodnoty z karty Konfigurace Home Assistantu."
  ],
  [
    "Custom gateway",
    "Vlastní brána"
  ],
  [
    "MyBrowser gateway (default)",
    "Brána MyBrowseru (výchozí)"
  ],
  [
    "MyBrowser gateway",
    "Brána MyBrowseru"
  ],
  [
    "Custom port",
    "Vlastní port"
  ],
  [
    "The address is generated from the website name.",
    "Adresa se vytvoří z názvu webu."
  ],
  [
    "New folder path",
    "Cesta nové složky"
  ],
  [
    "New default folder",
    "Nová výchozí složka"
  ],
  [
    "Existing folder",
    "Existující složka"
  ],
  [
    "Create website",
    "Vytvořit web"
  ],
  [
    "Cover image",
    "Úvodní obrázek"
  ],
  [
    "Automatic preview",
    "Automatický náhled"
  ],
  [
    "Custom image",
    "Vlastní obrázek"
  ],
  [
    "Offline archive",
    "Offline archiv"
  ],
  [
    "Hosted websites",
    "Hostované weby"
  ],
  [
    "Website links",
    "Webové odkazy"
  ],
  [
    "Favorites",
    "Oblíbené"
  ],
  [
    "More websites",
    "Další weby"
  ],
  [
    "All websites",
    "Všechny weby"
  ],
  [
    "Add your first website",
    "Přidat první web"
  ],
  [
    "Library",
    "Knihovna"
  ],
  [
    "Starting Chromium…",
    "Spouštím Chromium…"
  ],
  [
    "Page content rendered by Chromium",
    "Obsah stránky vykreslený Chromiem"
  ],
  [
    "Keyboard input for Chromium",
    "Vstup klávesnice pro Chromium"
  ],
  [
    "Chromium reported an error",
    "Chromium hlásí chybu"
  ],
  [
    "Make available offline",
    "Zpřístupnit offline"
  ],
  [
    "Preparing offline version",
    "Offline verze se připravuje"
  ],
  [
    "Server is running",
    "Server běží"
  ],
  [
    "Server is stopped",
    "Server je zastaven"
  ],
  [
    "Updated",
    "Aktualizováno"
  ],
  [
    "WebsiteName",
    "Názevwebu"
  ],
  [
    "existing-project",
    "existující-projekt"
  ],
  [
    "Gateway on port",
    "Brána na portu"
  ],
  [
    "Move",
    "Přesun"
  ],
  [
    "Copying",
    "Kopírování"
  ],
  [
    "Paste here",
    "Vložit sem"
  ],
  [
    "Preparing",
    "Připravuji"
  ],
  [
    "Completed",
    "Dokončeno"
  ],
  [
    "Finishing website…",
    "Dokončuji web…"
  ],
  [
    "Uploading in the background",
    "Nahrávám na pozadí"
  ],
  [
    "Uploading…",
    "Nahrávám…"
  ],
  [
    "Uploading ",
    "Nahrávám "
  ],
  [
    "Uploaded",
    "Nahráno"
  ],
  [
    "cancelled",
    "zrušeno"
  ],
  [
    "New website",
    "Nový web"
  ],
  [
    "New server",
    "Nový server"
  ],
  [
    "Search servers…",
    "Hledat server…"
  ],
  [
    "servers running",
    "servery běží"
  ],
  [
    "server running",
    "server běží"
  ],
  [
    "hosted websites",
    "hostované weby"
  ],
  [
    "hosted website",
    "hostovaný web"
  ],
  [
    "Start",
    "Spustit"
  ],
  [
    "Restart",
    "Restartovat"
  ],
  [
    "Stop",
    "Zastavit"
  ],
  [
    "Startup",
    "Spouštění"
  ],
  [
    "automatic",
    "automatické"
  ],
  [
    "manual",
    "ruční"
  ],
  [
    "Overview",
    "Přehled"
  ],
  [
    "Files",
    "Soubory"
  ],
  [
    "Settings",
    "Nastavení"
  ],
  [
    "Path",
    "Cesta"
  ],
  [
    "Address",
    "Adresa"
  ],
  [
    "Preview",
    "Náhled"
  ],
  [
    "custom image",
    "vlastní obrázek"
  ],
  [
    "automatic",
    "automatický"
  ],
  [
    "enabled",
    "zapnutý"
  ],
  [
    "disabled",
    "vypnutý"
  ],
  [
    "check the log",
    "zkontrolujte log"
  ],
  [
    "root",
    "kořen"
  ],
  [
    "items",
    "položek"
  ],
  [
    "item",
    "položku"
  ],
  [
    "selected",
    "vybráno"
  ],
  [
    "Folder",
    "Složka"
  ],
  [
    "File",
    "Soubor"
  ],
  [
    "Link",
    "Odkaz"
  ],
  [
    "Other",
    "Jiné"
  ],
  [
    "Size",
    "Velikost"
  ],
  [
    "Modified",
    "Změněno"
  ],
  [
    "Name",
    "Název"
  ],
  [
    "Type",
    "Typ"
  ],
  [
    "Delete",
    "Odstranit"
  ],
  [
    "Build",
    "Sestavit"
  ],
  [
    "Installation",
    "Instalace"
  ],
  [
    "Build",
    "Sestavení"
  ],
  [
    "Public gateway",
    "Veřejná brána"
  ],
  [
    "automatic previews",
    "automatické náhledy"
  ],
  [
    "available",
    "aktivní"
  ],
  [
    "unavailable",
    "nedostupné"
  ],
  [
    "Browser",
    "Prohlížeč"
  ],
  [
    "downloads",
    "stažené soubory"
  ],
  [
    "Loading library…",
    "Načítám knihovnu…"
  ],
  [
    "Loading…",
    "Načítám…"
  ],
  [
    "Loading",
    "Načítám"
  ],
  [
    "Refresh",
    "Obnovit"
  ],
  [
    "Add",
    "Přidat"
  ],
  [
    "Home",
    "Domů"
  ],
  [
    "Hosted",
    "Hostované"
  ],
  [
    "Links",
    "Odkazy"
  ],
  [
    "Cancel",
    "Zrušit"
  ],
  [
    "Done",
    "Hotovo"
  ],
  [
    "Save",
    "Uložit"
  ],
  [
    "Edit link",
    "Upravit odkaz"
  ],
  [
    "New link",
    "Nový odkaz"
  ],
  [
    "READY",
    "PŘIPRAVENO"
  ],
  [
    "DOWNLOADING",
    "STAHUJI"
  ],
  [
    "ERROR",
    "CHYBA"
  ],
  [
    "Error",
    "Chyba"
  ],
  [
    "unknown",
    "neznámá"
  ],
  [
    "filtered",
    "odfiltrováno"
  ],
  [
    "files",
    "souborů"
  ],
  [
    "files",
    "soubory"
  ],
  [
    "file",
    "soubor"
  ],
  [
    "views",
    "zobrazení"
  ],
  [
    "last",
    "naposledy"
  ],
  [
    "blocked",
    "omezené"
  ],
  [
    "allowed",
    "povolené"
  ],
  [
    "ads",
    "reklamy"
  ],
  [
    "ADS",
    "REKLAMY"
  ],
  [
    "Running",
    "Běží"
  ],
  [
    "Starting",
    "Spouští se"
  ],
  [
    "Stopping",
    "Zastavuje se"
  ],
  [
    "Stopped",
    "Vypnuto"
  ],
  [
    "Static / SPA",
    "Statický / SPA"
  ],
  [
    "Custom gateway ·",
    "Vlastní brána ·"
  ],
  [
    "not configured",
    "nenastavená"
  ],
  [
    "Gateway ·",
    "Brána ·"
  ],
  [
    "Custom port ",
    "Vlastní port "
  ],
  [
    "MyBrowser icon",
    "Ikona MyBrowseru"
  ]
];

function localizeUi(source, language) {
  if (language !== 'cs') return source;
  let result = source;
  for (const [english, czech] of [...CS_REPLACEMENTS].sort((a, b) => b[0].length - a[0].length)) {
    // Single words are common inside JavaScript identifiers (for example
    // responseType and uploadFile). Translate them only when they are complete
    // string values or standalone HTML labels so application code stays intact.
    if (/^[A-Za-z]+$/.test(english)) {
      for (const quote of ["'", '"', '`']) {
        result = result.split(`${quote}${english}${quote}`).join(`${quote}${czech}${quote}`);
      }
      for (const prefix of ['', '＋ ', '← ', '↗ ', '× ']) {
        result = result.split(`>${prefix}${english}<`).join(`>${prefix}${czech}<`);
      }
      continue;
    }
    result = result.split(english).join(czech);
  }
  return result.replace('<html lang="en">', '<html lang="cs">');
}

module.exports = { localizeUi };
