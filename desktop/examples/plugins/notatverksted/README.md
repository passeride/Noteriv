# Notatverksted

En eksempelplugin for Noteriv på desktop, Android og iOS. Den bruker samme `main.js` på alle plattformene.

## Installer

1. Velg **Settings → Plugins → Install plugin from folder** på mobil eller **Community Plugins → Installed → Install** på desktop.
2. Velg mappen `notatverksted`, som inneholder `manifest.json` og `main.js`.
3. Aktiver **Notatverksted** i pluginlisten.

Appen må ha støtte for det felles plugin-API-et på mobil og desktop.

## Prøv selv

1. Kjør **Lag demonotat i vaultet** fra kommandopaletten og åpne `Notatverksted – demo.md` i fillisten. Hvert nytt demonotat får et eget filnavn.
2. Bytt til lesevisning og huk av et punkt. Fremdriftslinjen oppdateres med en gang. Avkrysningene varer så lenge blokken er åpen.
3. Åpne **Notatverksted** fra sidepanelet på desktop eller kommandopaletten på mobilen. Panelet viser ord og linjer for notatet du har åpent.
4. Kjør **Sett inn sjekkliste** mens du redigerer et notat for å legge til din egen blokk. Med et fysisk tastatur kan du også bruke **Ctrl+Shift+Y**.
5. Trykk på ordtellingen i statuslinjen for å se detaljene. Under **Plugin settings → Notatverksted** kan du skjule ordtellingen for denne økten.

| API | I eksempelet |
| --- | --- |
| `api.ui` | Kommandoer, hurtigtast, sidepanel, innstilling, statuslinje og varsler |
| `api.app` | Filbane for notatet som er åpent |
| `api.editor` | Leser notatet og setter inn Markdown ved markøren |
| `api.vault` | Oppretter et demonotat med ledig filnavn |
| `api.events` | Oppdaterer panelet og statuslinjen ved filbytte og redigering |
| `api.markdown` | Gjør en Markdown-kodeblokk om til en interaktiv sjekkliste |
