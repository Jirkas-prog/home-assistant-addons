# Home Assistant Add-ons

Vlastní repozitář doplňků pro Home Assistant. Aktuálně obsahuje add-on **MyBrowser**.

## Přidání repozitáře do Home Assistantu

1. Otevřete **Nastavení → Doplňky → Obchod s doplňky**.
2. V nabídce zvolte **Repozitáře**.
3. Přidejte adresu `https://github.com/Jirkas-prog/home-assistant-addons`.
4. V obchodě vyberte a nainstalujte **MyBrowser**.

## MyBrowser

MyBrowser je osobní knihovna webů a současně správce malých webových serverů. Úvodní obrazovka používá kartové rozložení podobné videoportálům, ale místo videí zobrazuje hostované weby a uložené odkazy.

## Hlavní funkce

- společná knihovna hostovaných webů a externích odkazů;
- náhledy, počet otevření a datum poslední návštěvy;
- oblíbené položky označené hvězdičkou;
- libovolné pořadí oblíbených pomocí drag and drop;
- automatické abecední řazení ostatních položek;
- plnohodnotný prohlížeč postavený na Chromiu pro externí odkazy, hostované weby a webové hledání;
- volitelné omezení známých reklamních zdrojů pro každý odkaz;
- offline kopie stránky včetně běžných obrázků, stylů a skriptů;
- historický archiv: nové stažení nikdy nepřepíše starší verzi;
- statické/SPA servery a projekty spouštěné přes npm nebo Bun;
- okamžité drag and drop nahrávání souborů na pozadí, logy, instalace balíčků a build skripty;
- automatický start vybraných hostovaných webů;
- jednorázově vytvořený ukázkový web **Průvodce MyBrowserem**, který lze upravit nebo odstranit.

## Instalace

1. Zkopírujte složku `mybrowser` do `/addons/mybrowser` na Home Assistant OS.
2. V **Nastavení → Doplňky → Obchod s doplňky** zvolte v nabídce **Znovu načíst**.
3. Nainstalujte lokální add-on **MyBrowser**.
4. Na kartě **Konfigurace** případně upravte výchozí složku `/share/Weby`, limity nahrávání a offline archivu.
5. Spusťte add-on, zapněte start při spuštění systému a otevřete Web UI.

Instalační ZIP je v `releases/MyBrowser-v0.6.0-HA-addon.zip`. Rozbalením musí vzniknout složka `/addons/mybrowser` s `config.yaml` a `Dockerfile` uvnitř.

## Knihovna a oblíbené

Tlačítko **Přidat** nabízí dvě možnosti:

- **Hostovaný web** – statická/SPA stránka nebo npm/Bun projekt běžící na zvoleném portu.
- **Odkaz na web** – externí HTTP/HTTPS stránka s automaticky načteným titulkem, popisem a dostupným obrázkem Open Graph či faviconou.

Hvězdička přidá položku mezi oblíbené. Oblíbené karty lze na hlavní stránce nebo v části **Oblíbené** přetahovat. Položky mimo oblíbené MyBrowser vždy řadí podle české abecedy.

Nabídka se třemi tečkami na každé kartě umí položku skrýt z domovské obrazovky bez smazání, otevřít její nastavení, zkopírovat adresu, otevřít ji zvlášť nebo ji úplně odebrat. Skryté položky zůstávají v částech **Hostované** a **Odkazy**, odkud je lze na domovskou obrazovku vrátit.

Počítadlo zobrazení se zvýší při otevření hostovaného webu nebo externího odkazu přes MyBrowser.

## Externí odkazy a omezení reklam

Externí stránka i hostovaný web se uvnitř MyBrowseru otevírají ve skutečné relaci Chromia. Chromium načítá původní CSS, obrázky, JavaScript, formuláře a navigaci bez přepisování HTML proxy serverem. Platí jeho standardní pravidla stejného původu, cookies i zabezpečení webu a vzdálená stránka nemá přímý přístup k ovládacímu rozhraní add-onu.

Horní lišta a obrazovka prohlížeče podporují zadání adresy nebo hledaného výrazu, historii zpět/vpřed, obnovení, klikání, posun, klávesnici, JavaScriptové dialogy a webový výběr souboru. Profil Chromia zůstává uložený v datech add-onu, takže stránky mohou zachovat běžné cookies a přihlášení. Stažené soubory Chromium ukládá do složky `MyBrowser/Stazene` vedle výchozí složky `Weby`; přesná cesta je vidět v nastavení MyBrowseru.

Vyhledávací pole filtruje knihovnu a současně nabízí hledání na webu. Klávesa Enter otevře zadanou adresu nebo výsledky DuckDuckGo přímo v hlavní ploše MyBrowseru. Tlačítko **Zpřístupnit offline** v horní liště přidá právě otevřený cizí web do knihovny a spustí vytvoření první offline verze.

