'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, view: 'queue', dragging: null, editing: null, resolving: null, busy: 0, loading: false, weekOffset: 0, connected: false, calendars: null, calendarsLoading: false, settingsDirty: false, calendarDirty: false, methodDirty: false, directChallenge: false, language: savedLanguage() };
const days = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const english = {
  'Přejít na obsah': 'Skip to content', 'Czech This View — fronta': 'Czech This View — queue', 'PRACOVNÍ PROSTOR': 'WORKSPACE', 'Hlavní navigace': 'Main navigation', 'Fronta': 'Queue', 'FRONTA': 'QUEUE', 'fronta': 'queue', 'Kalendář': 'Calendar', 'KALENDÁŘ': 'CALENDAR', 'kalendář': 'calendar', 'Historie': 'History', 'HISTORIE': 'HISTORY', 'historie': 'history', 'Nastavení': 'Settings', 'NASTAVENÍ': 'SETTINGS', 'nastavení': 'settings', 'Připojuji rozhraní': 'Connecting to server', 'VAŠE FOTKY. VÁŠ RYTMUS.': 'YOUR PHOTOS. YOUR RHYTHM.', 'Instagram nepřipojen': 'Instagram not connected', 'Jazyk rozhraní': 'Interface language',
  'INSTAGRAM / AUTOMATICKÉ PUBLIKOVÁNÍ': 'INSTAGRAM / AUTOMATIC PUBLISHING', 'Připraveno. Seřazeno.': 'Ready. In order.', 'Ve správný čas.': 'At the right time.', 'Přesuň příspěvky do pořadí. Zbytek převezme tvůj kalendář.': 'Arrange your posts. Let your calendar handle the timing.', 'Načítání…': 'Loading…', 'Stav publikování': 'Publishing status', 'PŘÍŠTÍ PUBLIKOVÁNÍ': 'NEXT PUBLISHING SLOT', 'Čekám na plán': 'Waiting for a schedule', 'PŘIPRAVENO VE FRONTĚ': 'POSTS IN QUEUE', 'příspěvků': 'posts', 'příspěvek': 'post', 'Pořadí podle čísel souborů': 'Ordered by numbered filenames', 'INSTAGRAM ÚČET': 'INSTAGRAM ACCOUNT', 'Nepřipojen': 'Not connected', 'Propoj účet v nastavení': 'Connect your account in Settings',
  'Publikační fronta': 'Publishing queue', 'Pořadí měň přetažením nebo šipkami. Fotka i její TXT se přejmenují společně.': 'Drag posts or use the arrows. Photos and their TXT files are renamed together.', 'Načíst složku': 'Scan folder', 'Přidat příspěvky': 'Add posts', 'Načítání složky…': 'Loading folder…', 'Seřazené příspěvky': 'Ordered posts', 'Tady začíná další příspěvek.': 'Your next post starts here.', 'Přidej hotové fotografie a popisky jako TXT se stejným názvem.': 'Add finished photos and captions as TXT files with matching names.', 'Soubory dostanou pořadí 0001, 0002, 0003…': 'Files will be numbered 0001, 0002, 0003…', 'Přidat první příspěvky': 'Add your first posts', 'V každém termínu se publikuje jeden příspěvek z čela fronty. Zveřejněné příspěvky najdeš v historii.': 'Each slot publishes one post from the front of the queue. Published posts appear in History.',
  'Kalendář Home Assistantu': 'Home Assistant calendar', 'Začátek události ve vybraném kalendáři publikuje jeden příspěvek.': 'The start of an event in your selected calendar publishes one post.', 'Předchozí týden': 'Previous week', 'Další týden': 'Next week', 'Dnes': 'Today', 'Jeden kalendář. Jedna fronta.': 'One calendar. One queue.', 'Události i opakování upravuj ve svém kalendáři v Home Assistantu.': 'Edit events and recurrence in your Home Assistant calendar.', 'Kalendář pro Instagram': 'Calendar for Instagram', 'Načítání kalendářů…': 'Loading calendars…', 'Použít tento kalendář': 'Use this calendar', 'Obnovit seznam kalendářů': 'Refresh calendars', 'Například vytvoř událost v 16:00 s opakováním každý den. Použij samostatný kalendář pro příspěvky.': 'For example, create a daily recurring event at 16:00. Use a dedicated calendar for posts.', 'Týdenní kalendář': 'Weekly calendar', 'Zobrazené termíny odpovídají událostem načteným z Home Assistantu.': 'The displayed slots match events loaded from Home Assistant.', 'Pokročilé: vlastní plán uvnitř doplňku': 'Advanced: a schedule inside the add-on', 'Tato pravidla se použijí pouze při zdroji „Kalendář doplňku“ v nastavení.': 'These rules apply only when the schedule source is set to “Add-on calendar” in Settings.',
  'Pravidelný čas': 'Recurring time', 'Například každý den v 16:00.': 'For example, every day at 16:00.', 'Dny v týdnu': 'Days of the week', 'Po': 'Mon', 'Út': 'Tue', 'St': 'Wed', 'Čt': 'Thu', 'Pá': 'Fri', 'So': 'Sat', 'Ne': 'Sun', 'PO': 'MON', 'ÚT': 'TUE', 'ST': 'WED', 'ČT': 'THU', 'PÁ': 'FRI', 'SO': 'SAT', 'NE': 'SUN', 'Čas publikování': 'Publishing time', 'Přidat pravidlo': 'Add rule', 'Jednorázový termín': 'One-time slot', 'Jeden konkrétní den a čas.': 'A specific date and time.', 'Datum a čas': 'Date and time', 'Přidat termín': 'Add slot', 'Časové pásmo': 'Time zone', 'Uložit pásmo': 'Save time zone', 'Pravidelné časy respektují letní a zimní čas.': 'Recurring times follow daylight saving time changes.',
  'Historie publikování': 'Publishing history', 'Co se odeslalo, kdy a s jakým výsledkem.': 'What was sent, when, and with what result.', 'První záznam teprve přijde.': 'Your first entry is still ahead.', 'Zde uvidíš výsledky automatického publikování a odkazy na Instagram.': 'Publishing results and Instagram links will appear here.', 'Spojení a nastavení': 'Connection and settings', 'Jednou propojit. Potom spravovat svůj obsah.': 'Connect once. Then manage your content.', 'Účet zatím není propojený.': 'No account connected yet.', 'Oficiální připojení podporuje účty': 'The official connection supports', 'Creator a Business': 'Creator and Business accounts', '. Přihlašování probíhá na Instagramu.': '. Sign-in happens on Instagram.', 'Propojit Instagram ↗': 'Connect Instagram ↗', 'Ověřit spojení': 'Check connection', 'Odpojit účet': 'Disconnect account', 'Nejdřív vyplň nastavení připojení.': 'Complete the connection settings first.', 'V Meta aplikaci povol Instagram Login a jako přesměrování nastav adresu zobrazenou vpravo.': 'Enable Instagram Login in your Meta app and set the redirect URI shown in the connection settings.',
  'Nastavení připojení': 'Connection settings', 'Údaje ze své aplikace v Meta for Developers.': 'Details from your app in Meta for Developers.', 'ID Instagram aplikace': 'Instagram app ID', 'Nezadáno': 'Not set', 'Prázdné pole ponechá uloženou hodnotu.': 'Leave blank to keep the saved value.', 'Veřejná HTTPS adresa médií': 'Public HTTPS media URL', 'Meta odsud načítá fotky. Směřuj ji na veřejný port doplňku, nikoli na rozhraní Home Assistantu.': 'Meta fetches photos from this address. Route it to the add-on’s public port, not the Home Assistant interface.', 'Nejdřív zadej veřejnou adresu': 'Enter the public URL first', 'Verze Instagram API': 'Instagram API version', 'Zdroj plánu': 'Schedule source', 'Kalendář doplňku — pokročilé': 'Add-on calendar — advanced', 'Vyber kalendář': 'Select a calendar', 'Při zdroji Home Assistant vyber kalendář určený pro publikování.': 'For the Home Assistant source, select the calendar dedicated to publishing.', 'Připojit pomocí existujícího tokenu': 'Connect with an existing token', 'Token se nikdy nezobrazuje': 'The token is never displayed', 'Alternativa k přihlášení. Prázdné pole token nezmění.': 'An alternative to sign-in. Leave blank to keep the current token.', 'Uložit nastavení': 'Save settings', 'Čekám na data': 'Waiting for data',
  'TEXT PŘÍSPĚVKU': 'POST CAPTION', 'Upravit popisek': 'Edit caption', 'Zavřít': 'Close', 'Popisek na Instagram': 'Instagram caption', 'Napiš popisek příspěvku…': 'Write your post caption…', 'Uloží se do odpovídajícího TXT souboru.': 'Saved to the matching TXT file.', 'Zrušit': 'Cancel', 'Uložit popisek': 'Save caption', 'OVĚŘENÍ VÝSLEDKU': 'VERIFY RESULT', 'Co se stalo na Instagramu?': 'What happened on Instagram?', 'Nejdřív otevři svůj profil a zkontroluj, zda byl tento příspěvek zveřejněn. Doplněk ho při nejasném výsledku znovu neposílá.': 'First check your profile to see whether this post was published. The add-on does not resend a post with an uncertain result.', 'Výsledek kontroly': 'Verified result', 'Příspěvek je zveřejněný': 'The post was published', 'Příspěvek se určitě nezveřejnil': 'The post definitely was not published', 'Odkaz na zveřejněný příspěvek': 'Link to the published post', 'Poznámka k ověření': 'Verification note', 'Jak jsi ověřil, že příspěvek není zveřejněný?': 'How did you verify that the post was not published?', 'Profil jsem zkontroloval a uvedený výsledek potvrzuji.': 'I checked the profile and confirm this result.', 'Uložit ověřený výsledek': 'Save verified result',
  'PŘIPRAVENO': 'READY', 'PUBLIKUJE SE': 'PUBLISHING', 'ZVEŘEJNĚNO': 'PUBLISHED', 'CHYBA': 'ERROR', 'OVĚŘIT VÝSLEDEK': 'VERIFY RESULT', 'ZPRACOVÁNÍ': 'PROCESSING', 'PŘIPRAVUJE SE': 'PREPARING', 'Tvůj kalendář.': 'Your calendar.', 'Tvůj publikační rytmus.': 'Your publishing rhythm.', 'Začátek události v Home Assistantu převezme další příspěvek z fronty.': 'A Home Assistant event starts the next post in your queue.', 'Každý příspěvek.': 'Every post.', 'Každý výsledek.': 'Every result.', 'Přehled zveřejnění a případných chyb bez hledání v souborech.': 'Publishing results and errors without searching through files.', 'Jedno spojení.': 'One connection.', 'Všechno připravené.': 'Ready to go.', 'Přihlas Instagram a vyber kalendář pro své příspěvky.': 'Sign in to Instagram and choose a calendar for your posts.',
  'Zavřít oznámení': 'Dismiss notification', 'Server neodpověděl včas. Obnov stav, než akci zopakuješ.': 'The server did not respond in time. Refresh the status before repeating the action.', 'Akci se nepodařilo dokončit.': 'The action could not be completed.', 'Rozhraní je připojené': 'Connected to server', 'Spojení se přerušilo': 'Connection interrupted', 'STAV NEMUSÍ BÝT AKTUÁLNÍ': 'STATUS MAY BE OUT OF DATE', 'Přidej první fotografie a popisky': 'Add your first photos and captions', 'Bez termínu': 'No slot scheduled', 'publikování pozastaveno': 'publishing paused', 'Přidej čas v kalendáři': 'Add a time in the calendar', 'Pozastavit publikování': 'Pause publishing', 'Zapnout publikování': 'Enable publishing', 'Oficiální Instagram připojení': 'Official Instagram connection',
  'Přetáhnout příspěvek; pro klávesnici použij šipky vedle něj': 'Drag the post; use the adjacent arrows with a keyboard', 'Popisek zatím není přidaný.': 'No caption added yet.', 'DALŠÍ NA ŘADĚ': 'NEXT IN QUEUE', 'Upravit text': 'Edit caption', 'Příspěvek je znovu připravený ve frontě.': 'The post is ready in the queue again.', 'Znovu připravit příspěvek po chybě': 'Make the post ready again after an error', 'Pořadí uložené. Názvy fotek i popisků jsou aktualizované.': 'Order saved. Photo and caption filenames have been updated.', 'Kalendář doplňku': 'Add-on calendar', 'Pravidelné časy i jednotlivé termíny. Každý slot = jeden příspěvek.': 'Recurring and one-time slots. Each slot publishes one post.', 'Zobrazeny jsou pouze termíny načtené z Home Assistantu. Události i jejich opakování upravuj tam.': 'Only slots loaded from Home Assistant are displayed. Edit events and recurrence there.', 'Zobrazená pravidla pocházejí z interního plánu doplňku.': 'The displayed rules come from the add-on’s internal schedule.', 'Pravidelně': 'Recurring', 'Jednorázově': 'One-time', 'Každý den': 'Every day', 'Termín pozastaven.': 'Slot paused.', 'Termín zapnut.': 'Slot enabled.', 'Termín odstraněn.': 'Slot removed.', 'Odstranit termín': 'Remove slot', 'Příspěvek': 'Post', 'Otevřít na Instagramu ↗': 'Open on Instagram ↗', 'Ověřit výsledek': 'Verify result', 'Uloženo — ponech prázdné pro zachování': 'Saved — leave blank to keep', 'Token je uložený': 'Token is saved',
  'Home Assistant zatím neposkytuje žádný kalendář. Nejdřív přidej kalendář v jeho integracích.': 'Home Assistant has no calendars yet. Add a calendar integration first.', 'Kalendáře nejsou dostupné': 'Calendars unavailable', 'Vyber kalendář pro příspěvky': 'Select a calendar for posts', 'Vyplň platné datum a čas.': 'Enter a valid date and time.', 'Tento místní čas při přechodu na letní čas neexistuje. Vyber jiný čas.': 'This local time does not exist during the daylight saving transition. Choose another time.', 'Nejdřív vyber kalendář Home Assistantu pro publikování.': 'First select a Home Assistant calendar for publishing.', 'Automatické publikování je zapnuté.': 'Automatic publishing is enabled.', 'Automatické publikování je pozastavené.': 'Automatic publishing is paused.', 'Složka je načtená.': 'Folder scanned.', 'Příspěvky jsou přidané do fronty.': 'Posts added to the queue.', 'Popisek uložen.': 'Caption saved.', 'Vyber alespoň jeden den.': 'Select at least one day.', 'Pravidelný čas přidán.': 'Recurring time added.', 'Vyber termín v budoucnosti.': 'Select a future date and time.', 'Jednorázový termín přidán.': 'One-time slot added.', 'Časové pásmo uložené.': 'Time zone saved.', 'Vyber kalendář pro příspěvky.': 'Select a calendar for posts.', 'Publikování bude řídit vybraný kalendář Home Assistantu.': 'The selected Home Assistant calendar will control publishing.', 'Nastavení uložené.': 'Settings saved.', 'Vlož HTTPS odkaz na příspěvek na Instagramu.': 'Enter an HTTPS link to the Instagram post.', 'Ověřený výsledek uložen.': 'Verified result saved.', 'Spojení bylo ověřeno.': 'Connection checked.', 'Instagram je odpojen.': 'Instagram disconnected.', 'Server vrátil neplatnou přihlašovací adresu.': 'The server returned an invalid sign-in URL.', 'Failed to fetch': 'Failed to fetch'
};
Object.assign(english, {
  'Průvodce nastavením': 'Setup checklist', 'PŘÍPRAVA K PUBLIKOVÁNÍ': 'PUBLISHING SETUP',
  'Čtyři kroky k prvnímu příspěvku': 'Four steps to your first post',
  'Tři kroky k prvnímu příspěvku': 'Three steps to your first post',
  'Nastavení je připravené': 'Setup is complete', 'Publikování je zapnuté': 'Publishing is enabled',
  'Zbývá dokončit nastavení': 'Finish the remaining setup steps', 'Hotovo': 'Done', 'Doplnit': 'Set up', 'Zkontrolovat': 'Check',
  'Počítají se pouze uložené údaje. Veřejná dostupnost HTTPS se ověří při zapnutí publikování.': 'Only saved settings count. Public HTTPS reachability is checked when publishing is enabled.',
  'Přehled vychází z uloženého nastavení a skutečného stavu fronty.': 'This checklist uses saved settings and the actual queue state.',
  'Nastavení samo nic nezveřejní. Až budeš připravený, zapni publikování nahoře.': 'Setup does not publish anything. Enable publishing above when you are ready.',
  'Vybraný HA kalendář je uložený. Termíny spravuj v Home Assistantu.': 'Your selected HA calendar is saved. Manage its events in Home Assistant.',
  'Vyber a ulož samostatný kalendář pro příspěvky.': 'Select and save a dedicated calendar for posts.',
  'Interní plán obsahuje zapnutý budoucí nebo opakovaný termín.': 'The internal schedule has an enabled future or recurring slot.',
  'Do interního plánu přidej zapnutý termín.': 'Add an enabled slot to the internal schedule.',
  'Otevřít kalendář': 'Open calendar', 'Nastavit kalendář': 'Set up calendar',
  'Veřejné HTTPS': 'Public HTTPS', 'HTTPS adresa je uložená. Její veřejná dostupnost ještě není tímto krokem potvrzená.': 'The HTTPS address is saved. This step does not confirm public reachability.',
  'Ulož veřejnou HTTPS adresu, ze které Instagram načte fotografie.': 'Save the public HTTPS address where Instagram can fetch photos.',
  'Upravit HTTPS': 'Edit HTTPS', 'Nastavit HTTPS': 'Set up HTTPS',
  'Poslední uložené ověření účtu potvrdilo připojení.': 'The last saved account check confirmed the connection.',
  'Připoj profesionální účet a ověř spojení v nastavení.': 'Connect a professional account and verify it in Settings.',
  'Přihlas Instagram v nastavení. Fotografie se odesílají přímo z Home Assistantu.': 'Sign in to Instagram in Settings. Photos are sent directly from Home Assistant.',
  'Uložená platnost přístupu skončila. Připojení je potřeba obnovit.': 'The saved access expiry has passed. Reconnect the account.',
  'Otevřít připojení': 'Open connection', 'Připojit účet': 'Connect account',
  'První příspěvek je připravený ve frontě.': 'The first post is ready in the queue.',
  'Příspěvek z čela fronty se právě publikuje.': 'The first post is currently being published.',
  'Přidej hotovou fotografii a její popisek.': 'Add a finished photo and its caption.',
  'První příspěvek vyžaduje kontrolu. Podrobnosti jsou ve frontě a historii.': 'The first post needs attention. Check the queue and history for details.',
  'Otevřít frontu': 'Open queue', 'Naplnit frontu': 'Add posts to queue',
  'Způsob připojení': 'Connection method', 'Přímé přihlášení z Home Assistantu': 'Direct sign-in from Home Assistant',
  'Oficiální Meta API — pokročilá alternativa': 'Official Meta API — advanced alternative',
  'Změna metody pozastaví publikování. Potom připoj účet zvoleným způsobem.': 'Changing the method pauses publishing. Then connect the account using the selected method.',
  'Použít zvolenou metodu': 'Use selected method', 'Home Assistant se přihlásí k Instagramu a fotografie odešle přímo ze své složky.': 'Home Assistant signs in to Instagram and uploads photos directly from its folder.',
  'Uživatelské jméno Instagramu': 'Instagram username', 'Heslo Instagramu': 'Instagram password',
  'Heslo se po odeslání formuláře vymaže.': 'The password field is cleared after submitting.',
  'Instagram vyžaduje dvoufázové ověření. Zadej aktuální kód z autentizační aplikace nebo SMS.': 'Instagram requires two-factor authentication. Enter the current code from your authenticator app or SMS.',
  'Ověřovací kód': 'Verification code', 'Přihlásit Instagram': 'Sign in to Instagram', 'Dokončit ověření': 'Complete verification',
  'Použít jiné přihlašovací údaje': 'Use different sign-in details', 'Nastavení publikování': 'Publishing settings',
  'Vyber kalendář, který bude řídit frontu.': 'Choose the calendar that will control the queue.',
  'Tato nastavení se používají pouze při uložené metodě Oficiální Meta API.': 'These settings apply only when the saved connection method is Official Meta API.',
  'Aktivní je přímé přihlášení. Veřejná HTTPS adresa není potřeba.': 'Direct sign-in is active. No public HTTPS address is required.',
  'Aktivní je Oficiální Meta API. Jeho nastavení najdeš v pokročilých možnostech.': 'Official Meta API is active. Its configuration is under advanced settings.',
  'Nejdřív ulož zvolenou metodu připojení.': 'Save the selected connection method first.',
  'Zvolená metoda už je aktivní.': 'The selected method is already active.', 'Metoda připojení uložená.': 'Connection method saved.',
  'Vyplň uživatelské jméno a heslo.': 'Enter your username and password.', 'Zadej ověřovací kód.': 'Enter the verification code.',
  'Instagram je připojený.': 'Instagram is connected.', 'Přihlášení zatím nebylo potvrzené.': 'Sign-in has not been confirmed yet.'
});
const sourceTexts = new WeakMap();
const sourceAttributes = new WeakMap();
const excludedTranslation = '.queue-filename,.queue-caption:not(.no-caption),.row-error,.history-row h3,.history-row p,.no-translate,#queue-path,#caption-filename,#resolve-filename,#caption-text,#resolve-note,#warnings,#account-error';

