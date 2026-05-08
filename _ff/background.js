// background.js
// Service worker MV3: intercetta la catena di redirect HTTP in due hop:
//   Hop 1 — PoliMi (evn_preview_link) → Webex ldr.php?RCID=X
//   Hop 2 — Webex ldr.php?RCID=X     → /recordingservice/.../playback
// Entrambi vengono catturati via onBeforeRedirect prima del blocco CORS.

const LOG = (...a) => console.log("[RecMan BG]", ...a);
const WARN = (...a) => console.warn("[RecMan BG]", ...a);
const ERR  = (...a) => console.error("[RecMan BG]", ...a);

LOG("Service worker avviato.");

// ──────────────────────────────────────────────────────────────
// Listener redirect: cattura entrambi gli hop
// Filtro esteso a polimi.it + webex.com per coprire tutta la chain.
// ──────────────────────────────────────────────────────────────
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const { url, redirectUrl, requestId, tabId } = details;

    // ── HOP 1: PoliMi (evn_preview_link) → Webex ldr.php?RCID=X ──
    if (url.includes("evn_preview_link")) {
      LOG(`HOP 1 — tabId=${tabId} requestId=${requestId}`);
      LOG(`  url originale : ${url}`);
      LOG(`  redirect verso: ${redirectUrl}`);

      if (!redirectUrl.includes("webex.com")) {
        WARN("  → SKIP: redirect non va su webex.com (va su:", redirectUrl.split("?")[0], ")");
        return;
      }
      if (!redirectUrl.includes("RCID=")) {
        WARN("  → SKIP: redirect Webex senza parametro RCID — URL inatteso:", redirectUrl);
        return;
      }

      const transferMatch = url.match(/transfer_id=(\d+)/);
      if (!transferMatch) {
        ERR("  → ERRORE: evn_preview_link senza transfer_id — URL:", url);
        return;
      }

      const rcidMatch = redirectUrl.match(/RCID=([a-f0-9]+)/i);
      if (!rcidMatch) {
        ERR("  → ERRORE: redirect Webex senza RCID estraibile — URL:", redirectUrl);
        return;
      }

      const transferId = transferMatch[1];
      const rcid       = rcidMatch[1];
      const ldrUrl     = redirectUrl;

      LOG(`  ✓ HOP 1 catturato — transferId=${transferId}  RCID=${rcid}`);

      // Salva la mappatura RCID → transferId per collegare l'HOP 2
      // e il ldrUrl come dato intermedio (verrà sovrascritto dal playbackUrl)
      chrome.storage.local.get(["capturedLinks", "rcidMap"], (data) => {
        if (chrome.runtime.lastError) {
          ERR("storage.get fallito (HOP 1):", chrome.runtime.lastError.message);
          return;
        }

        const capturedLinks = data.capturedLinks || {};
        const rcidMap       = data.rcidMap || {};

        rcidMap[rcid] = transferId;
        capturedLinks[transferId] = {
          ldrUrl,
          playbackUrl: null,
          capturedAt: Date.now(),
        };

        chrome.storage.local.set({ capturedLinks, rcidMap }, () => {
          if (chrome.runtime.lastError) {
            ERR("storage.set fallito (HOP 1):", chrome.runtime.lastError.message);
            return;
          }
          LOG(`  Storage HOP 1 aggiornato — rcid=${rcid} → transferId=${transferId}`);
          // Con redirect:"follow" il browser segue automaticamente ldr.php → playback,
          // quindi onBeforeRedirect scatta di nuovo per l'HOP 2 senza fetch manuale.
        });
      });

      return;
    }

    // ── HOP 2: Webex ldr.php?RCID=X → /recordingservice/.../playback ──
    if (url.includes("ldr.php") && url.includes("RCID=")) {
      LOG(`HOP 2 — requestId=${requestId}`);
      LOG(`  url ldr.php   : ${url}`);
      LOG(`  redirect verso: ${redirectUrl}`);

      if (!redirectUrl.includes("/recordingservice/") && !redirectUrl.includes("/playback")) {
        WARN("  → SKIP: redirect da ldr.php non è verso recordingservice — URL:", redirectUrl);
        return;
      }

      const rcidMatch = url.match(/RCID=([a-f0-9]+)/i);
      if (!rcidMatch) {
        ERR("  → ERRORE: ldr.php senza RCID nell'URL:", url);
        return;
      }

      const rcid       = rcidMatch[1];
      const playbackUrl = redirectUrl;

      LOG(`  ✓ HOP 2 catturato — RCID=${rcid}  playbackUrl=${playbackUrl}`);

      // Recupera il transferId dal rcidMap salvato nell'HOP 1
      chrome.storage.local.get(["capturedLinks", "rcidMap"], (data) => {
        if (chrome.runtime.lastError) {
          ERR("storage.get fallito (HOP 2):", chrome.runtime.lastError.message);
          return;
        }

        const rcidMap       = data.rcidMap || {};
        const capturedLinks = data.capturedLinks || {};
        const transferId    = rcidMap[rcid];

        if (!transferId) {
          WARN(`  → RCID ${rcid} non trovato in rcidMap — HOP 1 non ancora completato?`);
          return;
        }

        capturedLinks[transferId] = {
          ...capturedLinks[transferId],
          playbackUrl,
        };

        chrome.storage.local.set({ capturedLinks }, () => {
          if (chrome.runtime.lastError) {
            ERR("storage.set fallito (HOP 2):", chrome.runtime.lastError.message);
            return;
          }
          LOG(`  Storage HOP 2 aggiornato — transferId=${transferId}  playbackUrl=${playbackUrl}`);

          // Notifica il content script con il playbackUrl definitivo
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs?.length) return;
            chrome.tabs.sendMessage(
              tabs[0].id,
              { type: "linkCaptured", transferId, webexUrl: playbackUrl },
              () => {
                if (chrome.runtime.lastError) {
                  WARN(`  → sendMessage fallito:`, chrome.runtime.lastError.message);
                  return;
                }
                LOG(`  → messaggio linkCaptured consegnato a tab ${tabs[0].id}`);
              }
            );
          });
        });
      });

      return;
    }

    // Qualsiasi altro redirect verso webex.com — ignorato silenziosamente
  },
  // Monitora sia PoliMi (HOP 1) che Webex (HOP 2)
  { urls: ["*://*.polimi.it/*", "*://politecnicomilano.webex.com/*"] }
);