Přepínač **Omezovat reklamy** blokuje ve Chromium relaci několik známých reklamních domén. Při vytvoření nové offline verze se navíc odfiltrují známé reklamní zdroje a obvyklé reklamní kontejnery. Jde o praktický filtr, nikoli o úplnou náhradu specializovaného blokátoru; některé weby mohou načítat reklamu ze stejné domény jako vlastní obsah.

Tlačítko **Otevřít zvlášť** otevře aktuální adresu v běžném prohlížeči zařízení mimo Chromium relaci add-onu.

## Offline archiv

Tlačítko **Uložit offline** vytvoří novou neměnnou historickou verzi. MyBrowser uloží hlavní HTML a běžné obrázky, CSS, fonty a skripty. Odkazy na další stránky zůstanou externí. Dynamické aplikace závislé na API, přihlášení, DRM nebo service workerech nemusí být offline kompletní.

Každé další stažení dostane vlastní adresář v datovém úložišti add-onu. Starší verze zůstávají dostupné, dokud je uživatel jednotlivě neodstraní. Offline stránka má zakázané síťové požadavky a otevírá se ve stejném sandboxu jako živý externí web.

Výchozí limit jedné verze je 100 MB a mění se volbou `max_archive_mb`. Historie nemá automatickou retenční dobu.

## Hostované weby

Správa hostovaných webů zůstává v části **Správa serverů**:

- statický server očekává `index.html` a může používat SPA fallback;
- npm/Bun projekt očekává `package.json` a jméno spouštěcího skriptu;
- výchozí přístup vede přes veřejnou bránu add-onu, například `http://192.168.0.234:3000/nazev-webu/`; druhou volbou je veřejná URL vlastní reverzní brány a třetí volbou vlastní port webu;
- npm/Bun proces za bránou dostává interní `PORT`, `HOST=127.0.0.1`, `HOSTNAME=127.0.0.1` a `BASE_PATH=/nazev-webu/`; u vlastního portu zůstává `HOST=0.0.0.0`;
- závislosti lze nainstalovat a projekt sestavit v záložce **Logy**;
- soubory lze nahrát jednotlivě nebo jako celou složku; velké soubory se přes Home Assistant Ingress posílají po menších částech se zobrazením průběhu v procentech.
- záložka **Soubory** funguje jako plnohodnotný file browser: vytváří složky, vyhledává v otevřené složce, stahuje a přejmenovává soubory a umí hromadný výběr, kopírování, přesun i mazání souborů a celých složek;
- při kopírování nebo přesunu stačí vybrat položky, otevřít cílovou složku přes drobečkovou navigaci a zvolit **Vložit sem**;
- dialog nového webu předvyplní číslovanou cestu ve tvaru `/share/Weby/001_Názevwebu`; nahrávání začne ihned po přetažení a po stisknutí **Vytvořit web** pokračuje na pozadí. Lze tak rychle založit několik webů a nechat jejich uploady běžet souběžně.
- vedle souborů lze přetáhnout vlastní úvodní obrázek webu. Bez něj MyBrowser pořídí statický snímek úvodní stránky ve viewportu 1900 × 1069 px a obnoví ho až po změně souborů.
- kliknutí na kartu otevře web uvnitř hlavní plochy MyBrowseru; samostatné okno je pouze volitelná akce.
- po otevření správy serverů nahradí hlavní postranní navigaci seznam a vyhledávání serverů; vpravo zůstane detail vybraného serveru s ovládáním, metrikami a záložkami. Po návratu se obnoví běžná navigace MyBrowseru.

Při prvním spuštění verze s vestavěným průvodcem vznikne ve výchozí složce běžný spravovaný web **Průvodce MyBrowserem**. Slouží jako živý návod i ukázka brány, automatického startu a vnitřního prohlížeče. Pokud jej odstraníte, MyBrowser toto rozhodnutí uloží a průvodce už znovu nevytvoří.

Přístupné kořeny úložiště jsou `/share`, `/media` a veřejný `/config` tohoto add-onu. Výchozí `/share/Weby` lze změnit v konfiguraci.

## Síť a bezpečnost

MyBrowser používá `host_network: true`. Port veřejné brány je standardně `3000` a lze jej změnit volbou `gateway_port`; port `8099` používá pouze správní Ingress. Weby v režimu vlastního portu mohou nadále poslouchat na uživatelsky zvolených portech 1024–65535.

Hostované weby samy nedostávají autentizaci ani HTTPS. Zpřístupňujte je pouze v důvěryhodné LAN/VPN nebo před ně postavte vlastní reverzní proxy. npm/Bun projekty jsou spustitelný kód a mají přístup k namapovaným složkám add-onu; používejte jen důvěryhodné projekty.

## Vývoj a ověření

```powershell
cd D:\03_Projekty\30_MyBrowser\mybrowser
npm test

cd ..
.\package.ps1
```

Testy ověřují statický, npm i Bun server, nahrávání souborů, vytváření složek, hromadné kopírování/přesun/mazání, přejmenování a stahování, oblíbené a jejich pořadí, proxy filtr reklamy, počítadlo zobrazení, metadata odkazu, dvě současně zachované historické offline verze, Ingress načtení ikon a jednorázovou instalaci průvodce.
