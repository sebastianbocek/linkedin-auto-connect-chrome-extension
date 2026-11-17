const els = {
  page: document.getElementById("page"), status: document.getElementById("status"),
  total: document.getElementById("total"),
  limit: document.getElementById("limit"), start: document.getElementById("start"), stop: document.getElementById("stop"),
  keywords: document.getElementById("keywords"), addKeyword: document.getElementById("addKeyword"),
  extractCsv: document.getElementById("extractCsv"), downloadCsv: document.getElementById("downloadCsv"),
  logOutput: document.getElementById("logOutput"), copyLog: document.getElementById("copyLog")
};
const setStatus = (message) => { els.status.textContent = message; };
async function getActiveTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
function addKeywordRow(value = "") {
  const row = document.createElement("div"); row.className = "keyword-row";
  const input = document.createElement("input"); input.type = "text"; input.placeholder = "Ej. B2B, B2B AI, CTO"; input.value = value; input.setAttribute("aria-label", "Keyword de perfil");
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Quitar keyword";
  remove.addEventListener("click", () => { row.remove(); saveSettings(); });
  input.addEventListener("input", saveSettings); row.append(input, remove); els.keywords.append(row);
}
function saveSettings() {
  chrome.storage.local.set({ ceoAutoSettings: {
    keywords: [...els.keywords.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean),
    extractCsv: els.extractCsv.checked, limit: els.limit.value
  } });
}
chrome.storage.local.get("ceoAutoSettings", ({ ceoAutoSettings: s = {} }) => {
  const legacyDefaults = Array.isArray(s.keywords) && s.keywords.length === 2 &&
    s.keywords[0].toLowerCase() === "ceo" && s.keywords[1].toLowerCase() === "founder";
  if (legacyDefaults) { s.keywords = []; chrome.storage.local.set({ ceoAutoSettings: s }); }
  (s.keywords?.length ? s.keywords : [""]).forEach(addKeywordRow);
  els.extractCsv.checked = !!s.extractCsv;
  if (s.limit !== undefined) els.limit.value = s.limit;
});
els.addKeyword.addEventListener("click", () => { addKeywordRow(); els.keywords.lastElementChild.querySelector("input").focus(); saveSettings(); });
els.extractCsv.addEventListener("change", saveSettings); els.limit.addEventListener("change", saveSettings);

async function checkPage() {
  try {
    const tab = await getActiveTab(); const url = new URL(tab?.url || "");
    const allowed = url.hostname === "www.linkedin.com" || url.hostname.endsWith(".linkedin.com");
    els.page.textContent = allowed ? (url.pathname.includes("/search/results/people") ? "LinkedIn · resultados de personas" : "LinkedIn · sugerencias") : "Abre linkedin.com para usar la automatización";
    els.start.disabled = !allowed; els.stop.disabled = !allowed;
    if (!allowed) setStatus("La automatización funciona en pestañas de LinkedIn.");
  } catch { els.page.textContent = "No se pudo detectar la pestaña"; els.start.disabled = true; els.stop.disabled = true; }
}
async function runOnPage(func, args = []) {
  const tab = await getActiveTab(); if (!tab?.id) throw new Error("No se encontró la pestaña activa.");
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }); return results?.[0]?.result;
}

