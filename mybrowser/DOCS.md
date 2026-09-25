# MyBrowser

MyBrowser spojuje osobní knihovnu webů, historický offline archiv a správu statických, npm a Bun serverů.

Po prvním spuštění se v knihovně objeví **Průvodce MyBrowserem**. Jde o skutečný hostovaný web s krátkým návodem k nahrávání, náhledům, bráně a správě serverů. Lze jej upravit nebo trvale odstranit.

## Rychlý start

1. Klikněte na **Přidat** a vyberte hostovaný web nebo externí odkaz. U hostovaného webu se nabídne číslovaná cesta `/share/Weby/001_Názevwebu` a přístup přes bránu `http://IP:3000/nazev-webu/`; do levé zóny přetáhněte soubory webu a do pravé volitelný vlastní obrázek. Velké soubory se nahrávají po částech a průběh ukazuje přesné procento.
2. Kliknutím na kartu otevřete web přímo v hlavní ploše v plnohodnotné relaci Chromia. Fungují styly, JavaScript, formuláře, cookies, historie, klávesnice, posun i výběr souboru. Hvězdičkou nastavte oblíbené položky a přetažením změňte jejich pořadí.
3. U externího odkazu lze omezit reklamy a kdykoli vytvořit novou offline verzi. Starší verze se nepřepisují.
4. Hostované weby nastavujte v části **Správa serverů**. Po jejím otevření se běžný postranní panel nahradí seznamem serverů; detail vybraného serveru zůstane vpravo. Spravovaná složka je standardně `/share/Weby`.
5. Záložka **Soubory** je zároveň file browser. Umožňuje vytvářet složky, filtrovat obsah, stahovat a přejmenovávat soubory a hromadně kopírovat, přesouvat nebo mazat vybrané položky. Při kopírování a přesunu otevřete cílovou složku a klikněte na **Vložit sem**.

Statický server očekává `index.html`. npm/Bun projekt očekává `package.json` a zadaný skript. Externí i hostované weby se otevírají ve skutečném Chromiu odděleném od ovládacího rozhraní. Stažené soubory najdete ve složce `MyBrowser/Stazene` vedle složky `Weby`.

## Důležité

- Reklamní filtr je praktické omezení známých zdrojů, nikoli záruka odstranění každé reklamy.
- Dynamické a přihlašované weby nemusí být v offline verzi kompletní.
- Veřejná brána i volitelné vlastní porty používají HTTP a jsou dostupné přímo v LAN.
- Port 3000 používá ve výchozím nastavení veřejná brána; port 8099 je vyhrazen pro správu. Spouštějte pouze důvěryhodné npm/Bun projekty.

Podrobný návod je v kořenovém `README.md` projektu.
