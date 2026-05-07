// background.js
// Service worker MV3: intercetta i redirect HTTP PoliMi → Webex
// prima che il browser applichi la policy CORS/redirect (inaccessibili
// da content script o fetch normale). Usa l'API webRequest, disponibile
// solo nel background.

const LOG = (...a) => console.log("[RecMan BG]", ...a);
const WARN = (...a) => console.warn("[RecMan BG]", ...a);
const ERR  = (...a) => console.error("[RecMan BG]", ...a);

LOG("Service worker avviato.");

// ──────────────────────────────────────────────────────────────
// Listener redirect: cattura URL Webex dai redirect RecMan
// ──────────────────────────────────────────────────────────────
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const { url, redirectUrl, requestId, tabId } = details;

    LOG(`onBeforeRedirect — tabId=${tabId} requestId=${requestId}`);
    LOG(`  url originale : ${url}`);
    LOG(`  redirect verso: ${redirectUrl}`);

    // Filtro 1: la richiesta deve essere un link RecMan (evn_preview_link)
    if (!url.includes("evn_preview_link")) {
      LOG("  → SKIP: non è un evn_preview_link");
      return;
    }

    // Filtro 2: il redirect deve puntare a Webex con parametro RCID
    if (!redirectUrl.includes("webex.com")) {
      WARN("  → SKIP: redirect non va su webex.com (va su:", redirectUrl.split("?")[0], ")");
      return;
    }
    if (!redirectUrl.includes("RCID=")) {
      WARN("  → SKIP: redirect Webex senza parametro RCID — URL inatteso:", redirectUrl);
      return;
    }

    // Estrae transfer_id dall'URL originale (es. ?transfer_id=12345)
    const transferMatch = url.match(/transfer_id=(\d+)/);
    if (!transferMatch) {
      ERR("  → ERRORE: evn_preview_link senza transfer_id — URL:", url);
      return;
    }

    // Estrae RCID dall'URL Webex (es. ?RCID=ab12cd...)
    const rcidMatch = redirectUrl.match(/RCID=([a-f0-9]+)/i);
    if (!rcidMatch) {
      ERR("  → ERRORE: redirect Webex senza RCID estraibile — URL:", redirectUrl);
      return;
    }

    const transferId = transferMatch[1];
    const webexUrl   = redirectUrl;
    LOG(`  ✓ Catturato — transferId=${transferId}  RCID=${rcidMatch[1]}`);

    // ── Salvataggio in storage persistente ──────────────────────
    // Il service worker può essere killato tra un evento e l'altro,
    // quindi usiamo storage.local come unica fonte di verità.
    chrome.storage.local.get(["capturedLinks"], (data) => {
      if (chrome.runtime.lastError) {
        ERR("storage.local.get fallito:", chrome.runtime.lastError.message);
        return;
      }

      const capturedLinks = data.capturedLinks || {};
      const isNew = !capturedLinks[transferId];

      capturedLinks[transferId] = {
        webexUrl,
        capturedAt: Date.now(),
      };

      chrome.storage.local.set({ capturedLinks }, () => {
        if (chrome.runtime.lastError) {
          ERR("storage.local.set fallito:", chrome.runtime.lastError.message);
          return;
        }
        LOG(`  Storage aggiornato — totale link salvati: ${Object.keys(capturedLinks).length} (nuovo=${isNew})`);
      });
    });

    // ── Notifica real-time al content script ─────────────────────
    // Manda il messaggio solo se il pannello è già aperto (il content
    // script potrebbe non essere in ascolto se il pannello non esiste).
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        WARN("tabs.query fallito:", chrome.runtime.lastError.message);
        return;
      }
      if (!tabs || tabs.length === 0) {
        WARN("  Nessun tab attivo trovato — messaggio non inviato.");
        return;
      }

      const targetTab = tabs[0];
      LOG(`  Invio linkCaptured a tab ${targetTab.id} (${targetTab.url?.split("?")[0]})`);

      chrome.tabs
        .sendMessage(targetTab.id, { type: "linkCaptured", transferId, webexUrl })
        .then(() => LOG(`  → messaggio consegnato a tab ${targetTab.id}`))
        .catch((err) => {
          // Normale se il pannello non è aperto o il content script non è caricato.
          WARN(`  → sendMessage fallito per tab ${targetTab.id}:`, err.message);
        });
    });
  },
  // Monitora tutte le richieste verso PoliMi
  { urls: ["*://*.polimi.it/*"] }
);

// ──────────────────────────────────────────────────────────────
// Gestore messaggi dal content script
// ──────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  LOG(`onMessage — type=${msg.type} da tab=${sender?.tab?.id}`);

  if (msg.type === "getLinks") {
    chrome.storage.local.get(["capturedLinks"], (data) => {
      if (chrome.runtime.lastError) {
        ERR("getLinks — storage.local.get fallito:", chrome.runtime.lastError.message);
        sendResponse({ links: {} });
        return;
      }
      const links = data.capturedLinks || {};
      LOG(`getLinks → restituiti ${Object.keys(links).length} link`);
      sendResponse({ links });
    });
    return true; // necessario per risposta asincrona
  }

  if (msg.type === "clearLinks") {
    chrome.storage.local.remove(["capturedLinks"], () => {
      if (chrome.runtime.lastError) {
        ERR("clearLinks — storage.local.remove fallito:", chrome.runtime.lastError.message);
        sendResponse({ ok: false });
        return;
      }
      LOG("clearLinks → storage svuotato.");
      sendResponse({ ok: true });
    });
    return true;
  }

  WARN(`Messaggio non gestito — type="${msg.type}"`);
});
