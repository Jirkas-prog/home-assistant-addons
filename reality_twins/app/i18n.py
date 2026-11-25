"""Known app errors in English and Czech; file names and API details stay intact."""

# English is the code/API default. Add other application messages to this mapping.
ERROR_TRANSLATIONS = {
    "Existing TXT filenames must match their image filenames exactly, including letter case.": "Názvy existujících TXT musí přesně odpovídat názvům jejich obrázků, včetně velikosti písmen.",
    "The calendar week must start with a date in YYYY-MM-DD format.": "Začátek týdne kalendáře zadej jako datum ve formátu RRRR-MM-DD.",
    "Choose a calendar week within 366 days of today.": "Vyber týden kalendáře nejvýše 366 dní od dneška.",
    "Home Assistant returned an invalid calendar response.": "Home Assistant vrátil neplatnou odpověď kalendáře.",
    "Choose between 1 and 200 image or caption files.": "Vyber 1 až 200 souborů s obrázky nebo popisky.",
    "Upload each TXT together with its matching JPG or PNG. For photos already in the queue, use Edit text.": "Nahraj každý TXT společně s odpovídajícím JPG nebo PNG. U fotek, které už jsou ve frontě, použij Upravit text.",
    "Publishing is in progress. Add posts after it finishes.": "Právě probíhá publikace. Přidej příspěvky po jejím dokončení.",
    "The queue and data folders must not be symbolic links.": "Složka fronty ani dat nesmí být symbolický odkaz.",
    "The archive folder must not be a symbolic link.": "Archiv nesmí být symbolický odkaz.",
    "Invalid file name.": "Neplatný název souboru.",
    "Invalid archive path.": "Neplatná cesta archivu.",
    "Symbolic links are not allowed in the queue.": "Symbolické odkazy nejsou ve frontě povoleny.",
    "The item is not a regular file.": "Položka není běžný soubor.",
    "The journal points outside the queue and archive.": "Journal odkazuje mimo frontu a archiv.",
    "The journal contains an unsafe path.": "Journal obsahuje nebezpečnou cestu.",
    "The file changed while being moved; the queue remains locked.": "Soubor se během přesunu změnil; fronta zůstává uzamčena.",
    "Unknown queue journal format.": "Neznámý formát journalu fronty.",
    "Post not found.": "Příspěvek nebyl nalezen.",
    "Publishing attempt not found.": "Pokus o publikaci nebyl nalezen.",
    "Publishing is in progress. Change the order after it finishes.": "Právě probíhá publikace. Pořadí lze změnit po jejím dokončení.",
    "The queue supports at most 9999 active posts.": "Fronta podporuje nejvýše 9999 aktivních příspěvků.",
    "The order must be a list of IDs.": "Pořadí musí být seznam ID.",
    "The caption must be text with at most 2200 characters.": "Popisek musí být text do 2200 znaků.",
    "Invalid publishing slot identifier.": "Neplatný identifikátor termínu publikace.",
    "Invalid attempt update.": "Neplatná aktualizace pokusu.",
    "Publication requires a verified HTTPS link.": "Zveřejnění potřebuje ověřený HTTPS odkaz.",
    "The error must be text.": "Chyba musí být text.",
    "Describe how you verified that the post was not published.": "Zapište, jak jste ověřili, že příspěvek nebyl zveřejněn.",
    "The target post archive already exists.": "Archiv cílového příspěvku již existuje.",
    "The temporary rename path already exists.": "Dočasná cesta přejmenování již existuje.",
    "The image is missing or has changed since import. Restore the original file.": "Obrázek chybí nebo byl od zařazení změněn. Obnovte původní soubor.",
    "The queue has changed. Refresh it and move the post again.": "Fronta se změnila. Obnovte ji a přetáhněte příspěvek znovu.",
    "The caption of an in-flight or published post cannot be changed.": "Popisek rozpracovaného nebo zveřejněného příspěvku nelze změnit.",
    "The caption exceeds 2200 characters.": "Popisek má více než 2200 znaků.",
    "A closed attempt cannot be overwritten.": "Uzavřený pokus nelze přepsat.",
    "Use finish/fail/resolve_not_published to save this state.": "Tento stav se ukládá přes finish/fail/resolve_not_published.",
    "This post has a newer attempt or has already been archived.": "Příspěvek již má novější pokus nebo byl archivován.",
    "A closed attempt cannot be marked as failed.": "Uzavřený pokus nelze označit za chybu.",
    "A newer publishing attempt exists for this post.": "Existuje novější pokus o publikaci tohoto příspěvku.",
    "Only failures before sending can be retried. Verify an uncertain result on the profile first.": "Opakovat lze pouze chybu před odesláním. Nejasný výsledek nejdříve ověřte na profilu.",
    "Restore the original image and caption first.": "Nejdříve obnovte původní obrázek a popisek.",
    "Manual confirmation is only available for an uncertain publishing result.": "Ruční potvrzení je určeno pouze pro nejasný výsledek publikace.",
    "The file changed during renaming.": "Soubor se během přejmenování změnil.",
    "Rename recovery encountered a different file.": "Obnovení přejmenování narazilo na jiný soubor.",
    "Two files would have the same name.": "Dva soubory by měly stejný název.",
    "The image is missing or has changed since import.": "Obrázek chybí nebo byl od zařazení změněn.",
    "The caption file is missing.": "Chybí soubor popisku.",
    "A file is missing or has changed before publishing.": "Před publikací chybí nebo se změnil soubor.",
    "The calendar must be an object.": "Kalendář musí být objekt.",
    "Invalid timezone.": "Neplatná časová zóna.",
    "now must include a timezone.": "now musí obsahovat časovou zónu.",
    "The checking window must be between 0 and 3600 seconds.": "Kontrolní okno musí být 0–3600 sekund.",
    "The number of upcoming slots must be between 1 and 1000.": "Počet dalších termínů musí být 1–1000.",
    "Unknown IANA timezone.": "Neznámá časová zóna IANA.",
    "The calendar supports at most 1000 rules of each type.": "Kalendář smí obsahovat nejvýše 1000 pravidel každého typu.",
    "A calendar rule must be an object.": "Pravidlo kalendáře musí být objekt.",
    "Each rule needs a unique ID (letters, numbers, - or _).": "Každé pravidlo potřebuje jedinečné ID (písmena, čísla, - nebo _).",
    "enabled must be true or false.": "enabled musí být true nebo false.",
    "Days must be unique numbers from 0 to 6 (Monday to Sunday).": "Dny jsou jedinečná čísla 0–6 (pondělí–neděle).",
    "Time must use the HH:MM format.": "Čas musí mít formát HH:MM.",
    "A one-time slot requires an ISO date and time.": "Jednorázový termín potřebuje ISO datum a čas.",
    "Invalid ISO date and time.": "Neplatné ISO datum a čas.",
    "This local time does not exist during the daylight-saving change.": "Tento místní čas při změně na letní čas neexistuje.",
    "Scheduled post": "Naplánovaný příspěvek",
}