// ──────────────────────────────────────────────────────────────
// Gestore messaggi dal content script
// ──────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  LOG(`onMessage — type=${msg.type} da tab=${sender?.tab?.id}`);

  if (msg.type === "getLinks") {
    chrome.storage.local.get(["capturedLinks"], (data) => {
      if (chrome.runtime.lastError) {
        ERR("getLinks — storage.get fallito:", chrome.runtime.lastError.message);
        sendResponse({ links: {} });
        return;
      }
      const links = data.capturedLinks || {};
      LOG(`getLinks → restituiti ${Object.keys(links).length} link`);
      sendResponse({ links });
    });
    return true;
  }

  if (msg.type === "clearLinks") {
    chrome.storage.local.remove(["capturedLinks", "rcidMap"], () => {
      if (chrome.runtime.lastError) {
        ERR("clearLinks — storage.remove fallito:", chrome.runtime.lastError.message);
        sendResponse({ ok: false });
        return;
      }
      LOG("clearLinks → storage svuotato (capturedLinks + rcidMap).");
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "fetchLinks") {
    const { hrefs } = msg;
    LOG(`fetchLinks — avvio ${hrefs.length} fetch dal background`);
    hrefs.forEach(({ href, tid }) => {
      // redirect:"follow" fa seguire al browser tutta la chain (HOP 1 + HOP 2),
      // triggherando onBeforeRedirect per ogni salto — necessario su Firefox.
      fetch(href, { credentials: "include", redirect: "follow" })
        .then((res) => LOG(`  BG fetch OK — tid=${tid} status=${res.status}`))
        .catch((err) => WARN(`  BG fetch ERRORE (CORS atteso) — tid=${tid}: ${err.message}`));
    });
    sendResponse({ ok: true });
    return true;
  }

  WARN(`Messaggio non gestito — type="${msg.type}"`);
});
