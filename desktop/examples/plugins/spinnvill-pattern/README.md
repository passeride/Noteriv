# Spinnvill Patterns for Noteriv

Forhåndsvis en Spinnvill-oppskrift som et 2D-mønster i Noteriv på desktop, Android og iOS. Pluginen bruker Spinnvills lokale Patterns-motor med formellag, sirkelmasker, tallmasker og utskjæringskonturer. Mønsteret tegnes på enheten. Tallmasker bruker den lokale skrifttypen.

## Installer og prøv

1. Pakk ut ZIP-filen. Velg `spinnvill-pattern` under **Install plugin from folder** på mobil eller **Community Plugins → Installed → Install** på desktop. Aktiver **Spinnvill Patterns**.
2. Kopier `spinnvill-turbin.json` fra pluginpakken til roten av vaultet.
3. Kjør **Sett inn referanse til Spinnvill-JSON** fra kommandopaletten i et notat. Bruk **Vis Spinnvill-mønster** i lesevisning. Hvis du legger filen i en annen mappe, endrer du stien inne i blokken.

````markdown
```spinnvill-pattern
spinnvill-turbin.json
```
````

Du kan også lime JSON-objektet rett inn i blokken. Kommandoen **Sett inn Spinnvill-eksempel** gjør dette med den samme eksempeloppskriften.

Bruk **Patterns → Import JSON** i en Spinnvill-versjon med JSON-import for å åpne den samme filen. **Export JSON** lagrer en redigerbar oppskrift i samme format. Kopier den tilbake til vaultet og trykk **Oppdater mønster** i Noteriv.

## Bygg pluginpakken

Bruk motoren fra [Spinnvill ved revisjon `5ab339c`](https://github.com/passeride/OpenSpindle/commit/5ab339ccab216f29f2b062bbca0f1ff7db1ff560). Kjør `npm ci` i Spinnvill-repoet. Kjør deretter kommandoen fra roten av Noteriv, med en utmappe utenfor pluginens kildemappe.

```bash
node desktop/examples/plugins/spinnvill-pattern/build.mjs /sti/til/OpenSpindle /sti/til/utmappe
```