function savedLanguage() {
  try { return localStorage.getItem('reality-twins-language') === 'en' ? 'en' : 'cs'; } catch { return 'cs'; }
}

function translate(text) {
  if (state.language !== 'en') return text;
  if (Object.hasOwn(english, text)) return english[text];
  const patterns = [
    [/^AKTUALIZOVÁNO (.*)$/, 'UPDATED $1'], [/^První na řadě: (.*)$/, 'First in queue: $1'], [/^Přístup do (.*)$/, 'Access valid until $1'],
    [/^Stav se nepodařilo načíst\. (.*)$/, 'Unable to load status. $1'], [/^Požadavek se nezdařil \((.*)\)\.$/, 'Request failed ($1).'],
    [/^Příspěvek (\d+): (.*)$/, 'Post $1: $2'], [/^Náhled (.*)$/, 'Preview: $1'], [/^Posunout (.*) výše$/, 'Move $1 up'], [/^Posunout (.*) níže$/, 'Move $1 down'], [/^Upravit popisek (.*)$/, 'Edit caption for $1'],
    [/^Vypnout termín (.*)$/, 'Disable slot $1'], [/^Zapnout termín (.*)$/, 'Enable slot $1'], [/^Připojeno jako @(.*)$/, 'Connected as @$1'], [/^Kalendáře se nepodařilo načíst\. (.*)$/, 'Unable to load calendars. $1']
  ];
  for (const [pattern, replacement] of patterns) if (pattern.test(text)) return text.replace(pattern, replacement);
  if (/^(Po|Út|St|Čt|Pá|So|Ne)( · (Po|Út|St|Čt|Pá|So|Ne))*$/.test(text)) return text.split(' · ').map(day => english[day]).join(' · ');
  return text;
}

