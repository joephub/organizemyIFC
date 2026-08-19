# Organize my IFC

Een statische webapp die aanwezige IFC informatie bundelt in één nieuw eigenschappen tabje. Eén of meer IFC modellen kunnen in dezelfde verwerking worden geselecteerd. De verwerking gebeurt volledig in de browser.

## Direct op GitHub Pages plaatsen

1. Plaats alle bestanden uit deze map in de hoofdmap van een GitHub repository.
2. Open in GitHub `Settings` en daarna `Pages`.
3. Kies `Deploy from a branch` en selecteer de gewenste branch met map `/(root)`.
4. Open daarna de door GitHub Pages aangemaakte website.

Er is geen build stap, package manager of servercode nodig.

## Meerdere IFC modellen

Via het uploadvlak kunnen één of meer `.ifc` bestanden tegelijk worden gekozen of gesleept. De modellen worden achter elkaar en volledig lokaal verwerkt.

Bij één model wordt een nieuw IFC bestand aangeboden. Bij meerdere modellen maakt de app één ZIP bestand met daarin voor ieder bronmodel een afzonderlijk georganiseerd IFC bestand. Modellen worden niet samengevoegd. Hierdoor blijven de oorspronkelijke modelgrenzen, disciplines en bestandsnamen herkenbaar.

Wanneer één bestand uit een selectie niet kan worden verwerkt, gaat de app verder met de overige bestanden. De beschikbare resultaten worden alsnog in het ZIP bestand geplaatst en de mislukte bestandsnaam wordt in de meldingen genoemd.

## Verwerkingsinformatie in het IFC model

Aan het aanwezige `IfcProject` wordt het gebruikersgedefinieerde PropertySet `Cpset_OrganizeMyIFC` gekoppeld. Dit PropertySet bevat:

1. `Applicatie`
2. `Versie`
3. `Verwerkt op`
4. `Bronbestand`
5. `Bewerkingen`

`Bewerkingen` bevat een korte samenvatting van de werkelijk uitgevoerde onderdelen, bijvoorbeeld het bundelen van eigenschappen, het harmoniseren van NL-SfB en het toevoegen van bouwvolgorde. De bestaande exporteur, auteur en oorspronkelijke `IfcOwnerHistory` worden niet overschreven.

Wanneer een model opnieuw door de app wordt verwerkt, wordt het bestaande `Cpset_OrganizeMyIFC` bijgewerkt in plaats van nog een gelijknamig PropertySet toe te voegen.

## NL-SfB bijwerken

Vervang alleen `nlsfb2021.json` door een nieuwe versie met dezelfde bestandsnaam en dezelfde hoofdstructuur met het veld `Classes`. De app leest dit bestand bij ieder bezoek opnieuw in met uitgeschakelde browsercache.

De meegeleverde bron is één op één gekopieerd. De parser accepteert ook de aanwezige afsluitende komma's in het bestand.

## Bestanden

- `index.html`: de pagina en de ingebouwde visualisatie
- `styles.css`: vormgeving
- `app.js`: bediening, instellingen en laden van de JSON bestanden
- `worker.js`: lokale verwerking en export van IFC
- `nlsfb2021.json`: officiële NL-SfB namen en codes
- `bouwvolgorde_nlsfb.json`: vaste bouwvolgorde per NL-SfB code en bouwlaag

## Gebruik

De site moet via GitHub Pages of een andere webserver worden geopend. Rechtstreeks dubbelklikken op `index.html` kan het laden van `nlsfb2021.json` blokkeren door browserbeveiliging.

Ondersteunde STEP IFC schema's:

- IFC 2x3
- IFC 4
- IFC 4x3

Voor het eigenschappen tabje neemt de tool bestaande IFC waarden over. Standaard eigenschappen worden uitsluitend gelezen uit IFC PropertySets waarvan de naam past bij `Pset_.*Common`. De enige automatische aanvulling is de afgesproken NL-SfB code `XX` voor geometrische objecten zonder herkenbare NL-SfB codering.

De standaardkoppelingen zijn:

- `IsExternal` naar `Buiten`
- `LoadBearing` naar `Dragend`
- `FireRating` naar `WBDBO`
- `AcousticRating` naar `Geluidwerendheid`
- `ThermalTransmittance` naar `Warmtedoorgangscoëfficiënt`

Een koppeling wordt alleen toegevoegd wanneer de bronwaarde werkelijk op het IFC object aanwezig is.

In de geavanceerde instellingen worden de vaste IFC velden aangeduid met hun herkenbare termen, waaronder `IFC entiteit` en `IFC PredefinedType`.

De standaard herkenbare classificatienamen zijn:

- `Uniformat`
- `Uniformat Classification`

Classificatienamen met `NL-SfB`, `NL/SfB`, `NLSfB` of een vergelijkbare schrijfwijze worden automatisch herkend. Via het plusje kan een projectspecifieke naam worden toegevoegd, bijvoorbeeld `Assembly Code`. De ingevoerde naam wordt vergeleken met de naam van de classificatiemethode in het IFC model.

Wijzigingen in de geavanceerde instellingen worden direct toegepast en lokaal in de browser bewaard. Met `Herstel standaardinstellingen` worden alle namen, koppelingen en classificatienamen teruggezet naar de meegeleverde standaard.