function startAutomation(maxActions, keywords, extractCsv) {
  if (window.__ceoAutoFollow?.running) return { started: false };
  const state = { running: true, stopped: false, count: 0, max: maxActions, rows: [], logs: [], message: "Preparando resultados…" };
  window.__ceoAutoFollow = state;
  const log = (message) => { state.logs.push(`${new Date().toLocaleTimeString()} ${message}`); if (state.logs.length > 250) state.logs.splice(0, state.logs.length - 250); };
  log(`Inicio · página ${location.href} · keywords: ${keywords.join(", ")} · CSV: ${extractCsv ? "sí" : "no"}`);
  const normalized = keywords.map((k) => k.toLocaleLowerCase()).filter(Boolean);
  const clicked = new WeakSet(); const seenProfiles = new Set(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth; };
  const contactCardSelector = ".mxtl50.mxtivr.mxtlce.mxtlcv.mxtldd.mxtldu.mxtayy.mxtiun.mxtj1t.mxtj08.mxtj1j.mxtixb.mxtl5q";
  const roleTextSelector = "a.mxtmg5.mxtmg4 > div.mxtl50.mxtivr > div.mxtayy.mxtiu3:nth-of-type(1) > div.mxtl50.mxtivr:nth-of-type(2) > div.mxtlis.mxtgpp:nth-of-type(2) > p.mxtlje.mxtlo0";
  const isSearch = location.pathname.includes("/search/results/people");
  const checkLimits = () => {
    const t = (document.body?.innerText || "").replace(/\s+/g, " ").toLowerCase();
    if (/reached the weekly limit for connection invitations|weekly invitation limit/.test(t)) { state.stopped = true; state.message = "Límite semanal de invitaciones alcanzado. Automatización detenida."; log(state.message); return true; }
    return false;
  };
  const sendWithoutNoteIfPrompted = async () => {
    const getPrompt = () => {
      // Playwright's locator crosses open shadow roots; document.querySelectorAll
      // does not. Inspect the document and each reachable open root for the same span.
      const roots = [document];
      let shadowRoots = 0;
      for (let i = 0; i < roots.length; i++) {
        for (const element of roots[i].querySelectorAll("*")) {
          if (element.shadowRoot) { roots.push(element.shadowRoot); shadowRoots++; }
        }
      }
      state.sendNoteShadowRoots = shadowRoots;
      for (const root of roots) {
        const span = [...root.querySelectorAll("span")].find((el) =>
          (el.innerText || el.textContent || "").toLowerCase().includes("send without a note") && visible(el)
        );
        if (span) return span;
      }
      return null;
    };
    let prompt = null;
    for (let i = 0; i < 12 && !state.stopped; i++) {
      prompt = getPrompt();
      if (prompt) break;
      await sleep(250);
    }
    if (!prompt) { log(`Diálogo posterior a Connect · no apareció span con Send without a note; shadow roots abiertos inspeccionados=${state.sendNoteShadowRoots || 0}.`); return false; }
    log(`Diálogo de invitación detectado · clic en span:has-text("Send without a note") · texto=${(prompt.innerText || prompt.textContent || "").trim()}`);
    prompt.click();
    for (let i = 0; i < 16 && !state.stopped; i++) {
      await sleep(250);
      if (!getPrompt()) { log("Invitación enviada sin nota · diálogo cerrado."); return true; }
    }
    state.stopped = true;
    state.message = "El diálogo de invitación no se cerró después de Send without a note.";
    log(`ERROR · ${state.message}`);
    return true;
  };
  const getCard = (button) => {
    let n = button;
    for (let d = 0; n && d < 12; d++, n = n.parentElement) {
      if (n.matches(contactCardSelector)) return n;
      if (n.matches("li, .artdeco-card, .discover-entity-type-card, [data-view-name*='search-result'], [data-view-name*='recommendation']")) return n;
      const profileLinks = new Set([...n.querySelectorAll("a[href*='/in/']")].map((a) => a.href.split("?")[0]));
      const hasAction = [...n.querySelectorAll("button, a[role='button'], [role='button']")].some((el) => /^(follow|connect)$/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
      if (profileLinks.size === 1 && hasAction) return n;
    }
    n = button; for (let d = 0; n.parentElement && d < 6; d++) n = n.parentElement; return n;
  };
  const profileHref = (card) => card.querySelector("a[href*='/in/']")?.href?.split("?")[0] || "";
  const getCardText = (card) => {
    const roleTexts = [...card.querySelectorAll(roleTextSelector)].map((el) => el.innerText.trim()).filter(Boolean);
    const currentTexts = [...card.querySelectorAll("p, span, div")].map((el) => (el.innerText || "").trim())
      .filter((t) => /^Current\s*:/i.test(t) && t.length < 500);
    return [...new Set([...roleTexts, ...currentTexts, card.innerText || ""])].join("\n");
  };
  const getKeywordText = (card) => {
    const roleTexts = [...card.querySelectorAll(roleTextSelector)].map((el) => (el.innerText || el.textContent || "").trim()).filter(Boolean);
    const currentTexts = [...card.querySelectorAll("p, span, div")].map((el) => (el.innerText || "").trim())
      .filter((t) => /^Current\s*:/i.test(t) && t.length < 500);
    const lines = (card.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const profileName = (card.querySelector("a[href*='/in/']")?.innerText || "").trim().split("\n")[0];
    const nameIndex = profileName ? lines.findIndex((line) => line.toLocaleLowerCase().startsWith(profileName.toLocaleLowerCase())) : 0;
    const countryLine = /\b(argentina|india|spain|united states|united kingdom|canada|mexico|brazil|chile|colombia|peru|uruguay|paraguay|bolivia|ecuador|france|germany|italy|portugal|netherlands|ireland|australia|new zealand|singapore|japan|china|israel|sweden|norway|denmark|switzerland|poland|romania|ukraine|kazakhstan)\s*$/i;
    const headline = [];
    for (let i = Math.max(0, nameIndex + 1); i < lines.length && headline.length < 4; i++) {
      const line = lines[i];
      if (/^(current|past|people also viewed|mutual connections?)\s*:/i.test(line)) break;
      if (countryLine.test(line) || /^greater\s+(buenos aires|mendoza)\b/i.test(line)) break;
      headline.push(line);
    }
    return [...new Set([...roleTexts, ...headline, ...currentTexts])].join("\n");
  };
  const getActionControl = (card, cardIndex, allCards) => {
    // Match Playwright getByText('Connect', { exact: true }) within this one
    // contact card. Click the smallest exact-text element so the card itself is
    // never the target. Ignore any Connect text nested in the profile link.
    const labelText = (el) => (el.innerText || "").trim() || (el.textContent || "").trim() || (el.getAttribute("aria-label") || "").trim();
    const matches = [...card.querySelectorAll("button, [role='button'], a, span, div")]
      .filter((el) => labelText(el) === "Connect" && visible(el) && inViewport(el));
    const leaves = matches.filter((el) => ![...el.children].some((child) => labelText(child) === "Connect"));
    for (const candidate of leaves) {
      const actionLink = candidate.closest("a");
      if (candidate.closest("a[href*='/in/']")) continue;
      if (candidate.disabled || candidate.getAttribute("aria-disabled") === "true" || clicked.has(candidate) || (actionLink && clicked.has(actionLink))) continue;
      return actionLink && card.contains(actionLink) ? actionLink : candidate;
    }

    // LinkedIn currently renders this action as the exact span/anchor selector
    // supplied by the user, outside the custom card wrapper in some layouts.
    const allConnectLabels = [...document.querySelectorAll(
      '[id^="SearchResultsA"] > div.mxtayq.mxtl5q > div.mxta2a.mxtht3 > div.mxtayq.mxtl5q > a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb, ' +
      '[id^="SearchResultsA"] a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb'
    )]
      .filter((el) => labelText(el) === "Connect" && visible(el));
    const visibleConnects = allConnectLabels.filter(inViewport);
    state.visibleConnectCount = visibleConnects.length;
    state.allConnectCount = allConnectLabels.length;
    const profile = profileHref(card);
    for (const label of allConnectLabels) {
      const actionLink = label.closest("a");
      if (!actionLink || /\/in\//i.test(actionLink.getAttribute("href") || "") || clicked.has(actionLink)) continue;
      const ownerCard = label.closest(contactCardSelector);
      const ownerHref = ownerCard ? profileHref(ownerCard) : "";
      let belongsToCard = ownerCard === card || (ownerHref && ownerHref === profile);
      if (!belongsToCard) {
        let ancestor = label.parentElement;
        while (ancestor && ancestor !== document.body && !belongsToCard) {
          const links = [...new Set([...ancestor.querySelectorAll("a[href*='/in/']")].map((a) => a.href.split("?")[0]))];
          if (links.length === 1 && profile && links[0] === profile) belongsToCard = true;
          ancestor = ancestor.parentElement;
        }
      }
      if (!belongsToCard) {
        // Some LinkedIn layouts place the action anchor beside, rather than
        // inside, the contact-card node. Match by row geometry as a fallback.
        const labelRect = label.getBoundingClientRect();
        const labelMidY = labelRect.top + labelRect.height / 2;
        let nearestCard = null, nearestDistance = Infinity;
        for (const candidateCard of allCards) {
          const rect = candidateCard.getBoundingClientRect();
          const distance = labelMidY < rect.top ? rect.top - labelMidY : labelMidY > rect.bottom ? labelMidY - rect.bottom : 0;
          if (distance < nearestDistance) { nearestDistance = distance; nearestCard = candidateCard; }
        }
        const maxRowGap = Math.max(70, card.getBoundingClientRect().height * 0.35);
        if (nearestCard === card && nearestDistance <= maxRowGap) belongsToCard = true;
      }
      if (!belongsToCard && allConnectLabels.length === allCards.length) belongsToCard = allConnectLabels.indexOf(label) === cardIndex;
      if (belongsToCard && visible(actionLink) && inViewport(actionLink)) return actionLink;
    }
    return null;
  };
  const getActionStatus = (card, allCards) => {
    const statuses = new Set(["Pending", "Follow", "Message"]);
    const labelText = (el) => (el.innerText || "").trim() || (el.textContent || "").trim();
    const localPending = [...card.querySelectorAll("button, a, [role='button'], span, div")]
      .find((el) => statuses.has(labelText(el)) && visible(el));
    if (localPending) return labelText(localPending);
    const globalStatuses = [...document.querySelectorAll(
      '[id^="SearchResultsA"] > div.mxtayq.mxtl5q > div.mxta2a.mxtht3 > div.mxtayq.mxtl5q > a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb, ' +
      '[id^="SearchResultsA"] a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb'
    )].filter((el) => statuses.has(labelText(el)) && visible(el));
    for (const label of globalStatuses) {
      const rect = label.getBoundingClientRect(), midY = rect.top + rect.height / 2;
      let nearest = null, nearestDistance = Infinity;
      for (const candidate of allCards) {
        const cardRect = candidate.getBoundingClientRect();
        const distance = midY < cardRect.top ? cardRect.top - midY : midY > cardRect.bottom ? midY - cardRect.bottom : 0;
        if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
      }
      if (nearest === card && nearestDistance <= Math.max(70, card.getBoundingClientRect().height * 0.35)) return labelText(label);
    }
    return false;
  };
  const extractRow = (card, text, href) => {
    if (!extractCsv || !href || state.rows.some((r) => r.link === href)) return;
    const anchors = [...card.querySelectorAll("a[href*='/in/']")];
    const name = (anchors.find((a) => a.href.split("?")[0] === href)?.innerText || "").trim().split("\n")[0];
    const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
    const category = card.querySelector(roleTextSelector)?.innerText?.trim() || lines.find((x) => /^Current\s*:/i.test(x)) || lines.find((x) => /\b(ceo|founder|owner|director|president|manager|partner|chief|engineer|consultant|investor|co-founder)\b/i.test(x)) || "";
    const locationLine = lines.find((x) => /,\s*(united states|argentina|canada|united kingdom|mexico|brazil|spain|chile|colombia|remote)\b/i.test(x)) || "";
    state.rows.push({ name, category, location: locationLine, link: href }); log(`CSV · perfil agregado: ${name || href}`);
  };
  const paginate = async () => {
    const next = [...document.querySelectorAll("button, a, [role='button']")].find((el) => visible(el) && !el.disabled && (/^next\b/i.test((el.getAttribute("aria-label") || "").trim()) || /^next\b/i.test((el.innerText || "").trim())));
    if (!next) return false;
    const before = location.href;
    const activeBefore = document.querySelector("[aria-current='page'], .artdeco-pagination__indicator--number.active");
    const activeText = activeBefore?.innerText?.trim();
    next.click(); state.message = "Avanzando a la siguiente página…"; log("Paginación · clic en Next después de recorrer hasta el final.");
    for (let i = 0; i < 30 && !state.stopped; i++) {
      await sleep(500);
      const activeNow = document.querySelector("[aria-current='page'], .artdeco-pagination__indicator--number.active");
      if (location.href !== before || (activeNow && activeNow.innerText.trim() !== activeText)) break;
    }
    await sleep(1300);
    const activeAfter = document.querySelector("[aria-current='page'], .artdeco-pagination__indicator--number.active");
    const changed = location.href !== before || (!!activeAfter && activeAfter.innerText.trim() !== activeText);
    log(changed ? `Paginación · página nueva detectada: ${location.href}` : "Paginación · se pulsó Next pero no cambió la página.");
    return changed;
  };
  const getScroller = (anchor) => {
    let node = anchor;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 80 && /(auto|scroll|overlay)/.test(style.overflowY)) return node;
      node = node.parentElement;
    }
    const pageRoot = document.querySelector("main") || document.body;
    const nestedScroller = [...pageRoot.querySelectorAll("*")]
      .filter((el) => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 100 && visible(el))
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (nestedScroller) return nestedScroller;
    return document.scrollingElement || document.documentElement;
  };
  const scrollOneStep = async (anchor) => {
    const scroller = getScroller(anchor);
    const isDocument = scroller === document.scrollingElement || scroller === document.documentElement;
    const before = isDocument ? window.scrollY : scroller.scrollTop;
    const step = Math.max(450, Math.floor((isDocument ? window.innerHeight : scroller.clientHeight) * 0.68));
    if (isDocument) window.scrollBy({ top: step, behavior: "smooth" });
    else scroller.scrollBy({ top: step, behavior: "smooth" });
    await sleep(1150);
    const after = isDocument ? window.scrollY : scroller.scrollTop;
    const extent = isDocument ? document.documentElement.scrollHeight : scroller.scrollHeight;
    const viewport = isDocument ? window.innerHeight : scroller.clientHeight;
    const position = isDocument ? window.scrollY : scroller.scrollTop;
    return { moved: Math.abs(after - before) > 3, atBottom: position + viewport >= extent - 80, position, extent };
  };
  (async () => {
    try {
      const showAll = [...document.querySelectorAll("button,a,[role='button']")].find((el) => visible(el) && /^show all$/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
      if (showAll) { showAll.click(); await sleep(1200); log("Expandido Show all antes de recorrer tarjetas."); }
      let idle = 0, bottomRounds = 0;
      const noConnectLogged = new Set();
      while (!state.stopped && (state.max === 0 || state.count < state.max)) {
        if (checkLimits()) break;
        const exactContactCards = [...document.querySelectorAll(contactCardSelector)];
        const cards = isSearch && exactContactCards.length
          ? exactContactCards
          : [...new Set([
              ...document.querySelectorAll("li, .artdeco-card, .discover-entity-type-card, [data-view-name*='search-result'], [data-view-name*='recommendation']"),
              ...[...document.querySelectorAll("button, a[role='button'], [role='button'], [tabindex]")].map(getCard)
            ])];
        log(`Escaneo · ${cards.length} contenedores de ficha detectados; inspeccionando coincidencias visibles.`);
        let didAction = false;
        for (const card of cards) {
          if (state.stopped || (state.max && state.count >= state.max)) break;
          const text = getCardText(card), keywordText = getKeywordText(card), normalizedText = keywordText.toLocaleLowerCase();
          if (!keywordText.trim()) continue;
          const matchedKeyword = normalized.find((word) => normalizedText.includes(word.toLocaleLowerCase()));
          if (!matchedKeyword) continue;
          const href = profileHref(card);
          log(`Coincidencia · keyword="${matchedKeyword}" · titular/cargo/Current="${keywordText.replace(/\s+/g, " ").slice(0, 180)}" · perfil=${href || "sin enlace"}`);
          if (href && !state.rows.some((r) => r.link === href)) extractRow(card, text, href);
          if (href && seenProfiles.has(href)) continue;
          const control = getActionControl(card, cards.indexOf(card), cards);
          if (!control) {
            const logKey = href || `card-${cards.indexOf(card)}`;
            if (!noConnectLogged.has(logKey)) {
              noConnectLogged.add(logKey);
              const actionStatus = getActionStatus(card, cards);
              if (actionStatus === "Pending") log(`Sin acción · estado Pending detectado para ${href || "perfil sin enlace"}; la invitación ya está pendiente, se omite Connect.`);
              else if (actionStatus === "Follow") log(`Sin acción · estado Follow detectado para ${href || "perfil sin enlace"}; no se pulsa Follow porque solo se automatiza Connect.`);
              else if (actionStatus === "Message") log(`Sin acción · estado Message detectado para ${href || "perfil sin enlace"}; el perfil ya permite enviar mensaje y no se pulsa Connect.`);
              else log(`Sin acción · coincidencia ${href || "sin enlace detectable"}; Connect detectados=${state.allConnectCount ?? "sin consulta"}, visibles=${state.visibleConnectCount ?? "sin consulta"}, fichas=${cards.length}; estados Pending/Follow/Message no detectados y Connect no asociado a esta ficha.`);
            }
            continue;
          }
          clicked.add(control); if (href) seenProfiles.add(href);
          const action = (control.innerText || control.getAttribute("aria-label") || "").trim();
          const searchUrlBeforeClick = location.href;
          log(`Clic preparado · Connect · control=${control.tagName.toLowerCase()} texto exacto · ficha=${href || "no detectada"}`);
          control.click(); state.count++;
          state.message = `Connect · ${state.count}${state.max ? ` de ${state.max}` : ""}`;
          await sleep(250);
          if (location.href !== searchUrlBeforeClick) {
            state.stopped = true; state.message = "Detenido por seguridad: la página cambió después de pulsar Connect.";
            log(`ERROR · la URL cambió tras Connect: ${searchUrlBeforeClick} → ${location.href}`); break;
          }
          log(`Connect · acción ${state.count}${state.max ? `/${state.max}` : ""} · URL de búsqueda sin cambios.`); didAction = true;
          await sendWithoutNoteIfPrompted();
          if (state.stopped) break;
          await sleep(1300); if (checkLimits()) break;
        }
        if (state.stopped) break;
        // Keep advancing through the actual feed scroller, including nested LinkedIn result panels.
        const anchor = cards.find((card) => card.querySelector("a[href*='/in/']")) || document.querySelector("main") || document.body;
        const scroll = await scrollOneStep(anchor);
        idle = didAction ? 0 : idle + 1;
        if (scroll.atBottom && !didAction && !scroll.moved) bottomRounds++; else bottomRounds = 0;
        if (!scroll.moved && !scroll.atBottom) { log(`Scroll · no avanzó el contenedor (posición ${scroll.position}/${scroll.extent}).`); await sleep(800); }
        log(`Scroll · ${scroll.position}/${scroll.extent}${scroll.atBottom ? " · final del contenedor" : " · avanzando por resultados"}`);
        if (scroll.atBottom && didAction) log("Recorrido · se procesaron las tarjetas visibles al llegar al final; comprobando carga adicional.");
        if (isSearch && bottomRounds >= 3) {
          // Allow lazy-loaded cards to render before deciding this page is exhausted.
          await sleep(1400);
          const advanced = await paginate();
          if (advanced) { bottomRounds = 0; idle = 0; seenProfiles.clear(); continue; }
          state.message = "No se encontró otra página de resultados."; log(state.message); break;
        }
        if (idle >= 8 && !isSearch && scroll.atBottom) { state.message = "No hay más acciones visibles por ahora."; log(state.message); idle = 0; await sleep(2200); }
      }
      if (!state.stopped && (state.max === 0 || state.count < state.max) && !/No se encontró/.test(state.message)) state.message = `Límite alcanzado: ${state.count} acciones.`;
      else if (state.max && state.count >= state.max) state.message = `Límite alcanzado: ${state.count} acciones.`;
    } catch (e) { state.message = `Se detuvo por un error: ${e?.message || "desconocido"}`; log(`ERROR · ${e?.stack || e?.message || String(e)}`); }
    finally { state.running = false; log(`Fin · ${state.message} · acciones=${state.count} · CSV=${state.rows.length}`); }
  })();
  return { started: true };
}
function stopAutomation() { const s = window.__ceoAutoFollow; if (!s) return { running: false }; s.stopped = true; s.message = "Deteniendo…"; s.logs.push(`${new Date().toLocaleTimeString()} Detención solicitada desde la GUI.`); return { running: s.running }; }
function getAutomationStatus() { const s = window.__ceoAutoFollow; return s ? { running: s.running, count: s.count, rows: s.rows, logs: s.logs, message: s.message } : null; }
async function refreshStatus() {
  try { const s = await runOnPage(getAutomationStatus); if (!s) return;
    els.total.textContent = s.count;
    els.downloadCsv.textContent = `Descargar CSV (${s.rows?.length || 0})`; els.downloadCsv.disabled = !(s.rows?.length);
    const logText = (s.logs || []).join("\n");
    if (els.logOutput.value !== logText) { const wasAtBottom = els.logOutput.scrollTop + els.logOutput.clientHeight >= els.logOutput.scrollHeight - 8; els.logOutput.value = logText; if (wasAtBottom) els.logOutput.scrollTop = els.logOutput.scrollHeight; }
    setStatus(s.message); els.start.disabled = s.running; els.stop.disabled = !s.running;
  } catch { }
}
els.start.addEventListener("click", async () => {
  const max = Math.max(0, Number.parseInt(els.limit.value, 10) || 0);
  const keywords = [...els.keywords.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
  if (!keywords.length) { setStatus("Agrega al menos una keyword para iniciar."); return; }
  saveSettings(); els.start.disabled = true; setStatus("Iniciando la búsqueda…");
  try { const result = await runOnPage(startAutomation, [max, keywords, els.extractCsv.checked]);
    setStatus(result?.started ? "Automatización iniciada." : "La automatización ya está en marcha."); els.stop.disabled = false;
  } catch { setStatus("No se pudo iniciar. Abre LinkedIn y vuelve a intentarlo."); els.start.disabled = false; }
});
els.stop.addEventListener("click", async () => { try { await runOnPage(stopAutomation); setStatus("Deteniendo…"); } catch { setStatus("No se pudo detener en esta pestaña."); } });
els.copyLog.addEventListener("click", async () => {
  try {
    const text = els.logOutput.value || "No hay logs de ejecución todavía.";
    await navigator.clipboard.writeText(text); els.copyLog.textContent = "Copiado"; setTimeout(() => { els.copyLog.textContent = "Copiar log"; }, 1400);
  } catch { els.logOutput.focus(); els.logOutput.select(); document.execCommand("copy"); setStatus("Log seleccionado o copiado. Si no se copió, usa Ctrl+C."); }
});
els.downloadCsv.addEventListener("click", async () => {
  try {
    const s = await runOnPage(getAutomationStatus), rows = s?.rows || [];
    if (!rows.length) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [ ["Nombre", "Categoría", "Ubicación", "Link LinkedIn"], ...rows.map((r) => [r.name, r.category, r.location, r.link]) ].map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "perfiles-linkedin.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { setStatus("No se pudo preparar el CSV."); }
});
checkPage(); setInterval(refreshStatus, 900);
