# Organize my IFC

Een statische webapp die aanwezige IFC informatie bundelt in één nieuw eigenschappen tabje. De verwerking gebeurt volledig in de browser.

## Direct op GitHub Pages plaatsen

1. Plaats alle bestanden uit deze map in de hoofdmap van een GitHub repository.
2. Open in GitHub `Settings` en daarna `Pages`.
3. Kies `Deploy from a branch` en selecteer de gewenste branch met map `/(root)`.
4. Open daarna de door GitHub Pages aangemaakte website.

Er is geen build stap, package manager of servercode nodig.

## NL-SfB bijwerken

Vervang alleen `nlsfb2021.json` door een nieuwe versie met dezelfde bestandsnaam en dezelfde hoofdstructuur met het veld `Classes`. De app leest dit bestand bij ieder bezoek opnieuw in met uitgeschakelde browsercache.

De meegeleverde bron is één op één gekopieerd. De parser accepteert ook de aanwezige afsluitende komma's in het bestand.

## Bestanden

- `index.html`: de pagina en de ingebouwde visualisatie
- `styles.css`: vormgeving
- `app.js`: bediening, instellingen en laden van NL-SfB
- `worker.js`: lokale verwerking en export van IFC
- `nlsfb2021.json`: officiële namen en codes

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