# Dynamic portions are filenames, never translated or interpreted as markup.
ERROR_TEMPLATES = [
    ('Instagram API rejected the request (code ', ').', 'Instagram API odmítlo požadavek (kód ', ').'),
    ("The source is missing or changed during renaming: ", "", "Zdroj během přejmenování chybí nebo se změnil: ", ""),
    ("File missing: ", "", "Soubor chybí: ", ""),
    ("Target file already exists: ", "", "Cílový soubor již existuje: ", ""),
    ("Multiple caption files for ", "; keep only one.", "Dva možné popisky pro ", "; ponechte jen jeden."),
    ("Multiple images share the caption ", ".", "Více obrázků sdílí popisek ", "."),
    ("Caption ", " exceeds 2200 characters.", "Popisek ", " má více než 2200 znaků."),
]


def translate_error(message, lang="en"):
    text = str(message)
    czech = str(lang).lower().split("-")[0] == "cs"
    mapping = ERROR_TRANSLATIONS if czech else {value: key for key, value in ERROR_TRANSLATIONS.items()}
    if text in mapping:
        return mapping[text]
    for en_prefix, en_suffix, cs_prefix, cs_suffix in ERROR_TEMPLATES:
        prefix, suffix, target_prefix, target_suffix = (
            (en_prefix, en_suffix, cs_prefix, cs_suffix) if czech
            else (cs_prefix, cs_suffix, en_prefix, en_suffix))
        if text.startswith(prefix) and text.endswith(suffix) and len(text) >= len(prefix) + len(suffix):
            value = text[len(prefix):len(text) - len(suffix) if suffix else None]
            return target_prefix + value + target_suffix
    return text


from .messages import MESSAGES
ERROR_TRANSLATIONS.update(MESSAGES)
