const els = {
  page: document.getElementById("page"), status: document.getElementById("status"),
  total: document.getElementById("total"), emailCount: document.getElementById("emailCount"), websiteCount: document.getElementById("websiteCount"), progressLabel: document.getElementById("progressLabel"), limitLabel: document.getElementById("limitLabel"),
  limit: document.getElementById("limit"), enrichmentConcurrency: document.getElementById("enrichmentConcurrency"), start: document.getElementById("start"), stop: document.getElementById("stop"),
  keywords: document.getElementById("keywords"), addKeyword: document.getElementById("addKeyword"),
  extractOnly: document.getElementById("extractOnly"), downloadCsv: document.getElementById("downloadCsv"),
  logOutput: document.getElementById("logOutput"), copyLog: document.getElementById("copyLog"), clearData: document.getElementById("clearData")
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
    extractOnly: els.extractOnly.checked, limit: els.limit.value, enrichmentConcurrency: els.enrichmentConcurrency.value
  } });
}
chrome.storage.local.get("ceoAutoSettings", ({ ceoAutoSettings: s = {} }) => {
  const legacyDefaults = Array.isArray(s.keywords) && s.keywords.length === 2 &&
    s.keywords[0].toLowerCase() === "ceo" && s.keywords[1].toLowerCase() === "founder";
  if (legacyDefaults) { s.keywords = []; chrome.storage.local.set({ ceoAutoSettings: s }); }
  (s.keywords?.length ? s.keywords : [""]).forEach(addKeywordRow);
  els.extractOnly.checked = !!s.extractOnly;
  updateProgressLabel();
  if (s.limit !== undefined) els.limit.value = s.limit;
  els.enrichmentConcurrency.value = s.enrichmentConcurrency ?? "5";
});
els.addKeyword.addEventListener("click", () => { addKeywordRow(); els.keywords.lastElementChild.querySelector("input").focus(); saveSettings(); });
function updateProgressLabel() {
  els.progressLabel.textContent = els.extractOnly.checked ? "Perfiles extraídos" : "Conexiones";
  els.limitLabel.textContent = els.extractOnly.checked ? "Máximo de perfiles (0 = ilimitado)" : "Máximo de conexiones (0 = ilimitado)";
}
els.extractOnly.addEventListener("change", () => { saveSettings(); updateProgressLabel(); }); els.limit.addEventListener("change", saveSettings);
els.enrichmentConcurrency.addEventListener("change", () => {
  const value = Math.min(20, Math.max(1, Number.parseInt(els.enrichmentConcurrency.value, 10) || 5));
  els.enrichmentConcurrency.value = String(value); saveSettings();
});

