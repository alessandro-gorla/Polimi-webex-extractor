// content.js
// Iniettato automaticamente in ogni pagina /recman_frontend/*.
// Aggiunge il bottone FAB e il pannello laterale per visualizzare i link Webex
// catturati dal service worker (background.js).

(function () {
  "use strict";

  const LOG  = (...a) => console.log("[RecMan CS]",  ...a);
  const WARN = (...a) => console.warn("[RecMan CS]", ...a);
  const ERR  = (...a) => console.error("[RecMan CS]", ...a);

  LOG("Content script caricato su:", location.href);

  // ── Guardia iniziale ──────────────────────────────────────────
  // Se la tabella non ha ancora i link RecMan, il DOM non è pronto
  // (es. SPA che carica i dati in modo asincrono) — usciamo subito.
  const previewLinks = document.querySelectorAll('a[href*="evn_preview_link"]');
  if (previewLinks.length === 0) {
    WARN("Nessun link evn_preview_link trovato nel DOM — content script terminato.");
    WARN("Possibile causa: pagina non ancora caricata o selettore errato.");
    return;
  }
  LOG(`Trovati ${previewLinks.length} link evn_preview_link nel DOM.`);

  // ──────────────────────────────────────────────────────────────
  // Bottone FAB (Floating Action Button) in basso a destra
  // ──────────────────────────────────────────────────────────────
  const fab = document.createElement("button");
  fab.id = "_rm_fab";
  fab.textContent = "🎬 Estrai link Webex";
  fab.style.cssText = [
    "position:fixed", "bottom:24px", "right:24px", "z-index:999998",
    "padding:12px 20px", "background:#005eb8", "color:#fff",
    "border:none", "border-radius:8px", "font-size:14px",
    "font-family:sans-serif", "cursor:pointer",
    "box-shadow:0 4px 14px rgba(0,80,180,.45)",
    "transition:transform .1s",
  ].join(";");
  fab.onmouseenter = () => (fab.style.transform = "scale(1.04)");
  fab.onmouseleave = () => (fab.style.transform = "scale(1)");
  fab.onclick = runExtraction;
  document.body.appendChild(fab);
  LOG("FAB aggiunto al DOM.");

  // ── Listener aggiornamenti real-time dal background ───────────
  // Il background invia "linkCaptured" appena intercetta un redirect.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      LOG(`onMessage ricevuto — type=${msg.type}`);
      if (msg.type === "linkCaptured") {
        LOG(`  linkCaptured: transferId=${msg.transferId}  url=${msg.webexUrl}`);
        updatePanelItem(msg.transferId, msg.webexUrl);
      }
    });
  } catch (e) {
    WARN("onMessage.addListener fallito — contesto già invalidato:", e.message);
  }

  // ──────────────────────────────────────────────────────────────
  // Raccolta metadati dalla tabella HTML
  // ──────────────────────────────────────────────────────────────
  function getTableData() {
    // Itera le RIGHE e cerca il link dentro ciascuna.
    // Approccio precedente (abbinamento per indice links[] ↔ rows[]) era sbagliato:
    // alcune righe non hanno registrazione (es. lezione annullata) e non contengono
    // un evn_preview_link, causando lo shift di tutti i metadati successivi.
    const allRows = [...document.querySelectorAll("#transfers tbody tr")];
    LOG(`getTableData — ${allRows.length} righe tabella totali`);

    const result = [];
    let skipped = 0;

    allRows.forEach((row, i) => {
      // Cerca il link RecMan DENTRO questa riga specifica
      const link = row.querySelector('a[href*="evn_preview_link"]');
      if (!link) {
        LOG(`  Riga ${i}: nessun link evn_preview_link — saltata (lezione senza registrazione?)`);
        skipped++;
        return;
      }

      const match = link.href.match(/transfer_id=(\d+)/);
      const tid   = match ? match[1] : null;
      const cells = [...row.querySelectorAll("td")];

      if (!tid) WARN(`  Riga ${i}: link senza transfer_id — href: ${link.href}`);
      if (cells.length === 0) WARN(`  Riga ${i}: nessuna cella <td> — struttura tabella imprevista.`);

      // Indici colonne attesi: 1=data, 4=argomento, 6=durata
      const date  = cells[1]?.textContent.trim() || "";
      const topic = cells[4]?.textContent.trim() || "Lezione " + (result.length + 1);
      const dur   = cells[6]?.textContent.trim() || "";

      if (!date) WARN(`  Riga ${i}: data vuota (cella [1])`);
      if (!dur)  WARN(`  Riga ${i}: durata vuota (cella [6])`);

      LOG(`  [${result.length}] riga=${i} tid=${tid} date="${date}" topic="${topic}" dur="${dur}"`);
      result.push({ tid, href: link.href, date, topic, dur });
    });

    LOG(`getTableData — ${result.length} lezioni con registrazione, ${skipped} righe senza link saltate.`);
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  // Estrazione principale (onclick del FAB)
  // ──────────────────────────────────────────────────────────────
  async function runExtraction() {
    LOG("runExtraction — avvio.");
    fab.disabled = true;
    fab.textContent = "⏳ Estrazione...";

    const rows = getTableData();
    LOG(`Righe da estrarre: ${rows.length}`);

    // Recupera link già catturati dal background (se l'utente aveva già premuto il tasto)
    const stored = await getStoredLinks();
    LOG(`Link già in storage: ${Object.keys(stored).length}`);

    // Costruisce il pannello subito con i dati disponibili
    buildPanel(rows, stored);

    // Lancia fetch paralleli verso tutti i link RecMan.
    // Il browser seguirà i redirect; il background (onBeforeRedirect)
    // li intercetterà PRIMA del CORS e salverà gli URL Webex.
    LOG("Avvio fetch paralleli...");
    const fetchResults = await Promise.allSettled(
      rows.map((r) => {
        LOG(`  fetch → ${r.href}`);
        // redirect: "manual" è fondamentale:
        // - "follow" faceva seguire il redirect fino a webex.com, dove il CORS
        //   bloccava l'intera chain PRIMA che onBeforeRedirect nel background
        //   potesse intercettare → "Failed to fetch" e nessun link catturato.
        // - "manual" ferma il browser al primo redirect (il 302 PoliMi→Webex):
        //   onBeforeRedirect scatta, il background salva l'URL, e il fetch
        //   restituisce una risposta opaca (type="opaqueredirect", status=0)
        //   senza errori CORS.
        return fetch(r.href, { credentials: "include", redirect: "manual" })
          .then((res) => {
            LOG(`  fetch OK — transferId=${r.tid} type=${res.type} status=${res.status}`);
            if (res.type !== "opaqueredirect") {
              WARN(`  transferId=${r.tid}: risposta non è un redirect (type=${res.type}) — il server non ha rediretto verso Webex?`);
            }
          })
          .catch((err) => {
            ERR(`  fetch ERRORE — transferId=${r.tid}: ${err.message}`);
          });
      })
    );

    // Resoconto fetch
    const ok  = fetchResults.filter((r) => r.status === "fulfilled").length;
    const err = fetchResults.filter((r) => r.status === "rejected").length;
    LOG(`Fetch completati — fulfilled=${ok} rejected=${err}`);

    // Attende un po' per dare tempo al background di salvare tutti i redirect
    LOG("Attesa 800ms prima del secondo controllo storage...");
    await sleep(800);

    const final = await getStoredLinks();
    LOG(`Link in storage dopo 800ms: ${Object.keys(final).length}/${rows.length}`);

    refreshPanel(rows, final);

    fab.disabled = false;
    fab.textContent = "🎬 Estrai link Webex";
    LOG("runExtraction — completato.");
  }

  // ──────────────────────────────────────────────────────────────
  // Pannello laterale — costruzione
  // ──────────────────────────────────────────────────────────────
  function buildPanel(rows, captured) {
    // Rimuove eventuale pannello precedente
    document.getElementById("_rm_panel")?.remove();
    LOG(`buildPanel — ${rows.length} righe, ${Object.keys(captured).length} già catturati.`);

    const panel = document.createElement("div");
    panel.id = "_rm_panel";
    panel.style.cssText = [
      "position:fixed", "top:0", "right:0", "width:500px", "height:100vh",
      "background:#fff", "border-left:2px solid #ddd", "z-index:999999",
      "box-shadow:-4px 0 20px rgba(0,0,0,.15)",
      "display:flex", "flex-direction:column", "font-family:sans-serif", "font-size:13px",
    ].join(";");

    // Header con titolo e pulsanti di controllo
    const hdr = document.createElement("div");
    hdr.style.cssText = "padding:13px 16px;background:#f7f7f7;border-bottom:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;";
    hdr.innerHTML = `
      <strong style="font-size:15px">📹 Link Webex – FISICA</strong>
      <div style="display:flex;gap:8px">
        <button id="_rm_cpall" style="font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:5px;cursor:pointer;background:#fff">Copia tutto</button>
        <button id="_rm_clear" style="font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:5px;cursor:pointer;background:#fff">🗑 Reset</button>
        <button id="_rm_close" style="font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:5px;cursor:pointer;background:#fff">✕</button>
      </div>`;
    panel.appendChild(hdr);

    // Barra di stato — mostra progresso in tempo reale
    const status = document.createElement("div");
    status.id = "_rm_status";
    status.style.cssText = "padding:8px 16px;font-size:12px;color:#555;background:#fffbe6;border-bottom:1px solid #eee;flex-shrink:0;";
    status.textContent = "In corso… il background sta intercettando i redirect.";
    panel.appendChild(status);

    // Lista delle lezioni (una per riga)
    const list = document.createElement("div");
    list.id = "_rm_list";
    list.style.cssText = "flex:1;overflow-y:auto;";
    rows.forEach((r, i) => {
      if (!r.tid) WARN(`buildPanel: riga ${i} senza tid — l'item non potrà essere aggiornato in real-time.`);
      list.appendChild(buildItem(r, captured[r.tid]?.webexUrl, i));
    });
    panel.appendChild(list);

    document.body.appendChild(panel);

    // Bind pulsanti
    document.getElementById("_rm_close").onclick = () => {
      LOG("Pannello chiuso dall'utente.");
      panel.remove();
    };
    document.getElementById("_rm_clear").onclick = clearAndReset;
    document.getElementById("_rm_cpall").onclick = () => copyAll(rows, captured);

    LOG("Pannello costruito e aggiunto al DOM.");
  }

  // Crea un singolo elemento lista per una lezione
  function buildItem(r, webexUrl, idx) {
    const div = document.createElement("div");
    div.id = "_rm_item_" + r.tid;
    div.style.cssText = "padding:10px 16px;border-bottom:1px solid #f0f0f0;";

    if (webexUrl) {
      LOG(`  buildItem [${idx}] tid=${r.tid} — link GIÀ disponibile`);
      div.innerHTML = `
        <div style="font-size:11px;color:#999;">${r.date} · ${r.dur}</div>
        <div style="font-weight:600;color:#111;margin:2px 0;">${r.topic}</div>
        <a href="${webexUrl}" target="_blank" rel="noopener"
           style="font-size:12px;color:#0055cc;word-break:break-all;">${webexUrl}</a>`;
    } else {
      LOG(`  buildItem [${idx}] tid=${r.tid} — in attesa redirect`);
      div.innerHTML = `
        <div style="font-size:11px;color:#999;">${r.date}</div>
        <div style="color:#111;margin:2px 0;">${r.topic}</div>
        <span style="color:#aaa;font-size:12px;">⏳ in attesa…</span>`;
    }

    return div;
  }

  // Aggiorna un singolo item quando il background cattura il link
  function updatePanelItem(transferId, webexUrl) {
    const el = document.getElementById("_rm_item_" + transferId);
    if (!el) {
      // Può succedere se il pannello non è aperto o il tid non esiste in tabella
      WARN(`updatePanelItem: elemento #_rm_item_${transferId} non trovato nel DOM.`);
      return;
    }

    // Ri-legge i metadati dalla tabella (potrebbe essere cambiata)
    const rows = getTableData();
    const r    = rows.find((x) => x.tid === transferId);
    if (!r) {
      WARN(`updatePanelItem: trasferimento ${transferId} non trovato nei dati tabella correnti.`);
    }

    LOG(`updatePanelItem — transferId=${transferId} url=${webexUrl}`);
    el.innerHTML = `
      <div style="font-size:11px;color:#999;">${r?.date || ""} · ${r?.dur || ""}</div>
      <div style="font-weight:600;color:#111;margin:2px 0;">${r?.topic || ""}</div>
      <a href="${webexUrl}" target="_blank" rel="noopener"
         style="font-size:12px;color:#0055cc;word-break:break-all;">${webexUrl}</a>`;
  }

  // Aggiorna status bar e tutti gli item dopo il secondo polling
  async function refreshPanel(rows, captured) {
    const done  = Object.keys(captured).length;
    const total = rows.length;
    LOG(`refreshPanel — ${done}/${total} link catturati.`);

    const statusEl = document.getElementById("_rm_status");
    if (!statusEl) {
      WARN("refreshPanel: barra di stato non trovata — pannello già chiuso?");
      return;
    }

    if (done === total) {
      statusEl.style.background = "#f0fff4";
      statusEl.textContent = `✅ Tutti i ${done} link catturati.`;
    } else {
      statusEl.style.background = "#fffbe6";
      statusEl.textContent = `✅ ${done}/${total} link catturati. Per i restanti clicca ▶ normalmente.`;
      WARN(`refreshPanel: ${total - done} link non catturati — possibili cause:`);
      WARN("  1. Il redirect non è passato per PoliMi (cache browser?)");
      WARN("  2. Il parametro RCID non era presente nel redirect");
      WARN("  3. La richiesta non ha completato prima del timeout 800ms");
      // Stampa i tid mancanti per debug
      rows.filter((r) => !captured[r.tid]).forEach((r) => {
        WARN(`  mancante: transferId=${r.tid} topic="${r.topic}"`);
      });
    }

    // Aggiorna gli item ancora in "attesa" con i link arrivati
    rows.forEach((r) => {
      if (captured[r.tid]) updatePanelItem(r.tid, captured[r.tid].webexUrl);
    });

    // Aggiorna il pulsante "Copia tutto" con i dati freschi
    document.getElementById("_rm_cpall").onclick = () => copyAll(rows, captured);
  }

  // ──────────────────────────────────────────────────────────────
  // Utilità
  // ──────────────────────────────────────────────────────────────

  // Chiede al background tutti i link salvati in storage.
  // Ritorna {} se il contesto è invalidato (es. estensione ricaricata).
  function getStoredLinks() {
    return new Promise((resolve) => {
      LOG("getStoredLinks — richiesta a background...");
      try {
        chrome.runtime.sendMessage({ type: "getLinks" }, (res) => {
          if (chrome.runtime.lastError) {
            ERR("getStoredLinks — sendMessage fallito:", chrome.runtime.lastError.message);
            resolve({});
            return;
          }
          const links = res?.links || {};
          LOG(`getStoredLinks — ricevuti ${Object.keys(links).length} link.`);
          resolve(links);
        });
      } catch (e) {
        // "Extension context invalidated": l'estensione è stata ricaricata
        // mentre il content script era già in esecuzione sulla pagina.
        // Soluzione: ricaricare la pagina per ottenere un nuovo contesto.
        ERR("getStoredLinks — contesto estensione non valido:", e.message);
        WARN("Ricarica la pagina per ripristinare il contesto dell'estensione.");
        showContextInvalidatedBanner();
        resolve({});
      }
    });
  }

  // Svuota lo storage e chiude il pannello
  function clearAndReset() {
    LOG("clearAndReset — richiesta pulizia storage.");
    try {
      chrome.runtime.sendMessage({ type: "clearLinks" }, (res) => {
        if (chrome.runtime.lastError) {
          ERR("clearAndReset — sendMessage fallito:", chrome.runtime.lastError.message);
          return;
        }
        LOG("clearAndReset — storage pulito, pannello rimosso.");
        document.getElementById("_rm_panel")?.remove();
      });
    } catch (e) {
      ERR("clearAndReset — contesto estensione non valido:", e.message);
      showContextInvalidatedBanner();
    }
  }

  // Mostra un banner visibile quando il contesto è invalidato
  function showContextInvalidatedBanner() {
    if (document.getElementById("_rm_ctx_err")) return;
    const banner = document.createElement("div");
    banner.id = "_rm_ctx_err";
    banner.style.cssText = "position:fixed;bottom:80px;right:24px;z-index:9999999;padding:12px 16px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;font-family:sans-serif;font-size:13px;max-width:320px;box-shadow:0 4px 14px rgba(0,0,0,.15);";
    banner.innerHTML = `⚠️ <strong>Estensione aggiornata</strong><br>Ricarica la pagina per riprendere a usare RecMan.<br><br><button onclick="location.reload()" style="margin-top:4px;padding:5px 12px;background:#005eb8;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;">🔄 Ricarica</button>`;
    document.body.appendChild(banner);
  }

  // Copia tutti i link formattati negli appunti
  function copyAll(rows, captured) {
    const missing = rows.filter((r) => !captured[r.tid]);
    if (missing.length > 0) WARN(`copyAll — ${missing.length} link ancora "N/A":`, missing.map((r) => r.tid));

    const txt = rows
      .map((r, i) => {
        const url = captured[r.tid]?.webexUrl || "N/A";
        return `${i + 1}. ${r.date} | ${r.topic} (${r.dur})\n${url}`;
      })
      .join("\n\n");

    LOG("copyAll — testo copiato:\n" + txt);

    navigator.clipboard.writeText(txt).then(() => {
      LOG("copyAll — clipboard OK.");
      const b = document.getElementById("_rm_cpall");
      if (!b) return;
      b.textContent = "✓ Copiato!";
      setTimeout(() => (b.textContent = "Copia tutto"), 2000);
    }).catch((err) => {
      ERR("copyAll — clipboard.writeText fallito:", err.message);
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

})();