De visualisatie toont `FireRating` aan de modelzijde en `WBDBO` in het eigenschappen tabje. De waarde blijft daarbij één op één gelijk.

## NL-SfB structurering

Herkende NL-SfB classificaties krijgen de vaste naam `NL-SfB tabel 1`. De omschrijving van iedere bestaande classificatiecode wordt opnieuw uit `nlsfb2021.json` gelezen. Wanneer een code niet in de JSON voorkomt, wordt de omschrijving `Onbekende NL-SfB codering` gebruikt.

Ieder geschikt IFC object met een geometrische representatie maar zonder herkenbare NL-SfB code krijgt:

- code `XX`
- omschrijving `Geen NL-SfB codering`

Ruimtelijke objecten zoals `IfcBuildingStorey` krijgen deze code niet.

De afgeleide classificatie heet `NL-SfB tabel 1 (2 cijferig)`. De code blijft als afzonderlijke classificatiecode bewaard. De naam van de classificatiereferentie bevat alleen de omschrijving, bijvoorbeeld code `53` met de naam `Water`.

Objecten met een ontbrekende NL-SfB code en objecten met een code die niet in `nlsfb2021.json` voorkomt, worden in deze tweecijferige classificatie samengevoegd onder:

- code `XX`
- omschrijving `Geen of onbekende NL-SfB codering`
## Bouwvolgorde

In de geavanceerde instellingen staat de optie `Voeg bouwvolgorde toe`. Deze optie staat standaard uit.

Wanneer de optie aan staat, krijgen geometrische IFC objecten twee extra eigenschappen in het gekozen eigenschappen tabje:

1. `Bouwvolgorde code`
2. `Bouwvolgorde omschrijving`

Dezelfde informatie wordt als IFC classificatie toegevoegd met de naam `Bouwvolgorde`.

De code gebruikt standaard het formaat `fase.Z hoogte.stap`. De Z hoogte van de gekoppelde `IfcBuildingStorey` wordt naar millimeters omgerekend en afgerond. De bouwlaagnaam heeft geen invloed op de code.

Voor een bouwlaag op 3800 millimeter ontstaat standaard deze volgorde:

```text
02.003800.00  Constructieve verdiepingsvloer
02.003800.10  Dragende wanden, kolommen en kernen
02.003800.20  Trappen en hellingbanen
04.003800.00  Niet constructieve vloer
04.003800.10  Niet dragende buitenwanden / Buitenspouwbladen
05.003800.10  Niet dragende binnenwanden
08.003800.10  Buitenwandafwerkingen
08.003800.20  Binnenwandafwerkingen
08.003800.30  Vloerafwerkingen
```

De specifieke NL-SfB code is leidend. Daardoor wordt `23.2*` als constructieve vloer behandeld en krijgt deze een lager stapnummer dan dragende wanden op hetzelfde Z niveau. `23.1*` wordt als niet constructieve vloer behandeld. De groepen `21.1*`, `22.1*`, `21.2*` en `22.2*` worden eveneens afzonderlijk verwerkt.

Bij een algemene code zoals `23`, `21` of `22` gebruikt de tool de aanwezige IFC eigenschap `LoadBearing` wanneer deze beschikbaar is. Wanneer zowel de code als de eigenschap de constructiviteit niet aangeven, gebruikt de tool een neutrale regel met een eigen vaste code.

De afwerkingsgroepen `41`, `42`, `43`, `44`, `45`, `47` en `48` staan in een afzonderlijke latere fase. Zij worden daardoor niet meer gemengd met de constructieve vloer, niet constructieve vloer of wanden.

Classificatiereferenties voor de bouwvolgorde worden in oplopende fase, Z hoogte en stap aangemaakt. Hierdoor tonen viewers die de IFC volgorde volgen de classificatiereferenties eveneens in een logische volgorde.

In `bouwvolgorde_nlsfb.json` zijn onder meer deze instellingen aanpasbaar:

1. `code_formaat`
2. `omschrijving_formaat`
3. `bouwlaag_afronding_mm`
4. `bouwlaag_z_breedte`
5. `bouwlaag_onbekend_code`
6. `fase_id`
7. `volgorde_nummer`
8. `nlsfb_codes`
9. `bouwlaag_selectie`
10. `omschrijving`
11. `dragend`

De standaard afronding is één millimeter. Door `bouwlaag_afronding_mm` bijvoorbeeld op `10` of `100` te zetten, kunnen kleine hoogteverschillen tussen discipline modellen worden geneutraliseerd. De bestandsnaam moet `bouwvolgorde_nlsfb.json` blijven.

Wanneer geen bruikbare bouwlaaghoogte aanwezig is, wordt standaard `XXXXXX` als bouwlaagdeel gebruikt.

Objecten zonder herkenbare NL-SfB code en objecten met een code die niet in `nlsfb2021.json` bestaat, krijgen in de bouwvolgorde:

```text
Code: XX
Omschrijving: Geen bouwvolgorde omdat NL-SfB code ontbreekt
```

Een geldige NL-SfB code waarvoor geen regel in `bouwvolgorde_nlsfb.json` staat, krijgt standaard:

```text
Code: NM
Omschrijving: Geen bouwvolgorde ingesteld voor deze NL-SfB code
```

Ook deze waarden zijn in de JSON aanpasbaar.
