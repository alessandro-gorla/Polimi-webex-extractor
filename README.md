# RecMan PoliMi – Link Webex

Estensione per **Chrome** e **Firefox** che estrae automaticamente i link diretti alle registrazioni Webex dalla pagina RecMan del Politecnico di Milano, senza dover cliccare ogni lezione una per una.

## Il problema

I link alle registrazioni su RecMan non sono URL diretti a Webex: cliccandoli, il server PoliMi fa un redirect autenticato verso `politecnicomilano.webex.com/...?RCID=...`. Quell'URL finale è bloccato da CORS per chiunque non sia autenticato, ma è il link che ti serve per condividere o salvare la registrazione.

Questa estensione intercetta quei redirect a livello di rete (prima del blocco CORS) e li raccoglie tutti in un pannello laterale con metadati (data, argomento, durata).

## Funzionamento

```
Utente clicca "Estrai link Webex"
       │
       ▼
content.js legge la tabella delle lezioni (date, argomenti, durate)
       │
       ▼
content.js lancia fetch paralleli verso tutti i link RecMan
       │
       ▼
background.js intercetta ogni redirect PoliMi → Webex via onBeforeRedirect
       │         (prima che CORS blocchi la risposta)
       ▼
background.js salva gli URL Webex in chrome.storage.local
       │         e notifica il content script in real-time
       ▼
Pannello laterale aggiorna ogni lezione con il link Webex diretto
```

## Installazione

Dalla pagina [**Releases**](../../releases/latest) scarica lo ZIP per il tuo browser.

---

### Chrome

1. Scarica **`recman_chrome.zip`** ed estrailo in una cartella (es. `Documenti/recman_chrome`)
2. Apri **`chrome://extensions`**
3. Attiva il toggle **"Modalità sviluppatore"** in alto a destra
4. Clicca **"Carica estensione non pacchettizzata"**
5. Seleziona la cartella estratta (quella con `manifest.json` dentro)

> ⚠️ Non cancellare la cartella dopo l'installazione: Chrome la legge direttamente ogni volta.

---

### Firefox

Scarica **`recman_firefox.xpi`** dalla pagina Releases, poi scegli il metodo:

**Metodo A — Firefox Developer Edition** *(installazione permanente, nessun account richiesto)*
1. Scarica e installa [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)
2. Apri `about:config` → cerca `xpinstall.signatures.required` → impostalo a `false`
3. Apri `about:addons` → ⚙️ → **Installa componente aggiuntivo da file...**
4. Seleziona `recman_firefox.xpi` — l'estensione rimane installata tra i riavvii

**Metodo B — Firefox normale** *(temporanea, rimossa al riavvio)*
1. Apri `about:debugging#/runtime/this-firefox`
2. Clicca **"Carica componente aggiuntivo temporaneo..."**
3. Seleziona `recman_firefox.xpi`

> Il formato `.xpi` è uno ZIP rinominato. Per un'installazione permanente su Firefox normale è necessario pubblicare l'estensione su [addons.mozilla.org](https://addons.mozilla.org) (gratuito anche per estensioni private/non in elenco) — Mozilla la firma e restituisce un XPI installabile ovunque.

---

### Aggiornare a una nuova versione

1. Scarica lo ZIP della nuova versione da [Releases](../../releases/latest) e sostituisci i file nella cartella
2. **Chrome**: `chrome://extensions` → clicca **↺** → ricarica la pagina RecMan
3. **Firefox**: `about:debugging` → **Ricarica** accanto all'estensione → ricarica la pagina RecMan

## Utilizzo

1. Accedi a RecMan: `polimi.it/recman_frontend/...`
2. Apri la pagina di un corso con la lista delle registrazioni
3. Clicca il bottone blu **"🎬 Estrai link Webex"** in basso a destra
4. Il pannello laterale si apre e i link compaiono man mano che vengono catturati
5. Usa **"Copia tutto"** per copiare tutti i link formattati negli appunti

## Permessi richiesti

| Permesso | Motivo |
|---|---|
| `webRequest` | Intercettare i redirect HTTP PoliMi → Webex |
| `storage` | Salvare i link catturati (il service worker può essere killato tra un evento e l'altro) |
| `*://*.polimi.it/*` | Monitorare le richieste verso RecMan |
| `*://politecnicomilano.webex.com/*` | Accedere ai redirect verso Webex |

## Struttura del progetto

```
recman_extension/
├── manifest.json          # Chrome MV3 (service worker)
├── manifest_firefox.json  # Firefox MV2 (background script persistente)
├── background.js          # Condiviso: intercetta redirect via webRequest API
└── content.js             # Condiviso: UI pannello + fetch paralleli
```

## Note tecniche

- **Chrome MV3** — usa service worker; `host_permissions` è una chiave separata
- **Firefox MV2** — usa background script con `persistent: true`; le host permissions vanno dentro `permissions`; richiede `"tabs"` esplicito per `tabs.query/sendMessage`
- Il fetch usa `redirect: "manual"` invece di `redirect: "follow"`: con "follow" il CORS blocca l'intera chain prima che `onBeforeRedirect` nel background possa scattare
- I link vengono risolti in due hop: `evn_preview_link → ldr.php?RCID=X → /recordingservice/.../playback`
- Se l'estensione viene ricaricata mentre la pagina è aperta, il vecchio content script mostra un banner "Ricarica la pagina" perché il suo contesto `chrome.runtime` è stato invalidato

## Limitazioni

- Richiede che tu sia già autenticato su RecMan (usa i cookie di sessione esistenti)
- I link Webex estratti potrebbero scadere nel tempo
- Su Firefox l'installazione permanente richiede Firefox Developer Edition (con firma disabilitata) oppure la firma gratuita tramite AMO