async function checkPage() {
  try {
    const tab = await getActiveTab(); const url = new URL(tab?.url || "");
    if (tab?.id) automationTabId = tab.id;
    const allowed = url.hostname === "www.linkedin.com" || url.hostname.endsWith(".linkedin.com");
    els.page.textContent = allowed ? (url.pathname.includes("/search/results/people") ? "LinkedIn · resultados de personas" : "LinkedIn · sugerencias") : "Abre linkedin.com para usar la automatización";
    els.start.disabled = !allowed; els.stop.disabled = !allowed;
    if (!allowed) setStatus("La automatización funciona en pestañas de LinkedIn.");
  } catch { els.page.textContent = "No se pudo detectar la pestaña"; els.start.disabled = true; els.stop.disabled = true; }
}
async function runOnPage(func, args = []) {
  const tab = automationTabId ? await chrome.tabs.get(automationTabId) : await getActiveTab(); if (!tab?.id) throw new Error("No se encontró la pestaña de búsqueda.");
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }); return results?.[0]?.result;
}
let automationTabId = null;
const enrichmentInFlight = new Set();
const enrichmentTabs = new Set();
function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}
async function waitForTabLoad(tabId) {
  const started = Date.now();
  while (Date.now() - started < 25000) {
    await chrome.tabs.get(tabId);
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState });
      if (["interactive", "complete"].includes(result?.[0]?.result)) { await new Promise((resolve) => setTimeout(resolve, 700)); return; }
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Tiempo agotado cargando el perfil.");
}
function profilePageUrl(profileHref) {
  const url = new URL(profileHref);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/overlay\/contact-info$/i, "").replace(/\/en$/i, "") + "/";
  url.search = ""; url.hash = "";
  return url.href;
}
function isContactInfoUrl(value) {
  try { return /\/in\/[^/]+\/overlay\/contact-info\/?$/i.test(new URL(value).pathname); }
  catch { return false; }
}
async function clickContactInfoInProfileTab() {
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
  const selectorFor = (el) => {
    if (!el) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = []; let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += [...node.classList].slice(0, 4).map((name) => `.${CSS.escape(name)}`).join("");
      parts.unshift(part);
      const selector = parts.join(" > ");
      try { if ([...document.querySelectorAll(selector)].length === 1) return selector; } catch { }
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  const control = roots.flatMap((root) => [...root.querySelectorAll("a,button,[role='link'],[role='button']")]).find((el) => {
    const labels = [el.getAttribute("aria-label"), el.innerText, el.textContent].filter(Boolean).map((label) => label.replace(/\s+/g, " ").trim());
    return visible(el) && labels.some((label) => /^(contact info|see contact info|contact information|información de contacto)$/i.test(label));
  });
  if (!control) return { clicked: false };
  control.click();
  return { clicked: true, selector: selectorFor(control) };
}
async function contactInfoPanelReadyInProfileTab() {
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  const panels = roots.flatMap((root) => [...root.querySelectorAll('[role="dialog"], [aria-modal="true"], .artdeco-modal, .artdeco-modal__content')]);
  const headings = roots.flatMap((root) => [...root.querySelectorAll('h1,h2,h3,[role="heading"],div,span')]);
  return panels.some((el) => visible(el) && /contact info/i.test(el.innerText || el.textContent || ""))
    || headings.some((el) => visible(el) && (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "contact info")
    || /\/overlay\/contact-info\/?$/i.test(location.pathname);
}
async function scrapeContactInfoPanelInProfileTab() {
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  const dialogs = roots.flatMap((root) => [...root.querySelectorAll('[role="dialog"], [aria-modal="true"], .artdeco-modal, .artdeco-modal__content')]);
  let panel = dialogs.find((el) => visible(el) && /contact info/i.test(el.innerText || el.textContent || ""));
  if (!panel) {
    const heading = roots.flatMap((root) => [...root.querySelectorAll('h1,h2,h3,[role="heading"],div,span')])
      .find((el) => visible(el) && (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "contact info");
    let ancestor = heading;
    for (let depth = 0; ancestor && depth < 12; depth++, ancestor = ancestor.parentElement || ancestor.getRootNode()?.host) {
      const content = (ancestor.innerText || ancestor.textContent || "").replace(/\u00a0/g, " ");
      if (/contact info/i.test(content) && /(email|website)/i.test(content)) { panel = ancestor; break; }
    }
  }
  if (!panel && /\/overlay\/contact-info\/?$/i.test(location.pathname)) panel = document.body;
  if (!panel || !visible(panel)) return { ok: false, contactInfoOpened: false, error: "No se encontró el contenido del panel Contact info." };
  const text = (panel.innerText || panel.textContent || "").replace(/\u00a0/g, " ");
  const selectorFor = (el) => {
    if (!el) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = []; let node = el;
    while (node && node !== panel && node.nodeType === 1) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += [...node.classList].slice(0, 4).map((name) => `.${CSS.escape(name)}`).join("");
      parts.unshift(part);
      const selector = parts.join(" > ");
      try { if ([...panel.querySelectorAll(selector)].length === 1) return selector; } catch { }
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const extractEmailByAt = (value) => {
    const match = (value || "").match(/[^\s<>()[\]{}"'`,;]+@[^\s<>()[\]{}"'`,;]+/);
    return match?.[0]?.replace(/^[.,:;]+|[.,:;.!?]+$/g, "") || "";
  };
  const normalizeEmail = (value) => {
    const candidate = extractEmailByAt(value);
    return candidate && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : "";
  };
  const knownEmailSelectors = ["#envelope-outline-medium", ".aaaayy.aaaiu3.aaaj1t.aaaj06.aaaj1j.aaaiyn.aaaia7.aaal5q"];
  const emailScopes = knownEmailSelectors.flatMap((selector) => {
    let hits = []; try { hits = [...panel.querySelectorAll(selector)]; } catch { }
    return hits.flatMap((hit) => {
      const scopes = []; let node = hit;
      for (let depth = 0; node && depth < 5 && panel.contains(node); depth++, node = node.parentElement) scopes.push(node);
      return scopes.flatMap((scope) => [...scope.querySelectorAll("a[href]")]).filter((a) => visible(a));
    });
  });
  const emailCandidates = [...new Set([...emailScopes, ...panel.querySelectorAll("a[href]")])];
  const emailAnchor = emailCandidates.find((a) => visible(a) && (/^mailto:/i.test(a.href) || (a.innerText || a.textContent || "").includes("@") || (a.getAttribute("aria-label") || "").includes("@")));
  const emailHref = /^mailto:/i.test(emailAnchor?.getAttribute("href") || "")
    ? emailAnchor.getAttribute("href").replace(/^mailto:/i, "").split("?")[0]
    : "";
  const email = [emailHref, emailAnchor?.innerText, emailAnchor?.textContent, emailAnchor?.getAttribute("aria-label"), text]
    .map(normalizeEmail).find(Boolean) || "";
  const cleanExternalUrl = (href) => {
    try {
      const url = new URL(href, location.href);
      if (/linkedin\.com$/i.test(url.hostname) && /redir\/redirect/i.test(url.pathname)) {
        const target = url.searchParams.get("url"); if (target) return target;
      }
      return /^https?:$/.test(url.protocol) && !/(^|\.)linkedin\.com$/i.test(url.hostname) ? url.href : "";
    } catch { return ""; }
  };
  const labelElements = [...panel.querySelectorAll("a,button,[role='link'],[role='button'],span,div,p")].filter((el) => visible(el));
  const websiteLabel = labelElements.find((el) => /^website$/i.test((el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()));
  let website = "";
  let websiteAnchor = null;
  let labelAncestor = websiteLabel;
  for (let depth = 0; labelAncestor && depth < 7 && !website; depth++, labelAncestor = labelAncestor.parentElement) {
    websiteAnchor = [...labelAncestor.querySelectorAll("a[href]")].find((a) => cleanExternalUrl(a.href)) || null;
    website = websiteAnchor ? cleanExternalUrl(websiteAnchor.href) : "";
  }
  if (!website) {
    const knownWebsiteSelectors = ["#link-outline-medium", ".aaal6d.aaaayy.aaaiun.aaaj1t.aaaj08.aaaj1j.aaaix7.aaal5q"];
    const knownWebsiteNodes = knownWebsiteSelectors.flatMap((selector) => { try { return [...panel.querySelectorAll(selector)]; } catch { return []; } });
    for (const hit of knownWebsiteNodes) {
      let scope = hit;
      for (let depth = 0; scope && depth < 6 && panel.contains(scope) && !website; depth++, scope = scope.parentElement) {
        websiteAnchor = [...scope.querySelectorAll("a[href]")].find((a) => cleanExternalUrl(a.href)) || null;
        website = websiteAnchor ? cleanExternalUrl(websiteAnchor.href) : "";
      }
      if (website) break;
    }
  }
  const allWebsiteAnchors = [...panel.querySelectorAll("a[href]")].filter((a) => visible(a) && cleanExternalUrl(a.href));
  websiteAnchor ||= allWebsiteAnchors[0] || null;
  const websites = new Set(allWebsiteAnchors.map((a) => cleanExternalUrl(a.href)).filter(Boolean));
  if (!websites.size) {
    const websiteSection = text.match(/Website\s*([\s\S]{0,500}?)(?=\b(?:Email|Phone|Birthday|Connected since)\b|$)/i)?.[1] || "";
    const rawUrls = websiteSection.match(/(?:https?:\/\/|www\.)[^\s<>()]+|\b[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\.[A-Z]{2,}(?:\/[^\s<>()]*)?/gi) || [];
    for (let value of rawUrls) {
      value = value.replace(/[.,;!?]+$/g, "");
      if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
      const cleaned = cleanExternalUrl(value);
      if (cleaned) websites.add(cleaned);
    }
  }
  website = [...websites].join("; ");
  return { ok: true, contactInfoOpened: true, email, website, selectors: { email: selectorFor(emailAnchor), website: selectorFor(websiteAnchor) } };
}
async function enrichOneProfile(sourceTabId, href) {
  let profileTabId = null;
  let profileTabClosed = false;
  let contactInfoWasOpened = false;
  const closeProfileTab = async () => {
    if (profileTabId == null) return profileTabClosed;
    const closingId = profileTabId;
    try { await withTimeout(chrome.tabs.remove(closingId), 4000, "Tiempo agotado cerrando pestaña."); profileTabClosed = true; }
    catch {
      const stillExists = await withTimeout(chrome.tabs.get(closingId), 2500, "Tiempo agotado comprobando pestaña.").then(() => true, () => false);
      if (!stillExists) profileTabClosed = true;
      else { try { await withTimeout(chrome.tabs.remove(closingId), 4000, "Tiempo agotado reintentando cierre."); profileTabClosed = true; } catch { } }
    }
    if (profileTabClosed) { enrichmentTabs.delete(closingId); profileTabId = null; }
    return profileTabClosed;
  };
  const writeResultToSearchTab = async (payload) => {
    const injected = await chrome.scripting.executeScript({ target: { tabId: sourceTabId }, func: (profileHref, data) => {
      const s = window.__ceoAutoFollow; if (!s) return null;
      const row = s.rows.find((item) => item.link === profileHref); if (!row) return null;
      row.email_contacto = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || "") ? data.email : "";
      row.website_contacto = data.website || "";
      row.enrichment_status = data.ok ? "complete" : "error";
      s.logs.push(`${new Date().toLocaleTimeString()} Enriquecimiento · ${data.ok ? `email=${data.email ? "sí" : "no"} · website=${data.website ? "sí" : "no"}` : data.error} · Contact info=${data.contactInfoOpened ? "abierto desde el perfil" : "no abierto"} · pestaña=${data.tabClosed ? "cerrada" : "no cerrada"} · ${profileHref}`);
      if (data.contactInfoSelector || (data.selectors && (data.selectors.email || data.selectors.website))) s.logs.push(`${new Date().toLocaleTimeString()} Autoaprendizaje · selectores Contact info · botón=${data.contactInfoSelector || "sin dato"} · email=${data.selectors?.email || "sin dato"} · website=${data.selectors?.website || "sin dato"}`);
      if (s.logs.length > 250) s.logs.splice(0, s.logs.length - 250);
      return { emails: s.rows.filter((item) => !!item.email_contacto).length, websites: s.rows.filter((item) => !!item.website_contacto).length };
    }, args: [href, { ...payload, tabClosed: profileTabClosed }] });
    const counts = injected?.[0]?.result;
    if (counts) { els.emailCount.textContent = counts.emails; els.websiteCount.textContent = counts.websites; }
  };
  try {
    const created = await chrome.tabs.create({ url: profilePageUrl(href), active: false });
    profileTabId = created.id; enrichmentTabs.add(profileTabId);
    await waitForTabLoad(profileTabId);
    let panelOpened = false, clickSucceeded = false, clickAttempts = 0, lastClickAt = 0, contactInfoSelector = "";
    for (let attempt = 0; attempt < 36 && !panelOpened; attempt++) {
      const tab = await chrome.tabs.get(profileTabId).catch(() => null);
      if (tab && isContactInfoUrl(tab.url)) {
        await waitForTabLoad(profileTabId);
        await new Promise((resolve) => setTimeout(resolve, 800));
        panelOpened = true;
      } else {
        const ready = await chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: contactInfoPanelReadyInProfileTab }).catch(() => null);
        panelOpened = !!ready?.[0]?.result;
        if (!panelOpened && !clickSucceeded && clickAttempts < 3 && Date.now() - lastClickAt > 2500) {
          lastClickAt = Date.now();
          clickAttempts++;
          const clicked = await chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: clickContactInfoInProfileTab }).catch(() => null);
          clickSucceeded = !!(clicked?.[0]?.result?.clicked ?? clicked?.[0]?.result);
          contactInfoSelector = clicked?.[0]?.result?.selector || contactInfoSelector;
        }
        if (!panelOpened) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!panelOpened) throw new Error("No se pudo abrir Contact info desde el perfil.");
    contactInfoWasOpened = true;
    let payload = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await withTimeout(
        chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: scrapeContactInfoPanelInProfileTab }),
        12000,
        "Tiempo agotado leyendo los datos de Contact info."
      ).catch(() => null);
      payload = result?.[0]?.result || null;
      if (payload?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (!payload) payload = { ok: false, contactInfoOpened: true, error: "Contact info abrió, pero no devolvió datos legibles." };
    payload.contactInfoSelector = contactInfoSelector;
    if (!await closeProfileTab()) throw new Error("No se pudo cerrar la pestaña de enriquecimiento.");
    await writeResultToSearchTab(payload);
  } catch (error) {
    await closeProfileTab();
    try { await writeResultToSearchTab({ ok: false, email: "", website: "", contactInfoOpened: contactInfoWasOpened, error: error?.message || "error desconocido" }); } catch { }
  } finally {
    try { await withTimeout(closeProfileTab(), 10000, "Tiempo agotado cerrando la pestaña enriquecida."); } catch { }
    enrichmentInFlight.delete(href);
  }
}
async function scheduleEnrichment(sourceTabId, rows) {
  if (!sourceTabId) return;
  const setting = Math.min(20, Math.max(1, Number.parseInt(els.enrichmentConcurrency.value, 10) || 5));
  const capacity = setting - enrichmentInFlight.size;
  if (capacity <= 0) return;
  // Recover rows orphaned when the popup closed during enrichment.
  const candidates = rows.filter((row) => row.link && (["pending", "queued"].includes(row.enrichment_status)
    || (row.enrichment_status === "processing" && !enrichmentInFlight.has(row.link)))
    && !enrichmentInFlight.has(row.link)).slice(0, capacity);
  if (!candidates.length) return;
  const links = candidates.map((row) => row.link);
  const claimResult = await chrome.scripting.executeScript({ target: { tabId: sourceTabId }, func: (candidateLinks) => {
    const state = window.__ceoAutoFollow; if (!state) return [];
    const claimed = [];
    for (const link of candidateLinks) {
      const row = state.rows.find((item) => item.link === link);
      if (row && (["pending", "queued"].includes(row.enrichment_status) || row.enrichment_status === "processing")) { row.enrichment_status = "processing"; claimed.push(link); }
    }
    return claimed;
  }, args: [links] }).catch(() => null);
  const claimed = new Set(claimResult?.[0]?.result || []);
  for (const row of candidates) {
    if (!claimed.has(row.link)) continue;
    enrichmentInFlight.add(row.link);
    void enrichOneProfile(sourceTabId, row.link);
  }
}
window.addEventListener("beforeunload", () => {
  for (const tabId of enrichmentTabs) chrome.tabs.remove(tabId).catch(() => {});
});

function startAutomation(maxActions, keywords, extractOnly, enrichmentConcurrency) {
  if (window.__ceoAutoFollow?.running) return { started: false };
  const state = { running: true, stopped: false, count: 0, max: maxActions, enrichmentConcurrency, rows: [], logs: [], message: "Preparando resultados…" };
  window.__ceoAutoFollow = state;
  const log = (message) => { state.logs.push(`${new Date().toLocaleTimeString()} ${message}`); if (state.logs.length > 250) state.logs.splice(0, state.logs.length - 250); };
  log(`Inicio · página ${location.href} · keywords: ${keywords.join(", ")} · CSV: sí · pestañas de enriquecimiento simultáneas=${enrichmentConcurrency} · modo=${extractOnly ? "solo extraer" : "conectar y extraer"}`);
  const normalized = keywords.map((k) => k.toLocaleLowerCase()).filter(Boolean);
  const clicked = new WeakSet(); const seenProfiles = new Set(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth; };
  const contactCardSelector = [
    ".aaal6d.aaaivr.aaalce.aaalcv.aaaldd.aaaldu.aaaayy.aaaiun.aaaj1t.aaaj08.aaaj1j.aaaixb.aaal5q",
    ".mxtl50.mxtivr.mxtlce.mxtlcv.mxtldd.mxtldu.mxtayy.mxtiun.mxtj1t.mxtj08.mxtj1j.mxtixb.mxtl5q"
  ].join(", ");
  const roleTextSelector = "a.mxtmg5.mxtmg4 > div.mxtl50.mxtivr > div.mxtayy.mxtiu3:nth-of-type(1) > div.mxtl50.mxtivr:nth-of-type(2) > div.mxtlis.mxtgpp:nth-of-type(2) > p.mxtlje.mxtlo0";
  const isSearch = location.pathname.includes("/search/results/people");
  const normalizeProfileHref = (value) => {
    try {
      const url = new URL(value, location.href);
      url.pathname = url.pathname.replace(/\/en\/?$/i, "/").replace(/\/$/, "") + "/";
      url.search = ""; url.hash = "";
      return /\/in\//i.test(url.pathname) ? url.href : "";
    } catch { return ""; }
  };
  const learnedSelectors = Object.create(null);
  let learnedSelectorPage = "";
  let learnedSelectorLogs = new Set();
  // Selector examples supplied during debugging. Keep these as candidates,
  // validate them against the current DOM, and let live page evidence decide
  // which one is usable. Text examples are probes, not hard-coded matches.
  const selectorHintCatalog = {
    card: [
      { type: "css", selector: ".aaal6d.aaaivr.aaalce.aaalcv.aaaldd.aaaldu.aaaayy.aaaiun.aaaj1t.aaaj08.aaaj1j.aaaixb.aaal5q" },
      { type: "css", selector: ".mxtl50.mxtivr.mxtlce.mxtlcv.mxtldd.mxtldu.mxtayy.mxtiun.mxtj1t.mxtj08.mxtj1j.mxtixb.mxtl5q" },
      { type: "css", selector: "div.aaaayq > a.aaamic > div.aaal6d" },
      { type: "xpath", selector: "//div/a/div" }
    ],
    keyword: [
      { type: "css", selector: "div.aaalis > p.aaalje > span" },
      { type: "text", text: "Payments & Fintech Senior Executive | Scaling Global", exact: false },
      { type: "text", text: "CEO at Getnet | Global, Fintech , Leadership", exact: true },
      { type: "text", text: "Driving Fintech Innovation @ Finom", exact: true }
    ],
    name: [{ type: "text", text: "Dan Patiño", exact: true }],
    location: [{ type: "text", text: "Buenos Aires, Buenos Aires Province, Argentina", exact: true }],
    currentRole: [{ type: "text", text: "Current: Co-founder & CTO at Fex -Solutions", exact: true }],
    legacyRole: [{ type: "css", selector: "a.mxtmg5.mxtmg4 > div.mxtl50.mxtivr > div.mxtayy.mxtiu3:nth-of-type(1) > div.mxtl50.mxtivr:nth-of-type(2) > div.mxtlis.mxtgpp:nth-of-type(2) > p.mxtlje.mxtlo0" }],
    connect: [
      { type: "text", text: "Connect", exact: true },
      { type: "css", selector: '[id^="SearchResultsA"] a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb' },
      { type: "css", selector: "#SearchResultsACoAACx3NjUBkiYGL45kX_RzL4VP3gAvVdN9rbI > div.mxtayq.mxtl5q > div.mxta2a.mxtht3 > div.mxtayq.mxtl5q > a.mxtlxl.mxtlxk > span.mxtlzr.mxtlyb" },
      { type: "xpath", selector: "//body/div[1]/div[1]/div[2]/div[2]/main/div/div/div/div[2]/div/section/div/div/div/div[1]/div[1]/div/div[1]/div/div/a/div/div[1]/div[2]/div/div/div/div/a/span" }
    ],
    sendWithoutNote: [{ type: "text", text: "Send without a note", exact: true }],
    contactInfo: [{ type: "text", text: "Contact info", exact: true }],
    email: [
      { type: "css", selector: "#envelope-outline-medium" },
      { type: "css", selector: ".aaaayy.aaaiu3.aaaj1t.aaaj06.aaaj1j.aaaiyn.aaaia7.aaal5q" },
      { type: "text", text: "Email", exact: true },
      { type: "text", text: "(Personal)", exact: true },
      { type: "text", text: "@", exact: false }
    ],
    website: [
      { type: "css", selector: "#link-outline-medium" },
      { type: "css", selector: ".aaal6d.aaaayy.aaaiun.aaaj1t.aaaj08.aaaj1j.aaaix7.aaal5q" },
      { type: "text", text: "Website", exact: true }
    ],
    pagination: [
      { type: "text", text: "Next", exact: true },
      { type: "text", text: "2", exact: true }
    ]
  };
  const hintElements = (hint, root = document) => {
    try {
      if (hint.type === "css") return [...root.querySelectorAll(hint.selector)];
      if (hint.type === "xpath") {
        const doc = root.ownerDocument || root;
        const result = doc.evaluate(hint.selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: result.snapshotLength }, (_, index) => result.snapshotItem(index)).filter((el) => el?.nodeType === 1);
      }
      if (hint.type === "text") {
        const target = hint.text.toLocaleLowerCase();
        return [...root.querySelectorAll("a,button,[role='button'],[role='link'],span,p,div")].filter((el) => {
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
          return hint.exact ? text === target : text.includes(target);
        });
      }
    } catch { }
    return [];
  };
  const probeSelectorHints = () => {
    const summary = [];
    for (const [kind, hints] of Object.entries(selectorHintCatalog)) {
      const probes = hints.map((hint) => ({ hint, found: hintElements(hint).filter(visible) }));
      let validCount = 0;
      for (const { hint, found } of probes) {
        if (kind === "card") validCount += found.filter((el) => new Set([...el.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean)).size === 1).length;
        else if (kind === "keyword") validCount += found.filter((el) => (el.innerText || el.textContent || "").trim().length > 8).length;
        else if (kind === "connect" || kind === "sendWithoutNote" || kind === "contactInfo") {
          const expected = kind === "connect" ? "connect" : kind === "sendWithoutNote" ? "send without a note" : "contact info";
          validCount += found.filter((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase() === expected).length;
        }
        else if (kind === "pagination") validCount += found.length;
        else if (["name", "location", "currentRole"].includes(kind)) validCount += found.length;
        else if (kind === "email") validCount += found.filter((el) => /@|email/i.test(`${el.getAttribute("href") || ""} ${el.innerText || el.textContent || ""}`)).length;
        else if (kind === "website") validCount += found.filter((el) => /website|https?:\/\//i.test(`${el.getAttribute("href") || ""} ${el.innerText || el.textContent || ""}`)).length;
      }
      summary.push(`${kind}=${validCount}/${probes.length} selectores con coincidencias`);
    }
    state.selectorHintCalibration = Object.fromEntries(Object.entries(selectorHintCatalog).map(([kind, hints]) => [kind, hints.map((hint) => ({ ...hint, matches: hintElements(hint).filter(visible).length }))]));
    log(`Autoaprendizaje · selectores aportados evaluados antes del escaneo · ${summary.join(" · ")}`);
  };
  const selectorForElement = (element, root = document) => {
    if (!element || !root?.querySelectorAll) return "";
    const matchesTarget = (selector) => {
      try { const found = [...root.querySelectorAll(selector)]; return found.length === 1 && found[0] === element; }
      catch { return false; }
    };
    if (element.id) {
      const idSelector = `#${CSS.escape(element.id)}`;
      if (matchesTarget(idSelector)) return idSelector;
    }
    const segments = [];
    let node = element;
    while (node && node !== root && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const classes = [...node.classList].filter(Boolean);
      let segment = tag + classes.map((name) => `.${CSS.escape(name)}`).join("");
      if (!classes.length) {
        const siblings = [...(node.parentElement?.children || [])].filter((sibling) => sibling.tagName === node.tagName);
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      segments.unshift(segment);
      const selector = segments.join(" > ");
      if (matchesTarget(selector)) return selector;
      node = node.parentElement;
    }
    return segments.join(" > ");
  };
  const rememberSelector = (kind, element, root = document) => {
    const selector = selectorForElement(element, root);
    if (!selector) return "";
    learnedSelectors[kind] = selector;
    state.learnedSelectors = { ...learnedSelectors };
    if (!learnedSelectorLogs.has(kind)) {
      learnedSelectorLogs.add(kind);
      log(`Autoaprendizaje · selector ${kind}=${selector}`);
    }
    return selector;
  };
  const useLearnedSelector = (kind, root = document) => {
    const selector = learnedSelectors[kind];
    if (!selector || !root?.querySelectorAll) return [];
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  };
  const learnBestCardSelector = (candidates) => {
    const selectors = new Set([contactCardSelector, "li", ".artdeco-card", "[data-view-name*='search-result']"]);
    for (const hint of selectorHintCatalog.card) if (hint.type === "css") selectors.add(hint.selector);
    for (const element of [...candidates].slice(0, 18)) {
      const tag = element.tagName.toLowerCase();
      const classes = [...element.classList].filter(Boolean).slice(0, 8);
      for (const name of classes) selectors.add(`${tag}.${CSS.escape(name)}`);
      if (classes.length) selectors.add(`${tag}${classes.map((name) => `.${CSS.escape(name)}`).join("")}`);
    }
    let best = null;
    for (const selector of selectors) {
      let found;
      try { found = [...document.querySelectorAll(selector)]; } catch { continue; }
      if (!found.length) continue;
      const valid = found.filter((element) => {
        const links = new Set([...element.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean));
        const text = (element.innerText || "").trim();
        const actions = [...element.querySelectorAll("button,a,[role='button']")].some((control) => /^(connect|follow|pending|message)$/i.test((control.innerText || control.getAttribute("aria-label") || "").trim()));
        return links.size === 1 && text.length > 35 && (actions || element.matches(contactCardSelector));
      });
      const hrefs = new Set(valid.map((element) => normalizeProfileHref(element.querySelector("a[href*='/in/']")?.href || "")).filter(Boolean));
      if (!hrefs.size) continue;
      const score = hrefs.size * 100 - Math.max(0, valid.length - hrefs.size) * 18 - Math.max(0, found.length - valid.length) * 12 - selector.length * 0.02;
      if (!best || score > best.score) best = { selector, score, hrefCount: hrefs.size };
    }
    return best;
  };
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
        const hinted = hintElements(selectorHintCatalog.sendWithoutNote[0], root).find(visible);
        const span = hinted || [...root.querySelectorAll("span")].find((el) =>
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
      const profileLinks = new Set([...n.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean));
      const hasAction = [...n.querySelectorAll("button, a[role='button'], [role='button']")].some((el) => /^(follow|connect)$/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
      if (profileLinks.size === 1 && hasAction) return n;
    }
    n = button; for (let d = 0; n.parentElement && d < 6; d++) n = n.parentElement; return n;
  };
  const profileHref = (card) => normalizeProfileHref(card.querySelector("a[href*='/in/']")?.href || "");
  const getCardText = (card) => {
    const roleTexts = [...card.querySelectorAll(roleTextSelector)].map((el) => el.innerText.trim()).filter(Boolean);
    const currentTexts = [...card.querySelectorAll("p, span, div")].map((el) => (el.innerText || "").trim())
      .filter((t) => /^Current\s*:/i.test(t) && t.length < 500);
    return [...new Set([...roleTexts, ...currentTexts, card.innerText || ""])].join("\n");
  };
  const getCurrentText = (card) => [...new Set([...card.querySelectorAll("p, span, div")]
    .map((el) => (el.innerText || "").trim())
    .filter((text) => /^Current\s*:/i.test(text) && text.length < 500))]
    .sort((a, b) => a.length - b.length)[0] || "";
  const getHeadlineText = (card) => {
    const lines = (card.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const profileName = (card.querySelector("a[href*='/in/']")?.innerText || "").trim().split("\n")[0];
    const nameIndex = profileName ? lines.findIndex((line) => line.toLocaleLowerCase().startsWith(profileName.toLocaleLowerCase())) : 0;
    const countryLine = /\b(argentina|india|spain|united states|united kingdom|canada|mexico|brazil|chile|colombia|peru|uruguay|paraguay|bolivia|ecuador|france|germany|italy|portugal|netherlands|ireland|australia|new zealand|singapore|japan|china|israel|sweden|norway|denmark|switzerland|poland|romania|ukraine|kazakhstan)\s*$/i;
    const headline = [];
    for (let i = Math.max(0, nameIndex + 1); i < lines.length && headline.length < 4; i++) {
      let line = lines[i];
      if (/^(current|past|people also viewed|mutual connections?|connect summary)\s*:/i.test(line)) break;
      line = line.split(/\s+Connect\s+Summary\s*:/i)[0].split(/\s+(?:Connect|Follow|Message)\s+Current\s*:/i)[0].trim();
      const degreeMarker = line.match(/•\s*(?:1st|2nd|3rd)\s+/i);
      if (degreeMarker) line = line.slice(degreeMarker.index + degreeMarker[0].length).trim();
      if (!line) continue;
      if (countryLine.test(line) || /^greater\s+(buenos aires|mendoza)\b/i.test(line)) break;
      headline.push(line);
    }
    return headline.join("\n");
  };
  const getKeywordText = (card) => {
    // Keywords are defined against the headline directly below the person's
    // name. Prefer the current LinkedIn selector, then compatible variants;
    // the line-based parser is a fallback for layouts/classes that change.
    const headlineNodes = [...new Set([
      ...selectorHintCatalog.keyword.filter((hint) => hint.type === "css").flatMap((hint) => hintElements(hint, card)),
      ...card.querySelectorAll("div.aaalis p.aaalje > span, p.aaalje > span")
    ])];
    const headlines = [...new Set(headlineNodes.map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
    if (headlines.length) return headlines.join("\n");
    return getHeadlineText(card);
  };
  const getActionControl = (card, cardIndex, allCards) => {
    // Match Playwright getByText('Connect', { exact: true }) within this one
    // contact card. Click the smallest exact-text element so the card itself is
    // never the target. Ignore any Connect text nested in the profile link.
    const labelText = (el) => (el.innerText || "").trim() || (el.textContent || "").trim() || (el.getAttribute("aria-label") || "").trim();
    const hintedMatches = selectorHintCatalog.connect.flatMap((hint) => hintElements(hint, card));
    const learnedMatches = [...useLearnedSelector("connect", card), ...hintedMatches]
      .filter((el) => labelText(el) === "Connect" && visible(el) && inViewport(el));
    const matches = [...new Set([...learnedMatches, ...card.querySelectorAll("button, [role='button'], a, span, div")])]
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
          const links = [...new Set([...ancestor.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean))];
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
    const statuses = new Set(["Connect", "Pending", "Follow", "Message"]);
    const normalizedStatus = (el) => {
      const values = [el.innerText, el.textContent, el.getAttribute("aria-label"), el.getAttribute("title")]
        .map((value) => (value || "").replace(/\s+/g, " ").trim());
      return values.find((value) => statuses.has(value)) || "";
    };
    // In some LinkedIn layouts the action lives outside the result-card wrapper.
    // Search all rendered action labels, then associate each with the nearest
    // result card by screen geometry instead of relying on obfuscated class names.
    const labels = [...new Set([...useLearnedSelector("status"), ...document.querySelectorAll("button, a, [role='button'], [aria-label], [title], span, div")])]
      .filter((el) => normalizedStatus(el) && visible(el));
    const checked = new Set();
    for (const label of labels) {
      const action = label.closest("button, a, [role='button']") || label;
      if (checked.has(action)) continue;
      checked.add(action);
      const rect = action.getBoundingClientRect(), midY = rect.top + rect.height / 2;
      let nearest = null, nearestDistance = Infinity;
      for (const candidate of allCards) {
        const cardRect = candidate.getBoundingClientRect();
        const distance = midY < cardRect.top ? cardRect.top - midY : midY > cardRect.bottom ? midY - cardRect.bottom : 0;
        if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
      }
      if (nearest === card && nearestDistance <= Math.max(100, rect.height * 4)) { rememberSelector("status", action); return normalizedStatus(label); }
    }
    return false;
  };
  const extractRow = (card, text, href, allCards) => {
    if (!href || state.rows.some((r) => r.link === href)) return;
    const anchors = [...card.querySelectorAll("a[href*='/in/']")];
    const name = (anchors.find((a) => normalizeProfileHref(a.href) === href)?.innerText || "").trim().split("\n")[0];
    const singleLine = (value) => String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    const lines = text.split("\n").map(singleLine).filter(Boolean);
    const locationPattern = /(?:,\s*)?(?:united states|argentina|canada|united kingdom|mexico|brazil|spain|chile|colombia|peru|uruguay|paraguay|bolivia|ecuador|france|germany|italy|portugal|netherlands|ireland|australia|new zealand|singapore|japan|china|israel|sweden|norway|denmark|switzerland|poland|romania|ukraine|kazakhstan|remote)\s*$/i;
    const isLocation = (line) => locationPattern.test(line) || /^(?:greater\s+)?(?:buenos aires|mendoza|cordoba|córdoba)(?:,|$)/i.test(line);
    const locationLine = lines.find(isLocation) || "";
    const current = singleLine(getCurrentText(card).replace(/^Current\s*:\s*/i, ""));
    const headline = singleLine(getHeadlineText(card));
    const companySource = current || headline;
    const atMatch = companySource.match(/\s+at\s+([^|•·;]+?)(?:\s+-\s+|\s+[—–-]\s+|$)/i);
    const atCompany = atMatch?.[1] || "";
    const mentionMatch = !atCompany && companySource.match(/@\s*([^|•·;]+?)(?:\s+[|•·]\s+|\s+[—–-]\s+|$)/);
    const currentCompany = singleLine(atCompany || mentionMatch?.[1] || "");
    const contactStatus = getActionStatus(card, allCards) || "No detectado";
    state.rows.push({
      name: singleLine(name),
      headline,
      location: locationLine,
      link: href,
      estado_contacto: contactStatus,
      empresa_actual: currentCompany,
      email_contacto: "",
      website_contacto: "",
      enrichment_status: "queued"
    });
    log(`CSV · perfil agregado: ${name || href} · estado=${contactStatus}`);
  };
  const paginate = async () => {
    const clickables = [...document.querySelectorAll("button, a, [role='button'], [tabindex='0']")]
      .filter((el) => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
    const currentIndicator = document.querySelector('[aria-current="page"], .artdeco-pagination__indicator--number.active, [class*="pagination"] [aria-current]');
    const pageFromLabel = (el) => {
      if (!el) return 0;
      const label = `${el.getAttribute("aria-label") || ""} ${el.innerText || el.textContent || ""}`;
      return Number(label.match(/(?:page\s*)?(\d+)/i)?.[1]) || 0;
    };
    const pageNow = pageFromLabel(currentIndicator) || Number(new URL(location.href).searchParams.get("page")) || 1;
    const paginationRoots = [...document.querySelectorAll('nav, [class*="pagination"], [aria-label*="pagination" i], footer')];
    let paginationRoot = null;
    if (currentIndicator) {
      let ancestor = currentIndicator;
      for (let i = 0; ancestor && i < 8; i++, ancestor = ancestor.parentElement) {
        const controls = [...ancestor.querySelectorAll("button,a,[role='button'],[tabindex='0']")];
        if (controls.length >= 2 && controls.some((el) => /^\d+$/.test((el.innerText || el.textContent || "").trim()))) { paginationRoot = ancestor; break; }
      }
    }
    if (!paginationRoot) paginationRoot = paginationRoots
      .filter((root) => visible(root) && root.querySelectorAll("button,a,[role='button'],[tabindex='0']").length >= 2)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
    const inPagination = (el) => paginationRoot ? paginationRoot.contains(el) : false;
    const isNextLabel = (el) => {
      const semantic = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("data-test-pagination-page-btn") || ""}`.replace(/\s+/g, " ").trim();
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const classes = typeof el.className === "string" ? el.className : "";
      return /^next(?:\s+page)?\s*[›>→]*$/i.test(semantic) || /^next(?:\s+page)?\s*[›>→]*$/i.test(text) || /pagination__button--next|chevron-right/i.test(classes);
    };
    let next = useLearnedSelector("next").find((el) => clickables.includes(el) && isNextLabel(el) && (!paginationRoot || inPagination(el)));
    if (!next) next = hintElements(selectorHintCatalog.pagination[0], paginationRoot || document)
      .find((el) => clickables.includes(el) && isNextLabel(el) && (!paginationRoot || inPagination(el)));
    if (!next) next = clickables.find((el) => isNextLabel(el) && (!paginationRoot || inPagination(el)));
    if (!next && paginationRoot) next = [...paginationRoot.querySelectorAll("button,a,[role='button'],[tabindex='0']")]
      .find((el) => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && (el.querySelector("svg[aria-label*='right' i], svg[class*='chevron-right']") || el.matches("button[class*='next'],a[class*='next']")));
    if (!next && paginationRoot) {
      next = [...paginationRoot.querySelectorAll("button,a,[role='button'],[tabindex='0']")].find((el) => visible(el) && !el.disabled && (el.innerText || el.textContent || "").trim() === String(pageNow + 1));
    }
    if (!next) {
      next = clickables.filter((el) => {
        const rect = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || "").trim();
        const text = (el.innerText || el.textContent || "").trim();
        return (rect.top > window.innerHeight * 0.35 && text === String(pageNow + 1)) || new RegExp(`^page\\s*${pageNow + 1}$`, "i").test(label);
      }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
    }
    if (!next) {
      const nextPageLink = clickables.map((el) => ({ el, page: (() => { try { return Number(new URL(el.href, location.href).searchParams.get("page")) || 0; } catch { return 0; } })() }))
        .filter((item) => item.page > pageNow && (!paginationRoot || inPagination(item.el)))
        .sort((a, b) => a.page - b.page)[0];
      next = nextPageLink?.el || null;
    }
    if (!next) { log(`Paginación · no se halló control Next ni número ${pageNow + 1}; controles visibles=${clickables.length}; página=${pageNow}.`); return false; }
    rememberSelector("next", next);
    const before = location.href;
    const activeBefore = currentIndicator;
    const activeText = activeBefore?.innerText?.trim();
    const profileSignatureBefore = [...new Set([...document.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean))].slice(0, 12).join("|");
    const controlLabel = (next.getAttribute("aria-label") || next.innerText || next.textContent || "siguiente página").trim();
    next.click(); state.message = "Avanzando a la siguiente página…"; log(`Paginación · clic en ${controlLabel} después de recorrer hasta el final.`);
    for (let i = 0; i < 30 && !state.stopped; i++) {
      await sleep(500);
      const activeNow = document.querySelector('[aria-current="page"], .artdeco-pagination__indicator--number.active, [class*="pagination"] [aria-current]');
      const signatureNow = [...new Set([...document.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean))].slice(0, 12).join("|");
      if (location.href !== before || (activeNow && (activeNow.innerText || activeNow.textContent || "").trim() !== activeText) || (signatureNow && signatureNow !== profileSignatureBefore)) break;
    }
    await sleep(1300);
    const activeAfter = document.querySelector('[aria-current="page"], .artdeco-pagination__indicator--number.active, [class*="pagination"] [aria-current]');
    const profileSignatureAfter = [...new Set([...document.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean))].slice(0, 12).join("|");
    const changed = location.href !== before || (!!activeAfter && (activeAfter.innerText || activeAfter.textContent || "").trim() !== activeText) || pageFromLabel(activeAfter) > pageNow || (!!profileSignatureAfter && profileSignatureAfter !== profileSignatureBefore);
    log(changed ? `Paginación · página nueva detectada: ${location.href}` : "Paginación · se pulsó Next pero no cambió la página.");
    return changed;
  };
  const waitForPageEnrichment = async (profileLinks) => {
    let announced = false;
    while (!state.stopped) {
      if (document.visibilityState === "hidden") {
        const pendingCount = [...profileLinks].filter((href) => {
          const row = state.rows.find((item) => item.link === href);
          return row && ["pending", "queued", "processing"].includes(row.enrichment_status);
        }).length;
        if (pendingCount) log(`Enriquecimiento · búsqueda en pestaña oculta; ${pendingCount} perfil(es) quedan en cola y se continúa con la página siguiente.`);
        return true;
      }
      const pending = [...profileLinks].filter((href) => {
        const row = state.rows.find((item) => item.link === href);
        return row && ["pending", "queued", "processing"].includes(row.enrichment_status);
      });
      if (!pending.length) {
        if (announced) log(`Enriquecimiento · tareas de los ${profileLinks.size} perfiles de esta página finalizadas; listo para paginar.`);
        return true;
      }
      state.message = `Esperando el enriquecimiento de ${pending.length} perfiles antes de cambiar de página…`;
      if (!announced) { log(`Enriquecimiento · esperando ${pending.length} perfil(es) de esta página antes de paginar.`); announced = true; }
      await sleep(500);
    }
    return false;
  };
  const getScroller = (anchor) => {
    const learned = useLearnedSelector("scroll").find((el) => el.contains(anchor) && visible(el)
      && el.clientHeight > 160 && el.scrollHeight - el.clientHeight > 24 && getComputedStyle(el).overflowY !== "visible");
    if (learned) return learned;
    const scrollable = (el) => el && el.clientHeight > 160 && el.scrollHeight - el.clientHeight > 24 && getComputedStyle(el).overflowY !== "visible";
    let node = anchor;
    while (node && node !== document.body && node !== document.documentElement) {
      if (scrollable(node)) { rememberSelector("scroll", node); return node; }
      node = node.parentElement;
    }
    const containingScrollers = [...document.querySelectorAll("*")]
      .filter((el) => scrollable(el) && visible(el) && (!anchor || el.contains(anchor)))
      .sort((a, b) => (a.scrollHeight - a.clientHeight) - (b.scrollHeight - b.clientHeight));
    if (containingScrollers.length) { rememberSelector("scroll", containingScrollers[0]); return containingScrollers[0]; }
    rememberSelector("scroll", document.scrollingElement || document.documentElement);
    return document.scrollingElement || document.documentElement;
  };
  const scrollOneStep = async (anchor) => {
    const scroller = getScroller(anchor);
    const isDocument = scroller === document.scrollingElement || scroller === document.documentElement;
    const before = isDocument ? window.scrollY : scroller.scrollTop;
    const viewportBefore = isDocument ? window.innerHeight : scroller.clientHeight;
    const step = Math.max(450, Math.floor(viewportBefore * 0.68));
    const anchorRect = anchor?.getBoundingClientRect();
    if (anchorRect && anchorRect.top >= window.innerHeight - 20) anchor.scrollIntoView({ block: "center", behavior: "auto" });
    else if (isDocument) window.scrollBy({ top: step, behavior: "auto" });
    else scroller.scrollBy({ top: step, behavior: "auto" });
    await sleep(1150);
    const after = isDocument ? window.scrollY : scroller.scrollTop;
    const extent = isDocument ? document.documentElement.scrollHeight : scroller.scrollHeight;
    const viewport = isDocument ? window.innerHeight : scroller.clientHeight;
    const position = isDocument ? window.scrollY : scroller.scrollTop;
    const maxScroll = Math.max(0, extent - viewport);
    const offscreenResults = [...document.querySelectorAll(contactCardSelector)].filter((card) => visible(card) && card.getBoundingClientRect().top >= window.innerHeight).length;
    const atPhysicalBottom = maxScroll <= 24 || position + viewport >= extent - 80;
    const anchorMoved = !!anchorRect && anchor.getBoundingClientRect().top < anchorRect.top - 3;
    return { moved: Math.abs(after - before) > 3 || anchorMoved, atBottom: atPhysicalBottom && offscreenResults === 0, position, extent, viewport, offscreenResults };
  };
  (async () => {
    try {
      const showAll = [...document.querySelectorAll("button,a,[role='button']")].find((el) => visible(el) && /^show all$/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()));
      if (showAll) { showAll.click(); await sleep(1200); log("Expandido Show all antes de recorrer tarjetas."); }
      let idle = 0, bottomRounds = 0;
      let pageProfileLinks = new Set();
      let processedMatchesOnPage = new Set();
      const noConnectLogged = new Set();
      const limitReached = () => state.max > 0 && (extractOnly ? state.rows.length >= state.max : state.count >= state.max);
      while (!state.stopped && !limitReached()) {
        if (checkLimits()) break;
        const pageKey = `${location.pathname}?page=${new URL(location.href).searchParams.get("page") || "1"}`;
        if (learnedSelectorPage !== pageKey) {
          learnedSelectorPage = pageKey;
          learnedSelectorLogs = new Set();
          log(`Autoaprendizaje · calibrando selectores en página ${new URL(location.href).searchParams.get("page") || "1"} antes del escaneo.`);
          probeSelectorHints();
        }
        const exactContactCards = [...document.querySelectorAll(contactCardSelector)];
        let cards = isSearch && exactContactCards.length
          ? [...exactContactCards]
          : [...new Set([
              ...document.querySelectorAll("li, .artdeco-card, .discover-entity-type-card, [data-view-name*='search-result'], [data-view-name*='recommendation']"),
              ...[...document.querySelectorAll("button, a[role='button'], [role='button'], [tabindex]")].map(getCard)
            ])];
        if (isSearch) {
          const candidateCards = new Set(cards);
          // The obfuscated class selector is incomplete on some LinkedIn layouts.
          // Always add cards discovered from each profile link and its nearby action.
          const resultProfileLinks = new Set(document.querySelectorAll("main a[href*='/in/']"));
          // Current LinkedIn result cards expose the profile link through this
          // inner node even when the older card class has changed.
          const profileNodes = [...document.querySelectorAll("div.aaaayq > a.aaamic > div.aaal6d")];
          for (const node of profileNodes) {
            const link = node.closest("a[href*='/in/']");
            if (link) resultProfileLinks.add(link);
            const candidate = getCard(node);
            if (candidate) candidateCards.add(candidate);
          }
          const genericXpathNodes = hintElements(selectorHintCatalog.card.find((hint) => hint.type === "xpath"));
          for (const node of genericXpathNodes) {
            const candidate = getCard(node);
            if (candidate) candidateCards.add(candidate);
          }
          for (const link of resultProfileLinks) {
            const candidate = getCard(link);
            if (candidate) candidateCards.add(candidate);
          }
          const learnedCard = learnBestCardSelector(candidateCards);
          if (learnedCard?.selector) {
            const selectorMatches = [...document.querySelectorAll(learnedCard.selector)];
            for (const candidate of selectorMatches) candidateCards.add(candidate);
            const sample = selectorMatches.find((candidate) => {
              const links = new Set([...candidate.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean));
              return links.size === 1;
            });
            if (sample) {
              learnedSelectors.card = learnedCard.selector;
              state.learnedSelectors = { ...learnedSelectors };
              if (!learnedSelectorLogs.has("card")) {
                learnedSelectorLogs.add("card");
                log(`Autoaprendizaje · selector fichas=${learnedCard.selector} · cobertura=${learnedCard.hrefCount} perfiles`);
              }
            }
          }
          const bestCardByHref = new Map();
          for (const candidate of candidateCards) {
            const profileLinks = [...new Set([...candidate.querySelectorAll("a[href*='/in/']")].map((a) => normalizeProfileHref(a.href)).filter(Boolean))];
            if (profileLinks.length !== 1) continue;
            const href = profileLinks[0];
            const detail = getKeywordText(candidate);
            const score = Math.min(detail.length, 1800) + (getCurrentText(candidate) ? 500 : 0) + (getHeadlineText(candidate) ? 250 : 0);
            const currentBest = bestCardByHref.get(href);
            if (!currentBest || score > currentBest.score) bestCardByHref.set(href, { card: candidate, score });
          }
          if (bestCardByHref.size) cards = [...bestCardByHref.values()].map((entry) => entry.card);
        }
        const uniqueProfileCount = new Set(cards.map(profileHref).filter(Boolean)).size;
        const visibleProfileLinkCount = isSearch
          ? new Set([...document.querySelectorAll("main a[href*='/in/'], div.aaaayq > a.aaamic[href*='/in/']")].map((link) => normalizeProfileHref(link.href)).filter(Boolean)).size
          : uniqueProfileCount;
        log(`Escaneo · ${cards.length} fichas únicas de ${uniqueProfileCount} perfiles detectadas (${visibleProfileLinkCount} enlaces de perfil en resultados); revisando keywords.`);
        let didAction = false;
        for (const card of cards) {
          if (state.stopped || limitReached()) break;
          const text = getCardText(card), keywordText = getKeywordText(card), normalizedText = keywordText.toLocaleLowerCase();
          if (!keywordText.trim()) continue;
          const matchedKeyword = normalized.find((word) => normalizedText.includes(word.toLocaleLowerCase()));
          if (!matchedKeyword) continue;
          const keywordElement = [...card.querySelectorAll("div.aaalis > p.aaalje > span, div.aaalis p.aaalje > span, p.aaalje > span, p,span,div")]
            .filter((el) => (el.innerText || el.textContent || "").toLocaleLowerCase().includes(matchedKeyword.toLocaleLowerCase()))
            .sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length)[0];
          if (keywordElement) rememberSelector("keyword", keywordElement, card);
          const href = profileHref(card);
          if (href && processedMatchesOnPage.has(href)) continue;
          if (href) processedMatchesOnPage.add(href);
          log(`Coincidencia · keyword="${matchedKeyword}" · titular="${keywordText.replace(/\s+/g, " ").slice(0, 180)}" · perfil=${href || "sin enlace"}`);
          if (href && !state.rows.some((r) => r.link === href)) extractRow(card, text, href, cards);
          if (href && state.rows.some((r) => r.link === href)) pageProfileLinks.add(href);
          if (href && state.enrichmentConcurrency === 1) {
            const row = state.rows.find((item) => item.link === href);
            if (row && ["pending", "queued", "processing"].includes(row.enrichment_status)) {
              if (document.visibilityState === "hidden") {
                log(`Enriquecimiento · búsqueda en segundo plano; ${row.name || href} queda en cola y continúa el escaneo.`);
              } else {
                log(`Enriquecimiento secuencial · esperando a terminar ${row.name || href} antes de la siguiente ficha.`);
                while (!state.stopped && document.visibilityState !== "hidden" && ["pending", "queued", "processing"].includes(row.enrichment_status)) await sleep(250);
                if (document.visibilityState === "hidden" && ["pending", "queued", "processing"].includes(row.enrichment_status))
                  log(`Enriquecimiento · búsqueda en segundo plano; ${row.name || href} queda en cola y el escaneo continúa.`);
              }
            }
          }
          if (state.stopped) break;
          if (extractOnly) {
            if (href && state.rows.some((r) => r.link === href)) {
              state.message = `Perfil extraído · ${state.rows.length}${state.max ? ` de ${state.max}` : ""}`;
              log(`Solo extracción · perfil agregado al CSV · total=${state.rows.length}${state.max ? `/${state.max}` : ""}.`);
            } else log("Solo extracción · ficha coincidente sin enlace de perfil; no se pudo agregar al CSV.");
            if (limitReached()) break;
            continue;
          }
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
              else if (actionStatus === "Connect") log(`Sin acción · se detectó Connect para ${href || "perfil sin enlace"}, pero no se pudo asociar el control a una ficha visible.`);
              else log(`Sin acción · coincidencia ${href || "sin enlace detectable"}; Connect detectados=${state.allConnectCount ?? "sin consulta"}, visibles=${state.visibleConnectCount ?? "sin consulta"}, fichas=${cards.length}; estados Pending/Follow/Message no detectados y Connect no asociado a esta ficha.`);
            }
            continue;
          }
          clicked.add(control); if (href) seenProfiles.add(href);
          rememberSelector("connect", control, card.contains(control) ? card : document);
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
          const invitationDialogHandled = await sendWithoutNoteIfPrompted();
          if (state.stopped) break;
          if (href) {
            const refreshedCard = [...document.querySelectorAll(contactCardSelector)].find((candidate) => profileHref(candidate) === href) || card;
            const refreshedStatus = getActionStatus(refreshedCard, cards);
            if (invitationDialogHandled || refreshedStatus === "Pending") {
              const csvRow = state.rows.find((row) => row.link === href);
              if (csvRow) csvRow.estado_contacto = "Pending";
              log(`CSV · estado_contacto actualizado a Pending · perfil=${href}`);
            }
          }
          await sleep(1300); if (checkLimits()) break;
        }
        if (state.stopped) break;
        // Keep advancing through the actual feed scroller, including nested LinkedIn result panels.
        const anchor = cards.filter((card) => card.querySelector("a[href*='/in/']") && card.getBoundingClientRect().top >= window.innerHeight)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
          || cards.find((card) => card.querySelector("a[href*='/in/']") && inViewport(card))
          || cards.find((card) => card.querySelector("a[href*='/in/']"))
          || document.querySelector("main") || document.body;
        const scroll = await scrollOneStep(anchor);
        idle = didAction ? 0 : idle + 1;
        if (scroll.atBottom && !didAction && !scroll.moved) bottomRounds++; else bottomRounds = 0;
        if (!scroll.moved && !scroll.atBottom) { log(`Scroll · no avanzó el contenedor (posición ${scroll.position}/${scroll.extent}).`); await sleep(800); }
        log(`Scroll · ${scroll.position}+${scroll.viewport}/${scroll.extent}${scroll.atBottom ? " · final del contenedor" : ` · avanzando por resultados · fichas fuera de vista=${scroll.offscreenResults}`}`);
        if (scroll.atBottom && didAction) log("Recorrido · se procesaron las tarjetas visibles al llegar al final; comprobando carga adicional.");
        if (isSearch && bottomRounds >= 3) {
          // Allow lazy-loaded cards to render before deciding this page is exhausted.
          await sleep(1400);
          if (!await waitForPageEnrichment(pageProfileLinks)) break;
          const advanced = await paginate();
          if (advanced) { bottomRounds = 0; idle = 0; seenProfiles.clear(); pageProfileLinks = new Set(); processedMatchesOnPage = new Set(); continue; }
          state.message = "No se encontró otra página de resultados."; log(state.message); break;
        }
        if (idle >= 8 && !isSearch && scroll.atBottom) { state.message = "No hay más acciones visibles por ahora."; log(state.message); idle = 0; await sleep(2200); }
      }
      if (!state.stopped && limitReached()) state.message = extractOnly
        ? `Límite alcanzado: ${state.rows.length} perfiles extraídos.`
        : `Límite alcanzado: ${state.count} conexiones.`;
      else if (!state.stopped && !/No se encontró/.test(state.message)) state.message = extractOnly
        ? `Extracción finalizada: ${state.rows.length} perfiles.`
        : `Conexiones finalizadas: ${state.count}.`;
    } catch (e) { state.message = `Se detuvo por un error: ${e?.message || "desconocido"}`; log(`ERROR · ${e?.stack || e?.message || String(e)}`); }
    finally { state.running = false; log(`Fin · ${state.message} · acciones=${state.count} · CSV=${state.rows.length}`); }
  })();
  return { started: true };
}
function stopAutomation() { const s = window.__ceoAutoFollow; if (!s) return { running: false }; s.stopped = true; s.message = "Deteniendo…"; s.logs.push(`${new Date().toLocaleTimeString()} Detención solicitada desde la GUI.`); return { running: s.running }; }
function clearAutomationData() {
  const s = window.__ceoAutoFollow;
  if (s?.running) return { cleared: false, reason: "Detén la ejecución antes de limpiar los datos." };
  if (s) { s.rows = []; s.logs = []; s.count = 0; s.learnedSelectors = {}; s.message = "Datos limpiados."; }
  return { cleared: true };
}
function getAutomationStatus() { const s = window.__ceoAutoFollow; return s ? { running: s.running, count: s.count, rows: s.rows, logs: s.logs, message: s.message } : null; }
async function refreshStatus() {
  try { const s = await runOnPage(getAutomationStatus); if (!s) return;
    await scheduleEnrichment(automationTabId, s.rows || []);
    els.total.textContent = els.extractOnly.checked ? (s.rows?.length || 0) : s.count;
    els.emailCount.textContent = (s.rows || []).filter((row) => !!row.email_contacto).length;
    els.websiteCount.textContent = (s.rows || []).filter((row) => !!row.website_contacto).length;
    const waiting = (s.rows || []).filter((row) => ["pending", "queued"].includes(row.enrichment_status) && !enrichmentInFlight.has(row.link)).length;
    const pendingEnrichment = waiting + enrichmentInFlight.size;
    els.downloadCsv.textContent = pendingEnrichment ? `Enriqueciendo (${pendingEnrichment})` : `Descargar CSV (${s.rows?.length || 0})`;
    els.downloadCsv.disabled = !(s.rows?.length) || pendingEnrichment > 0;
    els.clearData.disabled = s.running || pendingEnrichment > 0;
    const logText = (s.logs || []).join("\n");
    if (els.logOutput.value !== logText) { const wasAtBottom = els.logOutput.scrollTop + els.logOutput.clientHeight >= els.logOutput.scrollHeight - 8; els.logOutput.value = logText; if (wasAtBottom) els.logOutput.scrollTop = els.logOutput.scrollHeight; }
    setStatus(pendingEnrichment ? `${s.message} · Enriqueciendo perfiles; quedan ${pendingEnrichment}.` : s.message); els.start.disabled = s.running; els.stop.disabled = !s.running;
  } catch { }
}
els.start.addEventListener("click", async () => {
  const max = Math.max(0, Number.parseInt(els.limit.value, 10) || 0);
  const enrichmentConcurrency = Math.min(20, Math.max(1, Number.parseInt(els.enrichmentConcurrency.value, 10) || 5));
  els.enrichmentConcurrency.value = String(enrichmentConcurrency);
  const keywords = [...els.keywords.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
  if (!keywords.length) { setStatus("Agrega al menos una keyword para iniciar."); return; }
  saveSettings(); els.start.disabled = true; setStatus("Iniciando la búsqueda…");
  try {
    const tab = await getActiveTab(); automationTabId = tab?.id || null;
    const result = await runOnPage(startAutomation, [max, keywords, els.extractOnly.checked, enrichmentConcurrency]);
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
els.clearData.addEventListener("click", async () => {
  if (!window.confirm("¿Borrar los perfiles recopilados, contadores y registro de ejecución?")) return;
  try {
    const result = await runOnPage(clearAutomationData);
    if (!result?.cleared) { setStatus(result?.reason || "No se pudieron limpiar los datos."); return; }
    els.total.textContent = "0"; els.emailCount.textContent = "0"; els.websiteCount.textContent = "0";
    els.logOutput.value = ""; els.downloadCsv.textContent = "Descargar CSV (0)"; els.downloadCsv.disabled = true;
    setStatus("Datos de esta ejecución eliminados.");
  } catch { setStatus("Abre LinkedIn para limpiar los datos de la ejecución."); }
});
els.downloadCsv.addEventListener("click", async () => {
  try {
    const s = await runOnPage(getAutomationStatus), rows = s?.rows || [];
    if (!rows.length) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["Nombre", "Titular", "Ubicación", "Link LinkedIn", "estado_contacto", "empresa_actual", "email_contacto", "website_contacto"],
      ...rows.map((r) => [r.name, r.headline, r.location, r.link, r.estado_contacto, r.empresa_actual, r.email_contacto, r.website_contacto])
    ].map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "perfiles-linkedin.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { setStatus("No se pudo preparar el CSV."); }
});
checkPage(); setInterval(refreshStatus, 900);
