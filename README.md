# RecMan PoliMi – Link Webex

Estensione Chrome che estrae automaticamente i link diretti alle registrazioni Webex dalla pagina RecMan del Politecnico di Milano, senza dover cliccare ogni lezione una per una.

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

> L'estensione non è sul Chrome Web Store — va installata manualmente in modalità sviluppatore.

### 1. Scarica i file

Clicca **Code → Download ZIP** in alto a destra su questa pagina GitHub, poi **estrai** lo ZIP in una cartella sul tuo computer (es. `Documenti/recman_extension`).

> In alternativa, se hai Git: `git clone https://github.com/<utente>/recman_extension.git`

### 2. Carica l'estensione in Chrome

1. Apri Chrome e vai all'indirizzo **`chrome://extensions`**
2. Attiva il toggle **"Modalità sviluppatore"** in alto a destra
3. Clicca **"Carica estensione non pacchettizzata"**
4. Seleziona la **cartella estratta** (quella che contiene `manifest.json`, non lo ZIP)
5. L'estensione compare nella lista — fatto!

> ⚠️ Non cancellare la cartella dopo l'installazione: Chrome la legge direttamente ogni volta.

### Aggiornare a una nuova versione

1. Sostituisci i file nella cartella con quelli nuovi (o fai `git pull`)
2. Vai su `chrome://extensions` e clicca l'icona **↺** accanto all'estensione
3. Ricarica la pagina RecMan

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
├── manifest.json     # Configurazione estensione (MV3)
├── background.js     # Service worker: intercetta redirect via webRequest API
└── content.js        # Iniettato su RecMan: UI pannello + fetch paralleli
```

## Note tecniche

- **Manifest V3** — usa service worker al posto delle background page
- Il fetch usa `redirect: "manual"` invece di `redirect: "follow"`: con "follow" Chrome segue il redirect fino a Webex, il CORS blocca l'intera chain e `onBeforeRedirect` non scatta mai
- Se l'estensione viene ricaricata mentre la pagina è aperta, il vecchio content script mostra un banner "Ricarica la pagina" perché il suo contesto `chrome.runtime` è stato invalidato

## Limitazioni

- Funziona solo su Chrome/Chromium (usa API `chrome.webRequest` non disponibili su Firefox)
- Richiede che tu sia già autenticato su RecMan (usa i cookie di sessione esistenti)
- I link Webex estratti includono il parametro `RCID` che identifica la sessione — potrebbero scadere nel tempo