function applyLanguage(root = document.body) {
  if (!root) return;
  const nodes = root.nodeType === Node.TEXT_NODE ? [root] : [];
  if (root.nodeType !== Node.TEXT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    if (!node.parentElement || node.parentElement.closest(`script,style,textarea,${excludedTranslation}`)) continue;
    const current = node.nodeValue;
    if (!current.trim()) continue;
    let record = sourceTexts.get(node);
    if (!record || current !== record.last) record = { source: current, last: current };
    const source = record.source;
    const replacement = source.replace(source.trim(), translate(source.trim()));
    if (node.nodeValue !== replacement) node.nodeValue = replacement;
    record.last = replacement;
    sourceTexts.set(node, record);
  }
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('[aria-label],[title],[placeholder],[alt]')] : [];
  for (const node of elements) {
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (!node.hasAttribute(attr) || (node.matches('.queue-filename') && attr === 'title')) continue;
      let originals = sourceAttributes.get(node);
      if (!originals) { originals = {}; sourceAttributes.set(node, originals); }
      const current = node.getAttribute(attr);
      if (!(attr in originals) || current !== originals[attr].last) originals[attr] = { source: current, last: current };
      const value = translate(originals[attr].source);
      if (node.getAttribute(attr) !== value) node.setAttribute(attr, value);
      originals[attr].last = value;
    }
  }
  document.documentElement.lang = state.language;
}

