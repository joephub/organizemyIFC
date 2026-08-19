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

De planning gebruikt uitsluitend:

1. NL-SfB Tabel 1, de elemententabel
2. De afgeronde Z hoogte van de gekoppelde `IfcBuildingStorey`

Andere NL-SfB tabellen worden niet gelezen, gecombineerd of vereist. IFC eigenschappen, waaronder `LoadBearing`, worden evenmin gebruikt om de bouwvolgorde te bepalen. `LoadBearing` kan nog wel als aanwezige bronwaarde naar `Dragend` worden gebundeld in het gekozen eigenschappen tabje. Dit staat los van de planningslogica.

De code gebruikt standaard het formaat `fase.Z hoogte.stap`. De Z hoogte wordt naar millimeters omgerekend en afgerond. De bouwlaagnaam heeft geen invloed op de code.

### Vloerconstructies

Alle codes binnen groep `23` worden als echte vloerconstructies behandeld. Zowel `23.1*` als `23.2*` komen dus op hun eigen Z niveau vóór de dragende wanden, kolommen en kernen van dat niveau. Het verschil tussen constructief en niet constructief blijft aanwezig in de oorspronkelijke NL-SfB classificatie, maar veroorzaakt geen andere globale uitvoeringspositie.

Voor een bouwlaag op 3800 millimeter begint de volgorde bijvoorbeeld met:

```text
02.003800.00  Vloerconstructie
02.003800.10  Dragende wanden, kolommen en kernen
02.003800.20  Trappen en hellingbanen
```

Ook groep `13` wordt als vloer op grondslag vóór de bovenliggende bouwkundige elementen geplaatst.

### Binnenwanden en vloerafwerkingen

De vaste volgorde op een bouwlaag is:

```text
05.003800.10  Massieve en spouw binnenwanden
08.003800.10  Vloerafwerklagen
09.003800.10  Vaste systeemwanden
09.003800.20  Verplaatsbare systeemwanden
09.003800.30  Binnenkozijnen en deuren
10.003800.20  Binnenwandafwerkingen
10.003800.40  Plafondafwerkingen
11.003800.10  Definitieve vloerafwerkingen
```

Daarbij worden de specifieke Tabel 1 codes als volgt gebruikt:

| NL-SfB code | Bouwvolgorde |
|---|---|
| `22.11`, `22.12` | Massieve en spouw binnenwanden vóór de vloerafwerklagen |
| `43.21` | Vloerafwerklagen, na installatievoorbereiding en vóór systeemwanden |
| `22.13` | Vaste systeemwanden na de vloerafwerklagen |
| `22.14` | Verplaatsbare systeemwanden na de vaste systeemwanden |
| `43.22`, `43.23` | Definitieve vloerafwerkingen laat in de afbouw |

`43.21` wordt bewust `Vloerafwerklagen` genoemd en niet automatisch `Dekvloer`. Tabel 1 maakt duidelijk dat dit een afwerklaag is, maar specificeert niet in ieder model eenduidig het materiaal of de exacte technische opbouw.

De algemene codes `43`, `43.0`, `43.2` en `43.20` zijn onvoldoende specifiek om te bepalen of het om een vroege vloerlaag of een definitieve vloerafwerking gaat. Zij krijgen daarom geen bedachte positie en vallen terug op:

```text
Code: NM
Omschrijving: Geen bouwvolgorde ingesteld voor deze NL-SfB code
```

Hetzelfde geldt voor andere geldige Tabel 1 codes waarvoor geen regel in `bouwvolgorde_nlsfb.json` staat.

Algemene binnenwandcodes zoals `22`, `22.0`, `22.1` en `22.10` bevatten onvoldoende informatie om het wandtype en daarmee de uitvoeringspositie te bepalen. Voor deze codes wordt bewust niets afgeleid uit eigenschappen.

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

De standaard afronding is één millimeter. Door `bouwlaag_afronding_mm` bijvoorbeeld op `10` of `100` te zetten, kunnen kleine hoogteverschillen tussen discipline modellen worden geneutraliseerd. De bestandsnaam moet `bouwvolgorde_nlsfb.json` blijven.

Wanneer geen bruikbare bouwlaaghoogte aanwezig is, wordt standaard `XXXXXX` als bouwlaagdeel gebruikt.

Objecten zonder herkenbare NL-SfB code en objecten met een code die niet in `nlsfb2021.json` bestaat, krijgen in de bouwvolgorde:

```text
Code: XX
Omschrijving: Geen bouwvolgorde omdat NL-SfB code ontbreekt
```

Een geldige NL-SfB Tabel 1 code waarvoor geen regel in `bouwvolgorde_nlsfb.json` staat, krijgt standaard:

```text
Code: NM
Omschrijving: Geen bouwvolgorde ingesteld voor deze NL-SfB code
```

Ook deze waarden zijn in de JSON aanpasbaar.
