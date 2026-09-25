# Změny

## 0.6.0

- původní HTML proxy v hlavní ploše byla nahrazena skutečnou relací Chromia;
- externí i hostované weby nyní načítají původní CSS, obrázky, JavaScript, cookies a formuláře;
- přidaná historie zpět/vpřed, obnovení a navigace zadáním adresy nebo hledaného výrazu;
- do Chromia se přenášejí kliknutí, posun, klávesnice a JavaScriptové dialogy;
- funguje výběr a nahrání místního souboru do formuláře otevřeného webu;
- profil Chromia je trvalý a stažené soubory se ukládají do sdílené složky `MyBrowser/Stazene`;
- živý obraz Chromia se přizpůsobuje velikosti dostupné plochy a relace se po zavření uvolní.

## 0.5.1

- nabídka se třemi tečkami byla přesunuta z náhledu do pravého sloupce vedle informací o webu;
- hvězdička oblíbené položky je nyní přímo pod nabídkou.

## 0.5.0

- záložka Soubory byla rozšířena na plnohodnotný file browser;
- lze vytvářet nové složky a procházet je přes drobečkovou navigaci;
- soubory lze stahovat a soubory i složky přejmenovávat;
- checkboxy umožňují jednotlivý i hromadný výběr a volbu „Vybrat vše“;
- vybrané soubory a celé složky lze hromadně kopírovat, přesouvat nebo mazat;
- cíl kopírování a přesunu se volí běžným procházením složek a akcí „Vložit sem“;
- přidané vyhledávání v právě otevřené složce;
- všechny operace kontrolují kořen webu, kolize názvů a zákaz přesunu složky do ní samotné.

## 0.4.0

- každý web a odkaz má nabídku se třemi tečkami pro skrytí z Domů, nastavení, zkopírování adresy, samostatné otevření, offline archiv a úplné odebrání;
- skrytí z domovské obrazovky nemaže data a položku lze vrátit z části Hostované nebo Odkazy;
- přístup k hostovanému webu nově nabízí tři režimy: bránu MyBrowseru, vlastní veřejnou bránu a vlastní port;
- soubory se začnou nahrávat ihned po přetažení do dialogu a po vytvoření webu upload, úvodní obrázek i automatické spuštění bezpečně doběhnou na pozadí;
- více nových webů lze založit bez čekání a jejich uploady běží souběžně s vlastním procentuálním průběhem;
- hledání v hlavičce nabízí webové hledání a otevírá výsledky uvnitř hlavní plochy MyBrowseru;
- aktuální cizí stránku lze tlačítkem „Zpřístupnit offline“ přidat do knihovny a ihned archivovat;
- opravené zalamování dlouhé adresy na domovské stránce vestavěného průvodce.

## 0.3.2

- add-on už není v manifestu označený jako experimentální.

## 0.3.1

- hlavní ikona se vkládá přímo do HTML, takže funguje i pod Home Assistant Ingress bez závislosti na relativní cestě nebo cache;
- obrazové endpointy jsou ověřené také s celou Ingress cestou;
- při první instalaci nebo aktualizaci se jednorázově přidá hostovaný web „Průvodce MyBrowserem“;
- průvodce názorně vysvětluje nahrávání, úvodní obrázky, automatické náhledy, veřejnou bránu a správu serverů;
- odstraněný průvodce se znovu nevytvoří.

## 0.3.0

- nová veřejná brána na konfigurovatelném portu 3000 se samostatnou cestou pro každý web;
- výchozí režim nových webů používá adresu `/nazev-webu/`, vlastní port zůstává volitelný;
- statické weby obsluhuje brána přímo, npm/Bun aplikace transparentně proxyuje včetně WebSocket připojení;
- karty otevírají hostované i externí weby uvnitř hlavní plochy MyBrowseru;
- živé iframe náhledy byly nahrazeny uloženými PNG snímky ve viewportu 1900 × 1069 px;
- automatický náhled se znovu vytvoří až po změně souborů, vlastní úvodní obrázek má vždy přednost;
- Chromium pro tvorbu náhledů a obrazové soubory značky jsou nyní součástí Docker image;
- migrace starších webů zachovává vlastní porty, kolizi s novým portem brány automaticky převede na režim brány.

## 0.2.3

- velké soubory se přes Home Assistant Ingress nahrávají po 2MB částech místo jediného velkého požadavku;
- skutečný průběh nahrávání se zobrazuje graficky i v procentech;
- přerušená část se automaticky opakuje až třikrát a síťové chyby mají srozumitelnější hlášení;
- postupné nahrávání funguje v dialogu nového webu i ve správci souborů.

## 0.2.2

- opravené načítání hlavní ikony pod Home Assistant Ingress i bez koncového lomítka v adrese;
- písmeno v prázdném stavu homepage nahrazeno novou ikonou MyBrowseru;
- favicon a Apple Touch ikona používají stejnou bezpečnou Ingress cestu.

## 0.2.1

- správce serverů nahrazuje hlavní postranní navigaci namísto zobrazení druhého panelu;
- návrat ze správce obnoví běžnou navigaci MyBrowseru;
- přepracovaný vzhled hlavního postranního panelu ve stylu správce serverů;
- oprava přetékání dlouhých názvů v seznamu serverů.

## 0.2.0

- přejmenování add-onu na MyBrowser;
- hlavní knihovna webů s kartami a náhledy;
- počítadla zobrazení a poslední návštěva;
- oblíbené položky s ručním drag and drop pořadím;
- externí webové odkazy a automatická metadata;
- sandboxovaný proxy viewer s volitelným omezením reklam;
- historické offline verze bez přepisování starších stažení;
- ochrana proxy před přístupem do lokální a privátní sítě;
- oddělení knihovny od technické správy hostovaných serverů;
- číslované složky `/share/Weby/001_Názevwebu` a nahrání souborů už v dialogu nového webu;
- samostatná drop zóna pro úvodní obrázek používaný na kartách webů;
- nový správce, který v jediném postranním panelu nahradí hlavní navigaci seznamem serverů, vyhledáváním a ovládáním; detailní přehled zůstává v hlavní ploše.

## 0.1.0

- první funkční verze;
- statické a SPA weby s drag and drop nahráváním;
- npm a Bun runtime, instalace závislostí a build skripty;
- více webů na uživatelsky zvolených portech;
- autostart jednotlivých webů;
- správa souborů, procesů, logů a nastavení přes Home Assistant Ingress;
- bezpečné omezení cest na `/share`, `/media` a veřejný `/config` add-onu.
