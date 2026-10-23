# Datenschutz-Statement

Der folgende Text ist die Aussage, die Beifahrer über sich selbst macht. Jede inhaltliche Aussage
trägt einen `file:line`-Verweis in den Baum, gegen den sie geschrieben wurde (`0.1.0`, Branch ab
`b79a9bd`), damit eine prüfende Person das nachprüfen kann, statt es glauben zu müssen. Aussagen,
die im Code nicht nachprüfbar sind, sind als solche gekennzeichnet statt behauptet.

Diesen Text als Webseite veröffentlichen und die URL in jedem Store-Formular angeben. Chrome, Edge
und AMO verlangen alle eine URL, und Chromes Programmrichtlinien sind eindeutig, dass eine
ungenaue Datenschutzerklärung — einschließlich einer, die dem Verhalten der Erweiterung
widerspricht — Grund für eine Entfernung ist
([Programmrichtlinien](https://developer.chrome.com/docs/webstore/program-policies/policies)).

---

## 1. Was Beifahrer tut

Beifahrer ist eine Browser-Erweiterung. Sie lässt einen KI-Agenten in **deinem eigenen Browser**
arbeiten, im Profil und in der Sitzung, die du bereits geöffnet hast — deinen eingeloggten Tabs,
deinen Erweiterungen, deiner Historie. Es startet keinen zweiten Browser.

Der Agent spricht mit dem Browser über ein kleines lokales Programm — die *Bridge* — das **du**
auf deinem eigenen Rechner ausführst. Die Bridge ist der Prozess, mit dem der Agent spricht; sie
hält keine eigenen Daten und ist kein Dienst.

Für jede Aktion, die der Agent ausführen will, prüft Beifahrer eine seitenbezogene Richtlinie,
**die du festlegst**, und fragt dich dann nach Aktionen, die diese Richtlinie noch nicht abdeckt.
Die Reihenfolge ist fest, und jede Methode durchläuft sie:

1. bist du pausiert? — der Notausschalter verweigert alles, auch das Auflisten deiner Tabs
2. ist die Funktion eingeschaltet? — ein Schalter pro Fähigkeit
3. die seitenbezogene Stufe, die du für diesen Ursprung eingestellt hast
4. die eigene Host-Berechtigung des Browsers für diesen Ursprung
5. bei Änderungen ein Bestätigungsfenster

Erst dann erreicht der Agent die Seite. `extension/src/handlers.ts:1-13` nennt die Reihenfolge;
`extension/src/handlers.ts:1430` führt die Schritte 1 und 2 aus, bevor irgendein Handler erreicht
werden kann; `extension/src/handlers.ts:168` führt Schritt 3 für jede Methode aus.

Die Richtlinie schlägt grundsätzlich fehl-geschlossen (fail closed) zu. Ein unbekannter Ursprung
ist `none`. Eine Nicht-Web-Adresse hat keinen Ursprung. Eine Methode, die zu keiner Funktion
gehört, wird verweigert. `packages/core/src/features.ts:188-194` sind die ersten zwei Schritte;
`extension/src/handlers.ts:169` verweigert alles, was die Richtlinie nicht erlaubt, und markiert
es nicht als erfragbar.

## 2. Die Richtlinie wird in der Erweiterung durchgesetzt, nicht in der Bridge

Die Bridge ist der Prozess, mit dem der Agent spricht — eine Prüfung dort wäre eine Prüfung, die
die Seite des Agenten kontrolliert. Die Entscheidung fällt in der Erweiterung, in Code, den der
Agent nicht erreichen kann: `packages/core/src/policy.ts` entscheidet,
`extension/src/handlers.ts:168` ruft das vor jedem Seitenzugriff auf, und die Bridge hat dazu
keinen Aufruf — `app/src/bridge/bridge.ts` importiert `REQUIRED_LEVEL` nur für eine Sache: wie
lange auf eine Antwort gewartet wird (`app/src/bridge/bridge.ts:126`).

Die eigene MCP-Schicht der Bridge verweigert die Freigabe eines Tools, das ein Client als
schreibgeschützt markiert hat, ohne `readOnlyHint: true`, und schlägt fehl-geschlossen zu, indem
sie es verwirft (`applyReadOnlyGate`, aufgerufen in `app/src/frontends/mcp/server.ts`). Das Gate
selbst stammt seit 0.54.0 aus `@gjsify/mcp` — bis dahin war es die eigene `runtime.ts` dieses
Repositories, die dritte wortgetreue Kopie der von curlew — und
`app/tests/unit/mcp/gate.test.ts` fixiert die Richtung, in der es prüft, denn ein Gate, das dieses
Repository nicht besitzt, ist der eine Fall, in dem "es wurde hier einmal getestet" aufhört,
Beleg zu sein.

**Nicht im Code nachprüfbar:** was die betreibende Person der Bridge außerhalb dieses
Repositories tut. Wenn du eine von jemand anderem gebaute Bridge betreibst, entscheidet dieser
Code, wonach der Agent fragen darf. Die obige Aussage bezieht sich auf Beifahrers eigene Bridge,
also dieses Repository.

## 3. Die Bridge hört nur auf deinem Rechner, und nur für diese Erweiterung

Die Bridge bindet an `127.0.0.1` — das Loopback-Interface, das aus dem Netzwerk nicht erreichbar
ist (`app/src/bridge/bridge.ts:156`). Eine Verbindung wird **im Handshake verweigert, bevor ein
Socket existiert**, es sei denn, beides gilt: die Gegenstelle hat eine Loopback-Adresse
(`packages/core/src/protocol.ts:548`) und der `Origin` des Handshakes ist ein
Browser-Erweiterungs-Ursprung — `moz-extension:`, `chrome-extension:`, `ephy-webextension:` oder
`safari-web-extension:` (`packages/core/src/protocol.ts:582`, verwendet in
`app/src/bridge/bridge.ts:161-162`). Eine Webseite kann einem WebSocket-Handshake keinen dieser
Ursprünge geben, also erreicht eine Seite auf irgendeiner Site, die `ws://127.0.0.1:<port>`
öffnet, nie überhaupt das Token.

Das Token wird zeitkonstant verglichen (`packages/core/src/protocol.ts:570`).

Die Erweiterung baut ausschließlich `ws://127.0.0.1:<port>/` auf, mit dem Port aus ihrem eigenen
konfigurierten Bereich (`extension/src/bridge-client.ts:141`). Es gibt keinen Host, keinen Namen,
keinen Konfigurationswert, der woanders hinzeigen könnte.

## 4. Nichts verlässt dein Gerät

Es gibt keine Telemetrie, keine Analyse, keine Absturzberichte, keine Update-Pings und keinen
entfernten Endpunkt jeglicher Art. Die einzige Netzwerkverbindung, die die Erweiterung öffnet, ist
der Loopback-Socket oben.

Das ist nachprüfbar, und die Prüfung lohnt sich nach jeder Änderung erneut:

- das einzige `WebSocket` in der Erweiterung ist die Loopback-Probe oben
  (`extension/src/bridge-client.ts:141`);
- das einzige `fetch` in der gesamten Erweiterung ist `page.download`, das ein Dokument lädt,
  **auf das die Seite verlinkt, auf der du bereits bist**, von **demselben Ursprung**, in der
  eigenen Sitzung dieser Seite (`extension/entrypoints/page-agent.ts:1354`; die
  Same-Origin-Regel ist `packages/core/src/download.ts:40`). Es liest; es sendet nie etwas, und
  die Bytes kommen über den Loopback-Socket zurück, statt auf deine Festplatte geschrieben zu
  werden (`extension/entrypoints/page-agent.ts:1321-1331`);
- es gibt kein `XMLHttpRequest` und kein `navigator.sendBeacon` irgendwo in der Erweiterung;
- die Bridge enthält weder `fetch`, noch `XMLHttpRequest`, noch `sendBeacon` (`app/src`);
- die einzigen `http(s)://`-Literale im Quelltext der Erweiterung sind die eigenen
  Host-Berechtigungsmuster des Browsers (`extension/src/settings.ts:95`,
  `extension/src/network.ts:196`), ein `example`-Ursprung im End-to-End-Test-Seed
  (`extension/src/e2e-seed.ts:55`), und ein Kommentar (`extension/src/settings.ts:79`).

**Du bist die einzige Partei dabei.** Die Bridge ist dein Prozess, auf deinem Rechner, liest den
Storage deiner Erweiterung und deinen Browser.

### Was die Erweiterung deklariert

Für den Firefox-Build deklariert das Manifest `data_collection_permissions: { required: ['none'] }`
(`extension/manifest.ts:151`), Mozillas Kategorie für "nichts verlässt das Gerät". Diese Aussage
ist konsistent mit dem obigen Code und mit Abschnitt 4 insgesamt: der einzige Kanal, den die
Erweiterung hat, ist der Loopback-Socket, und die Bridge, die er erreicht, ist die, die du
gestartet hast.

## 5. Wo deine Daten liegen

Alles, was Beifahrer weiß, liegt in **deinem Browser-Profil**, im eigenen Storage der Erweiterung.
Nichts wird in den Storage der Bridge geschrieben, und nichts wird an einen Server gesendet.

| Was | Wo | Code |
|---|---|---|
| deine seitenbezogene Richtlinie, Funktionsschalter, Pausenzustand, Token, Port | `storage.local` dieses Profils | `extension/src/settings.ts:45-70`, geschrieben in `extension/src/settings.ts:73` |
| temporäre Freigaben ("alle Seiten", "für diese Sitzung") | `storage.session` — nie in der gespeicherten Richtlinie, weg beim Browser-Neustart | `extension/src/grants.ts:6` |
| das Aktivitätsprotokoll im Popup | `storage.session` wo verfügbar, sonst nur im Speicher | `extension/src/activity.ts:7-8` |
| gespeicherte Sitzungen (deine Fenster und Tabs) | `storage.local` dieses Profils, **nie auf der Bridge** | `extension/src/sessions-store.ts:4-5`, gelesen in `extension/src/sessions-store.ts:38` |
| das Anfrage-Protokoll, wenn eingeschaltet | im Speicher, ein Puffer pro Tab, auf 200 Zeilen gedeckelt, verworfen beim Schließen des Tabs oder nach zehn Minuten Ruhe | `extension/src/network.ts:52,73-77,89-95` |

Dass gespeicherte Sitzungen im Browser liegen statt neben dem Agenten, ist eine Entscheidung mit
eigener Begründung, [ADR 0004](../adr/0004-sessions-live-in-the-browser.md).

Was das Aktivitätsprotokoll festhält: Zeit, Methode in Worten, den **Host**, das Ergebnis und eine
gekappte Vorschau einer Eingabe. Nie Seitentext (`extension/src/activity.ts:5-6`).

## 6. Was der Agent sehen kann, und was nicht

- **Ein Tab auf einer Site, die du nicht erlaubt hast, zeigt nur dessen Host** — kein Titel, kein
  Pfad, keine Abfragezeichenfolge. `packages/core/src/redact.ts:53-55` fügt URL und Titel nur
  hinzu, wenn die Site über Stufe `none` liegt. Der Tab einer Bank bleibt "ein Tab auf der Bank",
  nie "Kontoauszug — Saldo …".
- **Ein Frame wird nach seinem eigenen Ursprung beurteilt, nicht nach dem der Seite.** Eine
  eingebettete Seite von einer Site, die du nicht erlaubt hast, wird nie gefragt, also ist sie in
  der Gliederung, beim Lesen und beim Suchen unsichtbar, während die Seite drumherum lesbar
  bleibt. Eine Site freizugeben gibt nicht frei, was diese Site einbettet.
- **Änderungen werden dir gezeigt, bevor sie passieren.** Ein Feld ausfüllen, klicken, auswählen,
  ankreuzen, eine Taste drücken und einen Tab schließen öffnen jeweils ein Fenster, das die Site
  und das Element nennt. Du kannst antworten oder es verstreichen lassen, und ein Timeout ist eine
  Verweigerung.
- **Unterhalb der von dir gesetzten Stufe kann Beifahrer dich spontan fragen.** Wenn du die Stufe
  einer Site per Klick anhebst, oder ein Agent um etwas darunter bittet, nennt ein Fenster den
  Ursprung und die benötigte Stufe, und die Antwort kann einmalig, für diese Sitzung, immer oder
  nein sein ([ADR 0010](../adr/0010-temporary-access-and-asking-on-demand.md),
  `packages/core/src/policy.ts`). Eine von dir blockierte Site wird nie gefragt, und es gibt keine
  gemerkte Antwort für eine blockierte Site. Du kannst das Nachfragen auch ganz abschalten, dann
  wird eine Anfrage unterhalb der Stufe sofort verweigert.
- **Eine eingebettete Frame-Seite wird als solche benannt**, sodass die Formulierung nie
  versehentlich die oberste Site nennt (`extension/src/page-indicator.ts`, die Strings
  `pill_reading_frame` / `pill_editing_frame` in `extension/_locales/en/messages.json`).
- **Nur du setzt fort.** Die Pause verweigert jede Methode, auch das Auflisten von Tabs. Das
  Popup, die Optionsseite, der In-Page-Stopp-Button und eine Tastenkombination setzen sie; nur
  Popup, Optionsseite und die Kombination heben sie auf. Keine vom Agenten aufrufbare Methode
  berührt sie (`packages/core/src/features.ts:190`;
  [ADR 0005](../adr/0005-the-person-sees-and-stops-the-agent.md)).
- **Der Agent sieht, dass der Agent auf der Seite ist.** Eine kleine Markierung erscheint im Tab,
  während gearbeitet wird, und verschwindet etwa drei Sekunden nach dem Stopp, sowie unmittelbar
  vor jedem Screenshot (`extension/src/page-indicator.ts:11`,
  `extension/src/page-indicator.ts:117`, und `extension/src/handlers.ts:1056`, das sie vor der
  Aufnahme ausblendet). Die Markierung lebt in einem **geschlossenen** Shadow-Root
  (`extension/src/page-indicator.ts:46`), sodass die Seite ihren Text nicht lesen kann und ein in
  der Seite laufendes Skript sie nicht entfernen kann.

## 7. Warum die Berechtigungen für je einen Ursprung einzeln erfragt werden

Eine WebExtension-Host-Berechtigung ist eine Browser-weite Alles-oder-nichts-Freigabe. Jede Site
im Voraus anzufragen wäre genau das eine, das dieses Projekt nie tun darf: es würde den
Installations-Dialog — den einen Moment, in dem eine Person tatsächlich Nein sagen kann — zu einer
Liste von nichts machen.

Beifahrer deklariert also **keine** Host-Berechtigungen im Installations-Dialog. Alle drei Muster
sind optional (`extension/manifest.ts:26`, verdrahtet in `extension/manifest.ts:114` für Manifest
V3 und `extension/manifest.ts:120` für Manifest V2):

- `http://*/*` + `https://*/*` — die temporäre "alle Seiten"-Freigabe, aus dem Popup angefragt und
  entfernt, wenn sie endet (`extension/src/settings.ts:95`,
  `extension/entrypoints/popup/main.ts:202`), damit das Ende einer Freigabe nicht still eine
  andere mit wegnimmt ([ADR 0010](../adr/0010-temporary-access-and-asking-on-demand.md))
- `<all_urls>` — die eigene Anforderung des Browsers für Screenshots
- ein Muster pro Ursprung, angefragt **in dem Klick, der die Stufe dieses Ursprungs angehoben hat**
  (`extension/entrypoints/popup/main.ts:174`) oder **in dem Klick, der eine Zugriffsanfrage
  beantwortet hat** (`extension/entrypoints/confirm/main.ts:134`)

Jede Freigabe wird im Moment der Nutzung geprüft, und die Freigabe des Browsers ist ein zweiter
Zaun hinter deiner Richtlinie, kein Ersatz dafür (`extension/src/handlers.ts:176`; warum die
Richtlinie — genauer Ursprung, Port eingeschlossen — statt der Host-weiten Freigabe des Browsers
das Gate ist, steht in `extension/src/settings.ts:76-83`).

Eine temporäre Freigabe gibt den Host-Zugriff zurück, wenn sie endet
(`extension/src/grants.ts:145`).

## 8. Die optionalen Berechtigungen, und was jede davon kauft

Keine davon wird bei der Installation gewährt. Jede wird im selben Klick angefragt, der die
Funktion einschaltet, und der Schalter bleibt aus, wenn du Nein sagst.

| Berechtigung | Was sie kauft | Wo angefragt | Warum nicht im Voraus |
|---|---|---|---|
| `webRequest` | **Seitenanfragen sehen** — ein Protokoll dessen, was eine Seite angefragt hat, mit Zeiten. Standardmäßig aus. | `extension/entrypoints/options/main.ts:203` | ein Protokoll von allem, was dein Browser tut, ist eine Browsing-Historie mit Zeitstempeln, und anders als eine Host-Berechtigung lässt es sich **nicht** auf eine Site eingrenzen — es gibt keine seitenbezogene Form davon (`extension/manifest.ts:29-38`, `packages/core/src/features.ts:101-105`) |
| `<all_urls>` | **Screenshots** — die `captureVisibleTab`-API des Browsers akzeptiert nichts Engeres, und Firefox definiert sie ohne die Freigabe gar nicht. Standardmäßig aus. | `extension/entrypoints/options/main.ts:172` | die eigene API des Browsers hat keine engere Form (`extension/manifest.ts:21-23`, pro Aufruf geprüft in `extension/src/handlers.ts:1039`) |
| `http://*/*` + `https://*/*` | **Gespeicherte Sitzungen und Tab-Verwaltung** — speichern, wiederherstellen, sortieren, anpinnen, schließen, gruppieren von Fenstern und Tabs. Standardmäßig aus. | `extension/entrypoints/popup/main.ts:202` | eine Sitzung ist eine Liste deiner Tabs, also ist das deine Browsing-Historie; gehört hinter einen Schalter, den du setzt, nicht in den Installations-Dialog |
| `downloads` | **Versteckte Downloads abfangen** — einen Download sehen, den die Seite außer Sicht startet, und die Kopie des Browsers entfernen, sobald der Agent die Bytes hat. Standardmäßig aus; die Berechtigung wird im selben Klick angefragt und nur während einer Aufnahme beobachtet. | `extension/src/saves.ts`; `extension/entrypoints/options/main.ts` | die Berechtigung kann Downloads auflisten und löschen, also ist sie optional, ein eigener Schalter, und nie außerhalb einer Aufnahme genutzt ([ADR 0019](../adr/0019-capture-a-download-the-page-starts-out-of-sight.md)) |
| `webRequest` + `script`-Funktion | **Das eigene Skript des Agenten in einer Seite ausführen** — standardmäßig aus, braucht die Stufe `write`, und fragt **immer**, zeigt dir das ganze Skript | `extension/entrypoints/confirm/main.ts:134`; `packages/core/src/policy.ts:219` | ein Skript ist Code, den du nicht gelesen hast und der in einer Seite läuft, in die du eingeloggt bist; bekommt einen eigenen Schalter, und keine Einstellung kann ihn zum Schweigen bringen ([ADR 0012](../adr/0012-running-the-agents-own-script-in-the-page.md)) |

Die übrigen deklarierten Berechtigungen brauchen keine Anfrage und berühren von sich aus keine
Site: `tabs`, `storage`, `alarms`, `sessions`, `tabGroups` (`extension/manifest.ts:92`) — und die
Fähigkeiten hinter `sessions` und `tabGroups` sind standardmäßig aus
(`packages/core/src/features.ts:114-115`).

## 9. Was die Erweiterung nicht tut

- Sie liest weder deine Lesezeichen, Historie, Download-Liste, Cookies noch gespeicherte
  Passwörter.
- Sie liest nicht die Zwischenablage.
- Sie ändert keine Seiten, an denen du nicht arbeitest, und installiert nichts darin.
- Sie wechselt nicht den Tab, den du gerade ansiehst. Ein Screenshot verweigert einen Tab, der
  nicht der sichtbare ist (`extension/src/handlers.ts:1049-1054`).
- Sie tippt einen Einmal-Code nur, wenn du ihn weitergegeben hast, *Einmal-Codes, die du
  weitergibst, eintippen* eingeschaltet und bestätigt hast, und nur in ein Feld, das die Seite als
  solches markiert. Der Code wird in jedem Protokoll maskiert (ADR 0020).
- Sie füllt kein Passwortfeld: der Page-Agent verweigert den Aufruf namentlich
  (`extension/entrypoints/page-agent.ts:830-836` für ein Ausfüllen,
  `extension/entrypoints/page-agent.ts:943-949` für einen getippten Tastendruck).
- Sie führt keinen Code in der eigenen JavaScript-Welt einer Seite aus. Ein Manifest-V3-
  Content-Script kann überhaupt keine Zeichenkette zu Code kompilieren, also funktioniert
  `page_evaluate` im Firefox-Build und antwortet `unsupported` bei Chromium und Safari
  (`extension/src/handlers.ts`, der `unsupported`-Zweig von `page.evaluate`; die Prüfung erfolgt
  zur Laufzeit, nie aus einem Manifest-Feld abgeleitet).
- Sie schickt dich zu keinem Server, um etwas zu installieren: die Erweiterung aktualisiert sich
  nicht selbst.
- Sie ist nicht verschleiert, und ihr Quelltext ist das Repository, in dem dieser Text liegt.

## 10. Kinder und sensible Seiten

Beifahrer ist ein Entwickler-Werkzeug. Es richtet sich nicht an Kinder, und es wird keine
Altersgrenze behauptet.

Du kannst eine Site komplett blockieren — ein Tab darauf zeigt dann nur dessen Host, und nichts
darf darauf gelesen oder geändert werden, und eine Blockierung wird nicht von einer temporären
Freigabe überschrieben. Tu das für die Site einer Bank, einer Gesundheitseinrichtung oder deines
Arbeitgebers, und denk daran, dass ein eingebetteter Frame von einem anderen Ursprung separat
beurteilt wird, also deckt eine Blockierung der obersten Site nicht ab, was die Seite einbettet.

## 11. Änderungen an diesem Text

Diese Datei ist die Aussage. Wenn eine künftige Version ändert, was die Erweiterung tut, ändert
sich diese Datei im selben Commit — die Aussagen sind `file:line`-Zitate genau deshalb, damit eine
Code-Änderung den Text sichtbar falsch macht, statt still zu veralten.

Kontakt: pascal@jumplink.eu