function setLanguage(language) {
  state.language = language === 'en' ? 'en' : 'cs';
  try { localStorage.setItem('reality-twins-language', state.language); } catch { /* Session remains usable without local storage. */ }
  $$('[data-language]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.language === state.language)));
  navigate(state.view);
  render();
  applyLanguage();
  updateClock();
}
const statusLabels = { queued: 'PŘIPRAVENO', publishing: 'PUBLIKUJE SE', published: 'ZVEŘEJNĚNO', error: 'CHYBA', uncertain: 'OVĚŘIT VÝSLEDEK', claimed: 'ZPRACOVÁNÍ', container_created: 'PŘIPRAVUJE SE' };
const titles = {
  queue: ['FRONTA', 'Připraveno. Seřazeno.', 'Ve správný čas.', 'Přesuň příspěvky do pořadí. Zbytek převezme tvůj kalendář.'],
  calendar: ['KALENDÁŘ', 'Tvůj kalendář.', 'Tvůj publikační rytmus.', 'Začátek události v Home Assistantu převezme další příspěvek z fronty.'],
  history: ['HISTORIE', 'Každý příspěvek.', 'Každý výsledek.', 'Přehled zveřejnění a případných chyb bez hledání v souborech.'],
  settings: ['NASTAVENÍ', 'Jedno spojení.', 'Všechno připravené.', 'Přihlas Instagram a vyber kalendář pro své příspěvky.']
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function button(text, className, action, title) {
  const node = element('button', className, text);
  node.type = 'button';
  if (title) { node.title = title; node.setAttribute('aria-label', title); }
  node.addEventListener('click', action);
  return node;
}

function timezone() { return state.data?.schedule?.timezone || 'Europe/Prague'; }
function formatter(options = {}) { return new Intl.DateTimeFormat(state.language === 'en' ? 'en-GB' : 'cs-CZ', { timeZone: timezone(), ...options }); }
function formatDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try { return formatter({ day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', ...options }).format(date); }
  catch { return date.toLocaleString(state.language === 'en' ? 'en-GB' : 'cs-CZ'); }
}

function dateKey(date, zone = timezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toast(message, error = false) {
  const region = $('#toast-region');
  const box = element('div', `toast${error ? ' error' : ''}`);
  box.append(button('×', '', () => box.remove(), 'Zavřít oznámení'), document.createTextNode(message));
  region.append(box);
  window.setTimeout(() => box.remove(), error ? 10000 : 5000);
}

async function api(path, options = {}) {
  const headers = { 'X-RT-Language': state.language, ...options.headers };
  if (options.method && options.method !== 'GET') headers['X-RT-Request'] = '1';
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`api/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, headers, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((state.language === 'cs' ? data.error_cs : data.error) || data.error || data.detail || translate(`Požadavek se nezdařil (${response.status}).`));
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Server neodpověděl včas. Obnov stav, než akci zopakuješ.');
    throw error;
  } finally { window.clearTimeout(timer); }
}

async function run(action, trigger, success) {
  if (trigger?.disabled) return;
  if (trigger) trigger.disabled = true;
  state.busy++;
  try {
    const result = await action();
    if (success) toast(success);
    await loadState(true);
    return result;
  } catch (error) {
    toast(error.message || 'Akci se nepodařilo dokončit.', true);
    await loadState(true).catch(() => {});
    return null;
  } finally {
    state.busy--;
    if (trigger?.isConnected) trigger.disabled = false;
  }
}

async function loadState(force = false) {
  if (state.loading || (!force && (state.dragging || state.editing || state.resolving || state.busy))) return;
  state.loading = true;
  try {
    const data = await api('state');
    state.data = data;
    state.connected = true;
    $('#global-error').hidden = true;
    $('#connection-dot').className = 'dot cyan';
    $('#connection-label').textContent = 'Rozhraní je připojené';
    $('#sync-label').textContent = `AKTUALIZOVÁNO ${new Date().toLocaleTimeString(state.language === 'en' ? 'en-GB' : 'cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
    render();
  } catch (error) {
    state.connected = false;
    $('#connection-dot').className = 'dot red';
    $('#connection-label').textContent = 'Spojení se přerušilo';
    $('#global-error').textContent = `Stav se nepodařilo načíst. ${error.message}`;
    $('#global-error').hidden = false;
    $('#sync-label').textContent = 'STAV NEMUSÍ BÝT AKTUÁLNÍ';
  } finally { state.loading = false; }
}

function navigate(view) {
  if (!titles[view]) view = 'queue';
  state.view = view;
  $$('.view').forEach(node => { node.hidden = node.id !== `view-${view}`; });
  $$('.nav-item').forEach(node => {
    node.classList.toggle('active', node.dataset.view === view);
    if (node.dataset.view === view) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
    node.setAttribute('aria-label', titles[node.dataset.view][0].toLocaleLowerCase('cs-CZ'));
  });
  const [breadcrumb, first, second, description] = titles[view];
  $('#breadcrumb-view').textContent = breadcrumb;
  $('#page-title').replaceChildren(document.createTextNode(first), element('br'), element('span', '', second));
  $('#page-description').textContent = description;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'calendar') renderCalendar();
  if ((view === 'calendar' || view === 'settings') && !state.calendars) loadCalendars();
}

function badge(status) {
  return element('span', `status-badge ${Object.hasOwn(statusLabels, status) ? status : ''}`, statusLabels[status] || String(status || '—').toUpperCase());
}

function render() {
  const data = state.data;
  if (!data) return;
  const queue = data.queue || [];
  const account = data.account || {};
  const enabled = Boolean(data.settings?.enabled);
  const next = data.next_slots?.[0];
  $('#queue-total').replaceChildren(document.createTextNode(String(queue.length)), element('small', '', queue.length === 1 ? 'příspěvek' : 'příspěvků'));
  $('#queue-detail').textContent = queue.length ? 'První na řadě: ' + queue[0].filename : 'Přidej první fotografie a popisky';
  $('#queue-badge').textContent = queue.length;
  $('#nav-count').textContent = queue.length;
  $('#next-time').textContent = next ? formatDate(next.at, { day: undefined, month: undefined, hour: '2-digit', minute: '2-digit' }) : 'Bez termínu';
  $('#next-detail').textContent = next ? `${formatDate(next.at, { weekday: 'short', hour: undefined, minute: undefined })} · ${enabled ? timezone() : 'publikování pozastaveno'}` : 'Přidej čas v kalendáři';
  $('#automation-toggle').disabled = false;
  $('#automation-toggle').classList.toggle('running', enabled);
  $('#automation-toggle').setAttribute('aria-pressed', String(enabled));
  $('#automation-label').textContent = enabled ? 'Pozastavit publikování' : 'Zapnout publikování';
  $('.automation-icon').textContent = enabled ? 'Ⅱ' : '▷';
  $('#account-name').textContent = account.connected ? `@${account.username || account.id}` : 'Nepřipojen';
  $('#account-short').textContent = account.connected ? `@${account.username || account.id}` : 'Instagram nepřipojen';
  $('#account-shortcut .dot').className = account.connected ? 'dot cyan' : 'dot';
  $('#account-detail').textContent = account.connected ? (data.settings?.connection_method !== 'official' ? 'Přímé přihlášení z Home Assistantu' : account.expires_at ? `Přístup do ${formatDate(typeof account.expires_at === 'number' ? account.expires_at * 1000 : account.expires_at, { hour: undefined, minute: undefined })}` : 'Oficiální Instagram připojení') : 'Propoj účet v nastavení';
  $('#queue-path').textContent = data.queue_path || 'PLANNED';
  const warnings = $('#warnings');
  warnings.replaceChildren();
  for (const warning of data.warnings || []) warnings.append(element('div', 'notice', typeof warning === 'string' ? warning : (state.language === 'cs' ? warning.message_cs : warning.message) || warning.message || JSON.stringify(warning)));
  if (!state.dragging && !state.editing) renderQueue();
  renderCalendar();
  renderHistory();
  renderSettings();
  renderOnboarding();
}

function onboardingSteps(data) {
  const settings = data.settings || {};
  const account = data.account || {};
  const official = settings.connection_method === 'official';
  const now = new Date(data.server_time).getTime() || Date.now();
  const internal = settings.schedule_source === 'internal';
  const schedule = data.schedule || {};
  const calendarReady = internal
    ? (schedule.weekly || []).some(rule => rule.enabled === true && rule.days?.length && rule.time)
      || (schedule.once || []).some(rule => rule.enabled === true && new Date(rule.at).getTime() > now)
    : Boolean(settings.calendar_entity);
  let httpsReady = false;
  try {
    const url = new URL(settings.public_media_base_url);
    httpsReady = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { /* An unset or invalid saved URL is an incomplete setup step. */ }
  const expiry = account.expires_at == null ? null : typeof account.expires_at === 'number'
    ? account.expires_at * 1000 : new Date(account.expires_at).getTime();
  const expired = official && expiry != null && Number.isFinite(expiry) && expiry <= now;
  const accountReady = account.connected === true && (official ? settings.has_token === true : settings.has_direct_session === true) && !account.error && !expired;
  const head = data.queue?.[0];
  const queueReady = Boolean(head && (head.status === 'queued' || head.status === 'publishing'));
  const steps = [
    { id: 'calendar', title: 'Kalendář', complete: Boolean(calendarReady), view: 'calendar', target: internal ? '#internal-calendar-details' : '#ha-calendar-select',
      detail: internal ? (calendarReady ? 'Interní plán obsahuje zapnutý budoucí nebo opakovaný termín.' : 'Do interního plánu přidej zapnutý termín.')
        : (calendarReady ? 'Vybraný HA kalendář je uložený. Termíny spravuj v Home Assistantu.' : 'Vyber a ulož samostatný kalendář pro příspěvky.'),
      action: calendarReady ? 'Otevřít kalendář' : 'Nastavit kalendář' },
    { id: 'instagram', title: 'Instagram', complete: accountReady, attention: expired || Boolean(account.error), view: 'settings', target: accountReady ? '#check-account' : official ? '#oauth-connect' : '#direct-username',
      detail: accountReady ? 'Poslední uložené ověření účtu potvrdilo připojení.' : expired ? 'Uložená platnost přístupu skončila. Připojení je potřeba obnovit.' : official ? 'Připoj profesionální účet a ověř spojení v nastavení.' : 'Přihlas Instagram v nastavení. Fotografie se odesílají přímo z Home Assistantu.',
      action: accountReady ? 'Otevřít připojení' : 'Připojit účet' },
    { id: 'queue', title: 'Fronta', complete: queueReady, attention: Boolean(head && !queueReady), view: 'queue', target: head ? '#queue-heading' : '#import-button',
      detail: queueReady ? (head.status === 'publishing' ? 'Příspěvek z čela fronty se právě publikuje.' : 'První příspěvek je připravený ve frontě.')
        : head ? 'První příspěvek vyžaduje kontrolu. Podrobnosti jsou ve frontě a historii.' : 'Přidej hotovou fotografii a její popisek.',
      action: head ? 'Otevřít frontu' : 'Naplnit frontu' }
  ];
  if (official) steps.splice(1, 0, {
    id: 'https', title: 'Veřejné HTTPS', complete: httpsReady, view: 'settings', target: '#public-url',
    detail: httpsReady ? 'HTTPS adresa je uložená. Její veřejná dostupnost ještě není tímto krokem potvrzená.' : 'Ulož veřejnou HTTPS adresu, ze které Instagram načte fotografie.',
    action: httpsReady ? 'Upravit HTTPS' : 'Nastavit HTTPS'
  });
  return steps;
}

function goToSetupStep(step) {
  navigate(step.view);
  const target = $(step.target);
  if (!target) return;
  const disclosure = target.closest('details');
  if (disclosure) disclosure.open = true;
  if (target.tagName === 'DETAILS') target.open = true;
  if (!target.matches('button,input,select,textarea,a,summary')) target.setAttribute('tabindex', '-1');
  target.scrollIntoView({ block: 'center', behavior: 'auto' });
  target.focus({ preventScroll: true });
}

function renderOnboarding() {
  if (!state.data) return;
  const steps = onboardingSteps(state.data);
  const done = steps.filter(step => step.complete).length;
  const allComplete = done === steps.length;
  for (const selector of ['#queue-onboarding', '#settings-onboarding']) {
    const section = $(selector);
    section.hidden = false;
    section.replaceChildren();
    section.classList.toggle('complete', allComplete);
    section.classList.toggle('official', steps.length === 4);
    const heading = element('div', 'onboarding-heading');
    const intro = element('div');
    intro.append(element('div', 'eyebrow', 'PŘÍPRAVA K PUBLIKOVÁNÍ'), element('h2', '', allComplete ? 'Nastavení je připravené' : steps.length === 3 ? 'Tři kroky k prvnímu příspěvku' : 'Čtyři kroky k prvnímu příspěvku'));
    const progress = element('div', 'onboarding-progress');
    progress.append(element('strong', '', `${done} / ${steps.length}`), element('span', '', allComplete ? (state.data.settings?.enabled ? 'Publikování je zapnuté' : 'Nastavení je připravené') : 'Zbývá dokončit nastavení'));
    heading.append(intro, progress);
    const checklist = element('ol', 'onboarding-list');
    for (const [index, step] of steps.entries()) {
      const item = element('li', `setup-step${step.complete ? ' complete' : ''}${step.attention ? ' attention' : ''}`);
      const top = element('div', 'setup-step-top');
      const marker = element('span', 'setup-marker', step.complete ? '✓' : String(index + 1).padStart(2, '0'));
      marker.setAttribute('aria-hidden', 'true');
      top.append(marker, element('span', 'setup-status', step.complete ? 'Hotovo' : step.attention ? 'Zkontrolovat' : 'Doplnit'));
      const action = button(step.action, 'setup-action', () => goToSetupStep(step));
      const arrow = element('span', '', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      action.append(arrow);
      item.append(top, element('h3', '', step.title), element('p', '', step.detail), action);
      checklist.append(item);
    }
    section.append(heading, checklist, element('p', 'onboarding-note', state.data.settings?.connection_method === 'official' ? 'Počítají se pouze uložené údaje. Veřejná dostupnost HTTPS se ověří při zapnutí publikování.' : 'Přehled vychází z uloženého nastavení a skutečného stavu fronty.'));
    if (allComplete && !state.data.settings?.enabled) section.append(element('p', 'onboarding-ready', 'Nastavení samo nic nezveřejní. Až budeš připravený, zapni publikování nahoře.'));
  }
}

function renderQueue() {
  const queue = state.data?.queue || [];
  const list = $('#queue-list');
  const locked = queue.some(item => item.status === 'publishing');
  list.replaceChildren();
  $('#queue-empty').hidden = queue.length > 0;
  for (const [index, item] of queue.entries()) {
    const row = element('article', 'queue-row');
    row.dataset.id = item.id;
    row.draggable = !locked;
    row.setAttribute('aria-label', `Příspěvek ${index + 1}: ${item.filename}`);
    const handle = button('⠿', 'drag-handle', () => {}, 'Přetáhnout příspěvek; pro klávesnici použij šipky vedle něj');
    handle.tabIndex = -1;
    const number = element('span', 'order-number', String(index + 1).padStart(4, '0'));
    const thumbnail = element('img', 'queue-thumb');
    thumbnail.src = `api/queue/${encodeURIComponent(item.id)}/image`;
    thumbnail.alt = `Náhled ${item.filename}`;
    thumbnail.loading = 'lazy';
    thumbnail.draggable = false;
    const content = element('div', 'queue-content');
    const name = element('h3', 'queue-filename', item.filename);
    name.title = item.filename;
    const caption = element('p', `queue-caption${item.caption ? '' : ' no-caption'}`, item.caption || 'Popisek zatím není přidaný.');
    const meta = element('div', 'row-meta');
    meta.append(badge(item.status));
    if (index === 0) meta.append(element('span', 'slot-note', 'DALŠÍ NA ŘADĚ'));
    content.append(name, caption, meta);
    if (item.error) content.append(element('div', 'row-error', state.language === 'cs' ? item.error_cs || item.error : item.error));
    const controls = element('div', 'row-controls');
    const arrows = element('div', 'arrow-controls');
    const up = button('↑', 'icon-button', () => moveItem(item.id, -1), `Posunout ${item.filename} výše`);
    const down = button('↓', 'icon-button', () => moveItem(item.id, 1), `Posunout ${item.filename} níže`);
    up.disabled = index === 0 || locked;
    down.disabled = index === queue.length - 1 || locked;
    arrows.append(up, down);
    const edit = button('Upravit text', 'button secondary edit-caption', () => editCaption(item), `Upravit popisek ${item.filename}`);
    edit.disabled = item.status === 'publishing';
    controls.append(edit, arrows);
    if (item.status === 'error') {
      const retry = button('↻', 'icon-button', event => run(() => api(`queue/${encodeURIComponent(item.id)}/retry`, { method: 'POST' }), event.currentTarget, 'Příspěvek je znovu připravený ve frontě.'), 'Znovu připravit příspěvek po chybě');
      controls.prepend(retry);
    }
    row.append(handle, number, thumbnail, content, controls);
    row.addEventListener('dragstart', event => {
      if (locked || event.target.closest('input, textarea')) { event.preventDefault(); return; }
      state.dragging = item.id;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
    });
    row.addEventListener('dragover', event => {
      if (!state.dragging || state.dragging === item.id || locked) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target'); });
    row.addEventListener('drop', event => {
      event.preventDefault();
      row.classList.remove('drop-target');
      const source = state.dragging;
      if (!source || source === item.id) return;
      const ids = queue.map(entry => entry.id);
      ids.splice(ids.indexOf(source), 1);
      ids.splice(index, 0, source);
      state.dragging = null;
      saveOrder(ids);
    });
    row.addEventListener('dragend', () => {
      state.dragging = null;
      $$('.queue-row').forEach(node => node.classList.remove('dragging', 'drop-target'));
    });
    list.append(row);
  }
}

function saveOrder(ids) {
  if (state.busy) return;
  return run(() => api('queue/reorder', { method: 'POST', body: JSON.stringify({ ids }) }), null, 'Pořadí uložené. Názvy fotek i popisků jsou aktualizované.');
}

async function moveItem(id, delta) {
  const ids = state.data.queue.map(item => item.id);
  const oldIndex = ids.indexOf(id);
  const target = oldIndex + delta;
  if (oldIndex < 0 || target < 0 || target >= ids.length) return;
  [ids[oldIndex], ids[target]] = [ids[target], ids[oldIndex]];
  await saveOrder(ids);
  const row = $$('.queue-row').find(node => node.dataset.id === id);
  if (row) {
    const arrows = $$('.arrow-controls .icon-button', row);
    const focusTarget = arrows[delta < 0 ? 0 : 1];
    (focusTarget && !focusTarget.disabled ? focusTarget : $('.edit-caption', row)).focus();
  }
}

function editCaption(item) {
  state.editing = item.id;
  $('#caption-filename').textContent = item.filename;
  $('#caption-text').value = item.caption || '';
  $('#caption-count').textContent = `${$('#caption-text').value.length} / 2200`;
  $('#caption-dialog').showModal();
  $('#caption-text').focus();
}

function copySchedule() {
  return structuredClone(state.data?.schedule || { timezone: 'Europe/Prague', weekly: [], once: [] });
}

async function saveSchedule(schedule, trigger, success) {
  return run(() => api('schedule', { method: 'PUT', body: JSON.stringify(schedule) }), trigger, success);
}

function renderCalendar() {
  if (!state.data) return;
  const schedule = state.data.schedule || { weekly: [], once: [], timezone: 'Europe/Prague' };
  const zone = schedule.timezone || 'Europe/Prague';
  const usesHA = state.data.settings?.schedule_source !== 'internal';
  $('#calendar-heading').textContent = usesHA ? 'Kalendář Home Assistantu' : 'Kalendář doplňku';
  $('#calendar-description').textContent = usesHA ? 'Začátek události ve vybraném kalendáři publikuje jeden příspěvek.' : 'Pravidelné časy i jednotlivé termíny. Každý slot = jeden příspěvek.';
  $('#calendar-range-note').textContent = usesHA ? 'Zobrazeny jsou pouze termíny načtené z Home Assistantu. Události i jejich opakování upravuj tam.' : 'Zobrazená pravidla pocházejí z interního plánu doplňku.';
  if (!$('#timezone-form').contains(document.activeElement)) $('#timezone-input').value = zone;
  $$('.timezone-label').forEach(node => { node.textContent = zone; });
  const todayKey = dateKey(new Date());
  const today = new Date(`${todayKey}T12:00:00Z`);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7 + state.weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  $('#week-label').textContent = `${monday.getUTCDate()}. ${monday.getUTCMonth() + 1}. – ${sunday.getUTCDate()}. ${sunday.getUTCMonth() + 1}. ${sunday.getUTCFullYear()}`;
  const grid = $('#week-grid');
  grid.replaceChildren();
  for (let day = 0; day < 7; day++) {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + day);
    const key = date.toISOString().slice(0, 10);
    const cell = element('div', `week-day${key === todayKey ? ' today' : ''}`);
    cell.append(element('span', 'day-name', days[day].toUpperCase()), element('span', 'date-number', date.getUTCDate()));
    const slots = [];
    if (usesHA) {
      for (const slot of state.data.next_slots || []) {
        if (dateKey(new Date(slot.at)) === key) slots.push({ time: formatDate(slot.at, { day: undefined, month: undefined }), type: 'weekly', label: slot.label || 'Home Assistant' });
      }
    } else {
      for (const rule of schedule.weekly || []) {
        if (rule.enabled && rule.days.includes(day)) slots.push({ time: rule.time, type: 'weekly', label: 'Pravidelně' });
      }
      for (const rule of schedule.once || []) {
        if (rule.enabled && dateKey(new Date(rule.at)) === key) slots.push({ time: formatDate(rule.at, { day: undefined, month: undefined }), type: 'once', label: 'Jednorázově' });
      }
    }
    for (const slot of slots.sort((a, b) => a.time.localeCompare(b.time))) {
      const node = element('div', `calendar-slot ${slot.type}`);
      node.append(element('strong', '', slot.time), element('small', usesHA ? 'no-translate' : '', slot.label));
      cell.append(node);
    }
    if (!slots.length) cell.append(element('span', 'calendar-none', '—'));
    grid.append(cell);
  }
  renderRules('weekly', schedule.weekly || []);
  renderRules('once', schedule.once || []);
}

function renderRules(type, rules) {
  const list = $(`#${type}-rules`);
  list.replaceChildren();
  for (const rule of rules) {
    const row = element('div', 'rule-item');
    const info = element('div');
    info.append(element('strong', '', type === 'weekly' ? rule.time : formatDate(rule.at)));
    info.append(element('small', '', type === 'weekly' ? (rule.days.length === 7 ? 'Každý den' : rule.days.map(day => days[day]).join(' · ')) : timezone()));
    const controls = element('div', 'rule-actions');
    const toggle = button('', 'rule-toggle', event => {
      const schedule = copySchedule();
      schedule[type].find(item => item.id === rule.id).enabled = !rule.enabled;
      saveSchedule(schedule, event.currentTarget, rule.enabled ? 'Termín pozastaven.' : 'Termín zapnut.');
    }, `${rule.enabled ? 'Vypnout' : 'Zapnout'} termín ${type === 'weekly' ? rule.time : formatDate(rule.at)}`);
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(Boolean(rule.enabled)));
    const remove = button('×', 'icon-button', event => {
      const schedule = copySchedule();
      schedule[type] = schedule[type].filter(item => item.id !== rule.id);
      saveSchedule(schedule, event.currentTarget, 'Termín odstraněn.');
    }, 'Odstranit termín');
    controls.append(toggle, remove);
    row.append(info, controls);
    list.append(row);
  }
}

function renderHistory() {
  const records = state.data?.history || [];
  $('#history-empty').hidden = records.length > 0;
  const list = $('#history-list');
  list.replaceChildren();
  for (const record of records) {
    const status = record.state || record.status || 'unknown';
    const row = element('article', 'history-row');
    const icon = element('span', `history-icon${status === 'published' ? '' : ' problem'}`, status === 'published' ? '✓' : '!');
    const info = element('div');
    info.append(element('h3', '', record.filename || record.item_id || 'Příspěvek'), badge(status));
    if (record.error) info.append(element('p', '', state.language === 'cs' ? record.error_cs || record.error : record.error));
    if (record.note) info.append(element('p', '', state.language === 'cs' ? record.note_cs || record.note : record.note));
    const right = element('div', 'history-right');
    right.append(element('span', 'history-date', formatDate(record.published_at || record.updated_at || record.created_at)));
    if (record.permalink) {
      try {
        const url = new URL(record.permalink);
        if (url.protocol === 'https:' && (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))) {
          const link = element('a', '', 'Otevřít na Instagramu ↗');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          right.append(link);
        }
      } catch { /* An invalid result URL is never inserted into the document. */ }
    }
    if (status === 'uncertain' && (record.attempt_id || record.id)) {
      right.append(button('Ověřit výsledek', 'button secondary compact', () => openResolve(record)));
    }
    row.append(icon, info, right);
    list.append(row);
  }
}

function renderSettings() {
  const settings = state.data?.settings || {};
  const account = state.data?.account || {};
  const method = settings.connection_method === 'official' ? 'official' : 'direct';
  if (!state.methodDirty) $('#connection-method').value = method;
  $('#direct-connection').hidden = method !== 'direct';
  $('#official-connection').hidden = method !== 'official';
  $('#connection-method-note').textContent = method === 'direct' ? 'Aktivní je přímé přihlášení. Veřejná HTTPS adresa není potřeba.' : 'Aktivní je Oficiální Meta API. Jeho nastavení najdeš v pokročilých možnostech.';
  if (method !== 'direct') state.directChallenge = false;
  renderDirectLogin();
  const editing = state.settingsDirty || $('#settings-form').contains(document.activeElement);
  if (!editing) {
    $('#app-id').value = settings.app_id || '';
    $('#public-url').value = settings.public_media_base_url || '';
    $('#api-version').value = settings.api_version || 'v26.0';
    $('#schedule-source').value = settings.schedule_source || 'home_assistant';
  }
  if (state.calendars) renderCalendarOptions();
  $('#app-secret').placeholder = settings.has_app_secret ? 'Uloženo — ponech prázdné pro zachování' : 'Instagram App Secret';
  $('#access-token').placeholder = settings.has_token ? 'Token je uložený' : 'Instagram access token';
  $('#connection-status').textContent = account.connected ? `Připojeno jako @${account.username || account.id}` : 'Účet zatím není propojený.';
  $('#account-error').hidden = !account.error;
  $('#account-error').textContent = (state.language === 'cs' ? account.error_cs || account.error : account.error) || '';
  $('#disconnect-account').hidden = !(method === 'direct' ? settings.has_direct_session : settings.has_token) && !account.connected;
  updateCallback();
}

function renderDirectLogin() {
  $('#direct-credentials').hidden = state.directChallenge;
  $('#direct-two-factor').hidden = !state.directChallenge;
  $('#direct-login-reset').hidden = !state.directChallenge;
  $('#direct-username').required = !state.directChallenge;
  $('#direct-password').required = !state.directChallenge;
  $('#direct-verification-code').required = state.directChallenge;
  $('#direct-login-button').textContent = state.directChallenge ? 'Dokončit ověření' : 'Přihlásit Instagram';
}

function updateCallback() {
  const base = $('#public-url').value.trim().replace(/\/+$/, '');
  $('#callback-uri').textContent = base ? `${base}/oauth/callback` : 'Nejdřív zadej veřejnou adresu';
}

async function loadCalendars() {
  if (state.calendarsLoading) return;
  state.calendarsLoading = true;
  $('#calendars-error').hidden = true;
  try {
    const result = await api('calendars');
    state.calendars = result.calendars || [];
    renderCalendarOptions();
    if (!state.calendars.length) {
      $('#calendars-error').textContent = 'Home Assistant zatím neposkytuje žádný kalendář. Nejdřív přidej kalendář v jeho integracích.';
      $('#calendars-error').hidden = false;
    }
  } catch (error) {
    $('#calendars-error').textContent = `Kalendáře se nepodařilo načíst. ${error.message}`;
    $('#calendars-error').hidden = false;
    for (const selector of ['#ha-calendar-select', '#calendar-entity']) {
      const select = $(selector);
      select.replaceChildren();
      const option = element('option', '', state.data?.settings?.calendar_entity || 'Kalendáře nejsou dostupné');
      option.value = state.data?.settings?.calendar_entity || '';
      select.append(option);
    }
  } finally { state.calendarsLoading = false; }
}

function renderCalendarOptions() {
  for (const selector of ['#ha-calendar-select', '#calendar-entity']) {
    const select = $(selector);
    if (select === document.activeElement) continue;
    const current = state.data?.settings?.calendar_entity || '';
    const previous = select.value;
    const dirty = selector === '#calendar-entity' ? state.settingsDirty : state.calendarDirty;
    select.replaceChildren();
    const empty = element('option', '', 'Vyber kalendář pro příspěvky');
    empty.value = '';
    select.append(empty);
    for (const calendar of state.calendars || []) {
      const option = element('option', 'no-translate', `${calendar.name || calendar.entity_id} · ${calendar.entity_id}`);
      option.value = calendar.entity_id;
      select.append(option);
    }
    if (current && !(state.calendars || []).some(calendar => calendar.entity_id === current)) {
      const option = element('option', 'no-translate', `${current} · ${state.language === 'en' ? 'currently unavailable' : 'nyní není dostupný'}`);
      option.value = current;
      select.append(option);
    }
    select.value = dirty ? previous : current;
  }
}

function openResolve(record) {
  state.resolving = record.attempt_id || record.id;
  $('#resolve-filename').textContent = record.filename || record.item_id || '';
  $('#resolve-form').reset();
  toggleResolveFields();
  $('#resolve-dialog').showModal();
}

function toggleResolveFields() {
  const published = $('#resolve-published').value === 'true';
  $('#resolve-link-label').hidden = !published;
  $('#resolve-note-label').hidden = published;
  $('#resolve-permalink').required = published;
  $('#resolve-note').required = !published;
}

function zonedLocalToISO(value, zone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Vyplň platné datum a čas.');
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wallTime = date => {
    const parts = Object.fromEntries(fmt.formatToParts(date).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  };
  const offsets = new Set([-86400000, 0, 86400000].map(delta => wallTime(new Date(target + delta)) - target - delta));
  const candidates = [...offsets].map(offset => target - offset).filter(candidate => wallTime(new Date(candidate)) === target).sort((a, b) => a - b);
  if (!candidates.length) throw new Error('Tento místní čas při přechodu na letní čas neexistuje. Vyber jiný čas.');
  return new Date(candidates[0]).toISOString();
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
}

$$('[data-view]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.view)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
$('.brand').addEventListener('click', () => navigate('queue'));
$('#account-shortcut').addEventListener('click', () => navigate('settings'));
$('#automation-toggle').addEventListener('click', event => {
  if (!state.data) return;
  const enabled = !state.data.settings?.enabled;
  if (enabled && state.data.settings?.schedule_source !== 'internal' && !state.data.settings?.calendar_entity) {
    toast('Nejdřív vyber kalendář Home Assistantu pro publikování.', true);
    navigate('calendar');
    return;
  }
  run(() => api('settings', { method: 'PUT', body: JSON.stringify({ enabled }) }), event.currentTarget, enabled ? 'Automatické publikování je zapnuté.' : 'Automatické publikování je pozastavené.');
});
$('#scan-button').addEventListener('click', event => run(() => api('queue/scan', { method: 'POST' }), event.currentTarget, 'Složka je načtená.'));
for (const id of ['#import-button', '#empty-import']) $(id).addEventListener('click', () => $('#upload-files').click());
$('#upload-files').addEventListener('change', async event => {
  if (!event.target.files.length) return;
  const data = new FormData();
  for (const file of event.target.files) data.append('files', file);
  await run(() => api('upload', { method: 'POST', body: data }), $('#import-button'), 'Příspěvky jsou přidané do fronty.');
  event.target.value = '';
});
$('#caption-text').addEventListener('input', event => { $('#caption-count').textContent = `${event.target.value.length} / 2200`; });
for (const id of ['#caption-close', '#caption-cancel']) $(id).addEventListener('click', () => $('#caption-dialog').close());
$('#caption-dialog').addEventListener('close', () => { state.editing = null; loadState(); });
$('#caption-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = state.editing;
  if (!id) return;
  const caption = $('#caption-text').value;
  const trigger = $('button[type=submit]', event.target);
  const result = await run(async () => {
    await api(`queue/${encodeURIComponent(id)}/caption`, { method: 'PATCH', body: JSON.stringify({ caption }) });
    return { saved: true };
  }, trigger, 'Popisek uložen.');
  if (result?.saved) $('#caption-dialog').close();
});
$('#weekly-form').addEventListener('submit', event => {
  event.preventDefault();
  const chosen = $$('input[name=days]:checked', event.target).map(input => Number(input.value));
  if (!chosen.length) { toast('Vyber alespoň jeden den.', true); return; }
  const schedule = copySchedule();
  schedule.weekly.push({ id: newId(), days: chosen, time: $('input[name=time]', event.target).value, enabled: true });
  saveSchedule(schedule, $('button[type=submit]', event.target), 'Pravidelný čas přidán.');
});
$('#once-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const schedule = copySchedule();
    const at = zonedLocalToISO($('input[name=at]', event.target).value, schedule.timezone);
    if (new Date(at) <= new Date()) throw new Error('Vyber termín v budoucnosti.');
    schedule.once.push({ id: newId(), at, enabled: true });
    saveSchedule(schedule, $('button[type=submit]', event.target), 'Jednorázový termín přidán.');
  } catch (error) { toast(error.message, true); }
});
$('#timezone-form').addEventListener('submit', event => {
  event.preventDefault();
  const schedule = copySchedule();
  schedule.timezone = $('#timezone-input').value.trim();
  saveSchedule(schedule, $('button[type=submit]', event.target), 'Časové pásmo uložené.');
});
$('#ha-calendar-select').addEventListener('change', () => { state.calendarDirty = true; });
$('#ha-calendar-form').addEventListener('submit', async event => {
  event.preventDefault();
  const calendar_entity = $('#ha-calendar-select').value;
  if (!calendar_entity) { toast('Vyber kalendář pro příspěvky.', true); return; }
  const result = await run(async () => {
    await api('settings', { method: 'PUT', body: JSON.stringify({ calendar_entity, schedule_source: 'home_assistant' }) });
    return { saved: true };
  }, $('button[type=submit]', event.target), 'Publikování bude řídit vybraný kalendář Home Assistantu.');
  if (result?.saved) { state.calendarDirty = false; renderCalendarOptions(); }
});
$('#reload-calendars').addEventListener('click', loadCalendars);
$('#week-prev').addEventListener('click', () => { state.weekOffset--; renderCalendar(); });
$('#week-next').addEventListener('click', () => { state.weekOffset++; renderCalendar(); });
$('#week-today').addEventListener('click', () => { state.weekOffset = 0; renderCalendar(); });
$('#public-url').addEventListener('input', updateCallback);
$('#connection-method').addEventListener('change', () => { state.methodDirty = true; });
$('#connection-method-form').addEventListener('submit', async event => {
  event.preventDefault();
  const connection_method = $('#connection-method').value;
  const saved = state.data?.settings?.connection_method === 'official' ? 'official' : 'direct';
  if (connection_method === saved) { state.methodDirty = false; toast('Zvolená metoda už je aktivní.'); return; }
  const result = await run(async () => {
    await api('settings', { method: 'PUT', body: JSON.stringify({ connection_method }) });
    return { saved: true };
  }, $('button[type=submit]', event.target), 'Metoda připojení uložená.');
  if (result?.saved) {
    state.methodDirty = false;
    state.directChallenge = false;
    $('#direct-password').value = '';
    $('#direct-verification-code').value = '';
    renderSettings();
  }
});
$('#direct-login-reset').addEventListener('click', () => {
  state.directChallenge = false;
  $('#direct-password').value = '';
  $('#direct-verification-code').value = '';
  renderDirectLogin();
  $('#direct-username').focus();
});
$('#direct-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.data?.settings?.connection_method === 'official' || $('#connection-method').value !== 'direct') {
    toast('Nejdřív ulož zvolenou metodu připojení.', true);
    $('#direct-password').value = '';
    return;
  }
  const payload = state.directChallenge
    ? { verification_code: $('#direct-verification-code').value.replace(/\s/g, '') }
    : { username: $('#direct-username').value.trim(), password: $('#direct-password').value };
  $('#direct-password').value = '';
  $('#direct-verification-code').value = '';
  if (state.directChallenge ? !payload.verification_code : !payload.username || !payload.password) {
    toast(state.directChallenge ? 'Zadej ověřovací kód.' : 'Vyplň uživatelské jméno a heslo.', true);
    return;
  }
  const result = await run(async () => {
    try {
      const response = await api('account/login', { method: 'POST', body: JSON.stringify(payload) });
      if (response.challenge === 'two_factor') state.directChallenge = true;
      else if (response.connected) state.directChallenge = false;
      renderDirectLogin();
      return response;
    } finally {
      delete payload.password;
      delete payload.verification_code;
      $('#direct-password').value = '';
      $('#direct-verification-code').value = '';
    }
  }, $('#direct-login-button'));
  if (result?.challenge === 'two_factor') {
    toast((state.language === 'cs' ? result.message_cs : result.message) || 'Instagram vyžaduje dvoufázové ověření. Zadej aktuální kód z autentizační aplikace nebo SMS.');
    $('#direct-verification-code').focus();
  } else if (result?.connected) toast('Instagram je připojený.');
  else if (result) toast('Přihlášení zatím nebylo potvrzené.', true);
});
$('#settings-form').addEventListener('input', () => { state.settingsDirty = true; });
$('#settings-form').addEventListener('change', () => { state.settingsDirty = true; });
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(event.target).entries());
  for (const key of Object.keys(settings)) settings[key] = settings[key].trim();
  if (!settings.app_secret) delete settings.app_secret;
  if (!settings.access_token) delete settings.access_token;
  const result = await run(async () => {
    await api('settings', { method: 'PUT', body: JSON.stringify(settings) });
    return { saved: true };
  }, $('button[type=submit]', event.target), 'Nastavení uložené.');
  if (result?.saved) { state.settingsDirty = false; $('#app-secret').value = ''; $('#access-token').value = ''; renderSettings(); }
});
for (const id of ['#resolve-close', '#resolve-cancel']) $(id).addEventListener('click', () => $('#resolve-dialog').close());
$('#resolve-published').addEventListener('change', toggleResolveFields);
$('#resolve-dialog').addEventListener('close', () => { state.resolving = null; loadState(); });
$('#resolve-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.resolving || !$('#resolve-confirm').checked) return;
  const published = $('#resolve-published').value === 'true';
  const payload = published ? { published: true, permalink: $('#resolve-permalink').value.trim() } : { published: false, note: $('#resolve-note').value.trim() };
  if (published) {
    try {
      const url = new URL(payload.permalink);
      if (url.protocol !== 'https:' || !(url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))) throw new Error();
    } catch { toast('Vlož HTTPS odkaz na příspěvek na Instagramu.', true); return; }
  }
  const result = await run(async () => {
    await api(`attempts/${encodeURIComponent(state.resolving)}/resolve`, { method: 'POST', body: JSON.stringify(payload) });
    return { saved: true };
  }, $('button[type=submit]', event.target), 'Ověřený výsledek uložen.');
  if (result?.saved) $('#resolve-dialog').close();
});
$('#check-account').addEventListener('click', event => run(() => api('account/check', { method: 'POST' }), event.currentTarget, 'Spojení bylo ověřeno.'));
$('#disconnect-account').addEventListener('click', event => run(async () => {
  await api('account/disconnect', { method: 'POST' });
  state.directChallenge = false;
  $('#direct-password').value = '';
  $('#direct-verification-code').value = '';
  renderDirectLogin();
}, event.currentTarget, 'Instagram je odpojen.'));
$('#oauth-connect').addEventListener('click', async event => {
  if (state.data?.settings?.connection_method !== 'official' || $('#connection-method').value !== 'official') {
    toast('Nejdřív ulož zvolenou metodu připojení.', true);
    return;
  }
  const popup = window.open('about:blank', 'reality_twins_instagram', 'popup,width=620,height=760');
  const result = await run(async () => {
    const data = await api('oauth/start', { method: 'POST' });
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !(url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))) throw new Error('Server vrátil neplatnou přihlašovací adresu.');
    if (popup) { popup.opener = null; popup.location.href = url.href; }
    else window.location.assign(url.href);
    return { opened: true };
  }, event.currentTarget);
  if (!result?.opened && popup) popup.close();
});

function updateClock() {
  try { $('#clock').textContent = formatter({ weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date()).toUpperCase(); }
  catch { $('#clock').textContent = '—'; }
}

const languageObserver = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes' || record.type === 'characterData') applyLanguage(record.target);
    for (const node of record.addedNodes || []) if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) applyLanguage(node);
  }
});
languageObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'] });
$$('[data-language]').forEach(node => node.addEventListener('click', () => setLanguage(node.dataset.language)));
if (titles[location.hash.slice(1)]) state.view = location.hash.slice(1);
setLanguage(state.language);
navigate(location.hash.slice(1));
loadState();
updateClock();
window.setInterval(() => { if (!document.hidden) loadState(); updateClock(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadState(); });
