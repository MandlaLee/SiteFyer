const APP_VERSION = "1.0.0";
const DB_NAME = "sitefyer-v1";
const DB_VERSION = 1;
const JOB_STORE = "jobs";
const FILE_STORE = "files";
const MAX_VISIBLE_LOGS = 240;
const INSPECTABLE_KINDS = new Set(["css", "js", "manifest"]);
const PAGE_EXTENSIONS = new Set(["", "html", "htm", "php", "asp", "aspx", "jsp", "cfm"]);
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "rtf", "csv", "epub", "zip", "xml", "json"
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const FONT_EXTENSIONS = new Set(["woff", "woff2", "ttf", "otf", "eot"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "ogg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "oga", "flac"]);
const SAFE_TEXT_KINDS = new Set(["page", "html", "css", "js", "manifest", "xml", "text", "json"]);

const ui = {
  mirrorForm: document.querySelector("#mirrorForm"),
  sourceUrl: document.querySelector("#sourceUrl"),
  scanButton: document.querySelector("#scanButton"),
  respectRobots: document.querySelector("#respectRobots"),
  includeSubdomains: document.querySelector("#includeSubdomains"),
  includeExternalAssets: document.querySelector("#includeExternalAssets"),
  concurrency: document.querySelector("#concurrency"),
  requestDelay: document.querySelector("#requestDelay"),
  requestTimeout: document.querySelector("#requestTimeout"),
  maxPages: document.querySelector("#maxPages"),
  maxFiles: document.querySelector("#maxFiles"),
  maxDepth: document.querySelector("#maxDepth"),
  customProxy: document.querySelector("#customProxy"),
  networkPill: document.querySelector("#networkPill"),
  networkText: document.querySelector("#networkText"),
  resumePanel: document.querySelector("#resumePanel"),
  resumeDescription: document.querySelector("#resumeDescription"),
  resumeSavedButton: document.querySelector("#resumeSavedButton"),
  discardSavedButton: document.querySelector("#discardSavedButton"),
  progressPanel: document.querySelector("#progressPanel"),
  phaseEyebrow: document.querySelector("#phaseEyebrow"),
  phaseTitle: document.querySelector("#phaseTitle"),
  phaseDescription: document.querySelector("#phaseDescription"),
  statusBadge: document.querySelector("#statusBadge"),
  progressBar: document.querySelector("#progressBar"),
  totalFilesStat: document.querySelector("#totalFilesStat"),
  pagesStat: document.querySelector("#pagesStat"),
  downloadedStat: document.querySelector("#downloadedStat"),
  remainingStat: document.querySelector("#remainingStat"),
  failedStat: document.querySelector("#failedStat"),
  bytesStat: document.querySelector("#bytesStat"),
  countdownCard: document.querySelector("#countdownCard"),
  countedFilesText: document.querySelector("#countedFilesText"),
  countdownNumber: document.querySelector("#countdownNumber"),
  downloadNowButton: document.querySelector("#downloadNowButton"),
  cancelCountdownButton: document.querySelector("#cancelCountdownButton"),
  pauseButton: document.querySelector("#pauseButton"),
  continueButton: document.querySelector("#continueButton"),
  cancelButton: document.querySelector("#cancelButton"),
  clearLogButton: document.querySelector("#clearLogButton"),
  activityLog: document.querySelector("#activityLog"),
  completedPanel: document.querySelector("#completedPanel"),
  completedSummary: document.querySelector("#completedSummary"),
  saveZipButton: document.querySelector("#saveZipButton"),
  newMirrorButton: document.querySelector("#newMirrorButton")
};

class SiteFyerDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(JOB_STORE)) {
          const jobs = db.createObjectStore(JOB_STORE, { keyPath: "id" });
          jobs.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          const files = db.createObjectStore(FILE_STORE, { keyPath: "key" });
          files.createIndex("jobId", "jobId");
          files.createIndex("url", "url");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }

  async transact(storeNames, mode, callback) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
      let result;
      try {
        result = callback(stores, transaction);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted"));
    });
  }

  async putJob(job) {
    job.updatedAt = new Date().toISOString();
    await this.transact([JOB_STORE], "readwrite", ({ jobs }) => jobs.put(structuredClone(job)));
  }

  async getJob(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(JOB_STORE, "readonly").objectStore(JOB_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async listJobs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(JOB_STORE, "readonly").objectStore(JOB_STORE).getAll();
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      request.onerror = () => reject(request.error);
    });
  }

  async putFile(record) {
    await this.transact([FILE_STORE], "readwrite", ({ files }) => files.put(record));
  }

  async getFile(jobId, url) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).get(fileKey(jobId, url));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getFilesForJob(jobId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const index = db.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).index("jobId");
      const request = index.getAll(IDBKeyRange.only(jobId));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteJob(id) {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([JOB_STORE, FILE_STORE], "readwrite");
      transaction.objectStore(JOB_STORE).delete(id);
      const fileStore = transaction.objectStore(FILE_STORE);
      const index = fileStore.index("jobId");
      const cursorRequest = index.openKeyCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          fileStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Delete aborted"));
    });
  }
}

class FetchRouter {
  constructor(options, logger) {
    this.options = options;
    this.logger = logger;
    this.lastRequestAt = 0;
  }

  routesFor(targetUrl) {
    const encoded = encodeURIComponent(targetUrl);
    const routes = [
      { name: "direct", url: targetUrl },
      ...(this.options.customProxy
        ? [{ name: "custom proxy", url: buildProxyUrl(this.options.customProxy, targetUrl) }]
        : []),
      { name: "corsproxy.io", url: `https://corsproxy.io/?url=${encoded}` },
      { name: "AllOrigins", url: `https://api.allorigins.win/raw?url=${encoded}` },
      { name: "CodeTabs", url: `https://api.codetabs.com/v1/proxy?quest=${encoded}` }
    ];
    return dedupeBy(routes, (route) => route.url);
  }

  async fetch(targetUrl, { retries = 2 } = {}) {
    assertPublicHttpUrl(targetUrl);
    let lastError = null;
    const routes = this.routesFor(targetUrl);

    for (let round = 0; round <= retries; round += 1) {
      for (const route of routes) {
        await waitForInternet();
        await this.applyDelay();
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
          const response = await fetch(route.url, {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            redirect: "follow",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal
          });
          window.clearTimeout(timeout);
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
          const blob = await response.blob();
          if (!blob.size && response.status !== 204) throw new Error("Empty response");
          return {
            blob,
            contentType: response.headers.get("content-type") || blob.type || "application/octet-stream",
            route: route.name,
            status: response.status
          };
        } catch (error) {
          lastError = error;
          if (error?.name === "AbortError") {
            this.logger("warn", `${route.name} timed out for ${targetUrl}`);
          }
        }
      }
      if (round < retries) await sleep(Math.min(12000, 1200 * (2 ** round)));
    }

    throw new Error(`Every fetch route failed: ${lastError?.message || "unknown network error"}`);
  }

  async applyDelay() {
    const delay = Number(this.options.requestDelayMs) || 0;
    if (!delay) return;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < delay) await sleep(delay - elapsed);
    this.lastRequestAt = Date.now();
  }
}

const db = new SiteFyerDB();
let currentJob = null;
let recoveredJob = null;
let controllerState = {
  running: false,
  manualPaused: false,
  cancelled: false,
  countdownTimer: null,
  zipBlob: null,
  zipName: null
};

function log(level, message) {
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const levelNode = document.createElement("span");
  levelNode.className = "log-level";
  levelNode.dataset.level = level;
  levelNode.textContent = level;
  const messageNode = document.createElement("span");
  messageNode.textContent = message;
  item.append(time, levelNode, messageNode);
  ui.activityLog.prepend(item);
  while (ui.activityLog.children.length > MAX_VISIBLE_LOGS) ui.activityLog.lastElementChild.remove();
}

function readOptions() {
  return {
    respectRobots: ui.respectRobots.checked,
    includeSubdomains: ui.includeSubdomains.checked,
    includeExternalAssets: ui.includeExternalAssets.checked,
    concurrency: clampNumber(ui.concurrency.value, 1, 8, 3),
    requestDelayMs: clampNumber(ui.requestDelay.value, 0, 10000, 150),
    requestTimeoutMs: clampNumber(ui.requestTimeout.value, 5, 180, 35) * 1000,
    maxPages: Math.max(0, Number(ui.maxPages.value) || 0),
    maxFiles: Math.max(0, Number(ui.maxFiles.value) || 0),
    maxDepth: Math.max(0, Number(ui.maxDepth.value) || 0),
    customProxy: ui.customProxy.value.trim()
  };
}

function createJob(startUrl, options) {
  const start = new URL(startUrl);
  const id = `sitefyer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    version: APP_VERSION,
    startUrl: normalizeUrl(start.href),
    origin: start.origin,
    hostname: start.hostname.toLowerCase(),
    outputName: `${sanitizeSegment(start.hostname)}-sitefyer-mirror`,
    options,
    status: "scanning",
    resumeStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scanInitialized: false,
    resources: {},
    pageQueue: [],
    inspectQueue: [],
    sitemapQueue: [],
    seenSitemaps: [],
    robots: { loaded: false, rules: [], sitemaps: [] },
    totals: {
      files: 0,
      pages: 0,
      cached: 0,
      failed: 0,
      bytes: 0
    },
    countdownEnd: null,
    completedAt: null,
    lastError: null
  };
}

async function startNewMirror(event) {
  event.preventDefault();
  if (controllerState.running) return;

  let startUrl;
  try {
    startUrl = normalizeStartUrl(ui.sourceUrl.value);
    assertPublicHttpUrl(startUrl);
  } catch (error) {
    ui.sourceUrl.setCustomValidity(error.message);
    ui.sourceUrl.reportValidity();
    return;
  }
  ui.sourceUrl.setCustomValidity("");

  currentJob = createJob(startUrl, readOptions());
  controllerState = { running: true, manualPaused: false, cancelled: false, countdownTimer: null, zipBlob: null, zipName: null };
  resetPanelsForJob();
  addResource(currentJob.startUrl, "page", 0, "start URL", true);
  await checkpoint();
  log("info", `Started full-site discovery at ${currentJob.startUrl}`);

  try {
    await scanWholeWebsite();
    if (!controllerState.cancelled) await beginCountedCountdown();
  } catch (error) {
    await failJob(error);
  }
}

async function resumeJob(job) {
  if (controllerState.running) return;
  currentJob = job;
  controllerState = { running: true, manualPaused: false, cancelled: false, countdownTimer: null, zipBlob: null, zipName: null };
  ui.resumePanel.hidden = true;
  resetPanelsForJob(false);
  log("info", `Resumed checkpoint for ${currentJob.startUrl}`);

  try {
    if (currentJob.status === "paused") currentJob.status = currentJob.resumeStatus || "scanning";
    if (currentJob.status === "scanning") {
      await scanWholeWebsite();
      if (!controllerState.cancelled) await beginCountedCountdown();
    } else if (currentJob.status === "countdown") {
      await beginCountedCountdown(true);
    } else if (["downloading", "zipping"].includes(currentJob.status)) {
      await downloadAllResources();
    } else {
      currentJob.status = "scanning";
      await scanWholeWebsite();
      if (!controllerState.cancelled) await beginCountedCountdown();
    }
  } catch (error) {
    await failJob(error);
  }
}

async function scanWholeWebsite() {
  currentJob.status = "scanning";
  renderPhase();
  const fetcher = new FetchRouter(currentJob.options, log);

  if (!currentJob.scanInitialized) {
    currentJob.scanInitialized = true;
    if (currentJob.options.respectRobots) await loadRobots(fetcher);
    await seedSitemaps(fetcher);
    await checkpoint();
  }

  while (currentJob.sitemapQueue.length || currentJob.pageQueue.length || currentJob.inspectQueue.length) {
    await waitIfPausedOrOffline();
    assertNotCancelled();

    if (currentJob.sitemapQueue.length) {
      const sitemapUrl = currentJob.sitemapQueue.shift();
      await inspectSitemap(sitemapUrl, fetcher);
    } else if (currentJob.pageQueue.length) {
      const item = currentJob.pageQueue.shift();
      await inspectHtmlPage(item, fetcher);
    } else if (currentJob.inspectQueue.length) {
      const item = currentJob.inspectQueue.shift();
      await inspectAsset(item, fetcher);
    }
    recalculateTotals();
    renderStats();
    await checkpoint();
  }

  recalculateTotals();
  renderStats();
  log("success", `Discovery complete: ${currentJob.totals.files} files across ${currentJob.totals.pages} HTML pages.`);
}

async function loadRobots(fetcher) {
  if (currentJob.robots.loaded) return;
  const robotsUrl = new URL("/robots.txt", currentJob.origin).href;
  addResource(robotsUrl, "text", 0, "robots.txt", false);
  try {
    const record = await fetchAndCache(robotsUrl, "text", fetcher, { quiet: true });
    const text = await record.blob.text();
    currentJob.robots.rules = parseRobots(text);
    currentJob.robots.sitemaps = extractRobotsSitemaps(text, robotsUrl);
    currentJob.robots.loaded = true;
    log("info", `Loaded robots.txt with ${currentJob.robots.rules.length} crawl rules.`);
  } catch (error) {
    currentJob.robots.loaded = true;
    log("warn", `robots.txt was unavailable; continuing with public links. ${error.message}`);
  }
}

async function seedSitemaps() {
  const candidates = [
    ...currentJob.robots.sitemaps,
    new URL("/sitemap.xml", currentJob.origin).href,
    new URL("/sitemap_index.xml", currentJob.origin).href
  ];
  for (const url of dedupe(candidates.map(normalizeUrl))) queueSitemap(url);
}

function queueSitemap(url) {
  const normalized = normalizeUrl(url);
  if (currentJob.seenSitemaps.includes(normalized) || currentJob.sitemapQueue.includes(normalized)) return;
  currentJob.sitemapQueue.push(normalized);
  addResource(normalized, "xml", 0, "sitemap", false);
}

async function inspectSitemap(sitemapUrl, fetcher) {
  if (currentJob.seenSitemaps.includes(sitemapUrl)) return;
  currentJob.seenSitemaps.push(sitemapUrl);
  try {
    const record = await fetchAndCache(sitemapUrl, "xml", fetcher, { quiet: true });
    const xml = await record.blob.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid XML");
    const isIndex = Boolean(doc.querySelector("sitemapindex"));
    const locations = [...doc.querySelectorAll("loc")].map((node) => node.textContent?.trim()).filter(Boolean);
    if (isIndex) {
      for (const location of locations) queueSitemap(resolveUrl(location, sitemapUrl));
      log("info", `Sitemap index added ${locations.length} sitemap files.`);
    } else {
      let added = 0;
      for (const location of locations) {
        const pageUrl = safeResolveUrl(location, sitemapUrl);
        if (pageUrl && isPageInScope(pageUrl) && addResource(pageUrl, "page", 0, "sitemap", true)) added += 1;
      }
      log("info", `Sitemap added ${added} in-scope pages.`);
    }
  } catch (error) {
    markResourceError(sitemapUrl, error);
    log("warn", `Skipped sitemap ${sitemapUrl}: ${error.message}`);
  }
}

async function inspectHtmlPage(item, fetcher) {
  const resource = currentJob.resources[item.url];
  if (!resource || resource.inspected) return;
  if (!isAllowedByRobots(item.url)) {
    resource.inspected = true;
    resource.status = "skipped";
    resource.skipReason = "robots.txt";
    log("warn", `robots.txt skipped ${item.url}`);
    return;
  }

  try {
    const record = await fetchAndCache(item.url, "page", fetcher);
    const html = await record.blob.text();
    extractFromHtml(html, item.url, item.depth);
    resource.inspected = true;
    resource.kind = "page";
  } catch (error) {
    resource.inspected = true;
    markResourceError(item.url, error);
    log("error", `Could not inspect page ${item.url}: ${error.message}`);
  }
}

async function inspectAsset(item, fetcher) {
  const resource = currentJob.resources[item.url];
  if (!resource || resource.inspected) return;
  try {
    const record = await fetchAndCache(item.url, item.kind, fetcher, { quiet: true });
    const text = await record.blob.text();
    if (item.kind === "css") extractFromCss(text, item.url, item.depth);
    if (item.kind === "js") extractFromJavaScript(text, item.url, item.depth);
    if (item.kind === "manifest") extractFromManifest(text, item.url, item.depth);
    resource.inspected = true;
  } catch (error) {
    resource.inspected = true;
    markResourceError(item.url, error);
    log("warn", `Could not inspect ${item.kind.toUpperCase()} ${item.url}: ${error.message}`);
  }
}

function extractFromHtml(html, pageUrl, depth) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
  const baseUrl = baseHref ? safeResolveUrl(baseHref, pageUrl) || pageUrl : pageUrl;

  for (const node of doc.querySelectorAll("a[href], area[href]")) {
    const raw = node.getAttribute("href");
    const target = safeResolveUrl(raw, baseUrl);
    if (!target) continue;
    if (isLikelyPageUrl(target) && isPageInScope(target)) addResource(target, "page", depth + 1, pageUrl, true);
    else if (isDownloadableDocument(target)) addResource(target, classifyUrl(target), depth, pageUrl, false);
  }

  for (const node of doc.querySelectorAll("iframe[src], frame[src]")) {
    const target = safeResolveUrl(node.getAttribute("src"), baseUrl);
    if (target && isPageInScope(target)) addResource(target, "page", depth + 1, pageUrl, true);
  }

  const attributeRules = [
    ["script[src]", "src", "js"],
    ["img[src]", "src", "image"],
    ["source[src]", "src", "media"],
    ["video[src]", "src", "video"],
    ["video[poster]", "poster", "image"],
    ["audio[src]", "src", "audio"],
    ["track[src]", "src", "text"],
    ["object[data]", "data", "asset"],
    ["embed[src]", "src", "asset"],
    ["input[type='image'][src]", "src", "image"]
  ];

  for (const [selector, attribute, preferredKind] of attributeRules) {
    for (const node of doc.querySelectorAll(selector)) {
      const target = safeResolveUrl(node.getAttribute(attribute), baseUrl);
      if (target) addResource(target, inferKind(target, preferredKind), depth, pageUrl, false);
    }
  }

  for (const node of doc.querySelectorAll("img[srcset], source[srcset]")) {
    for (const candidate of parseSrcset(node.getAttribute("srcset"))) {
      const target = safeResolveUrl(candidate.url, baseUrl);
      if (target) addResource(target, inferKind(target, "image"), depth, pageUrl, false);
    }
  }

  for (const node of doc.querySelectorAll("link[href]")) {
    const rel = (node.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    const as = (node.getAttribute("as") || "").toLowerCase();
    const href = safeResolveUrl(node.getAttribute("href"), baseUrl);
    if (!href) continue;
    let kind = null;
    if (rel.includes("stylesheet")) kind = "css";
    else if (rel.includes("manifest")) kind = "manifest";
    else if (rel.some((value) => value.includes("icon"))) kind = "image";
    else if (rel.includes("modulepreload")) kind = "js";
    else if (rel.includes("preload") || rel.includes("prefetch")) kind = inferKind(href, as || "asset");
    else if (isDownloadableDocument(href) || hasKnownAssetExtension(href)) kind = classifyUrl(href);
    if (kind) addResource(href, kind, depth, pageUrl, false);
  }

  for (const selector of ["meta[property='og:image']", "meta[name='twitter:image']", "meta[name='msapplication-TileImage']"]) {
    for (const node of doc.querySelectorAll(selector)) {
      const target = safeResolveUrl(node.getAttribute("content"), baseUrl);
      if (target) addResource(target, inferKind(target, "image"), depth, pageUrl, false);
    }
  }

  for (const styleNode of doc.querySelectorAll("style")) extractFromCss(styleNode.textContent || "", baseUrl, depth);
  for (const styledNode of doc.querySelectorAll("[style]")) extractFromCss(styledNode.getAttribute("style") || "", baseUrl, depth);
}

function extractFromCss(css, cssUrl, depth) {
  const urls = new Set();
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  const importPattern = /@import\s+(?:url\(\s*)?['"]?([^'"\)\s;]+)[^;]*;/gi;
  for (const match of css.matchAll(urlPattern)) if (match[2]) urls.add(match[2].trim());
  for (const match of css.matchAll(importPattern)) if (match[1]) urls.add(match[1].trim());

  for (const raw of urls) {
    const target = safeResolveUrl(raw, cssUrl);
    if (!target) continue;
    const kind = raw.toLowerCase().endsWith(".css") ? "css" : classifyUrl(target);
    addResource(target, kind, depth, cssUrl, false);
  }
}

function extractFromJavaScript(js, jsUrl, depth) {
  const candidates = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /['"]([^'"]+\.(?:js|mjs|css|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|eot|pdf|mp4|webm|mov|m4v)(?:\?[^'"]*)?)['"]/gi
  ];
  for (const pattern of patterns) {
    for (const match of js.matchAll(pattern)) if (match[1]) candidates.add(match[1]);
  }
  for (const raw of candidates) {
    if (isBareModuleSpecifier(raw)) continue;
    const target = safeResolveUrl(raw, jsUrl);
    if (target) addResource(target, classifyUrl(target), depth, jsUrl, false);
  }
}

function extractFromManifest(text, manifestUrl, depth) {
  try {
    const manifest = JSON.parse(text);
    const paths = [];
    if (manifest.start_url) paths.push(manifest.start_url);
    for (const group of [manifest.icons, manifest.screenshots, manifest.shortcuts]) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        if (entry?.src) paths.push(entry.src);
        if (Array.isArray(entry?.icons)) for (const icon of entry.icons) if (icon?.src) paths.push(icon.src);
      }
    }
    for (const raw of paths) {
      const target = safeResolveUrl(raw, manifestUrl);
      if (!target) continue;
      if (isLikelyPageUrl(target) && isPageInScope(target)) addResource(target, "page", depth + 1, manifestUrl, true);
      else addResource(target, classifyUrl(target), depth, manifestUrl, false);
    }
  } catch {
    // A malformed or JavaScript-style manifest stays downloadable even if it cannot be inspected.
  }
}

function addResource(rawUrl, preferredKind, depth, source, isPage) {
  const url = safeNormalizeUrl(rawUrl);
  if (!url || !isPublicHttpUrl(url)) return false;
  if (isPage && !isPageInScope(url)) return false;
  if (!isPage && !currentJob.options.includeExternalAssets && !isPageInScope(url)) return false;
  if (currentJob.options.maxDepth && depth > currentJob.options.maxDepth) return false;

  const existing = currentJob.resources[url];
  if (existing) {
    if (preferredKind === "page" && existing.kind !== "page") {
      existing.kind = "page";
      existing.localPath = localPathFor(url, "page");
      if (!existing.inspected) {
        existing.inspectQueued = false;
        currentJob.inspectQueue = currentJob.inspectQueue.filter((item) => item.url !== url);
        queuePage(url, depth);
      }
    }
    return false;
  }

  if (currentJob.options.maxFiles && Object.keys(currentJob.resources).length >= currentJob.options.maxFiles) return false;
  if (isPage && currentJob.options.maxPages && countPages() >= currentJob.options.maxPages) return false;

  const kind = preferredKind || classifyUrl(url);
  currentJob.resources[url] = {
    url,
    kind,
    depth,
    source,
    localPath: localPathFor(url, kind),
    status: "pending",
    inspected: false,
    inspectQueued: false,
    contentType: "",
    size: 0,
    route: "",
    attempts: 0,
    error: "",
    skipReason: ""
  };

  if (kind === "page" || isPage) queuePage(url, depth);
  else if (INSPECTABLE_KINDS.has(kind)) queueInspectable(url, kind, depth);
  recalculateTotals();
  return true;
}

function queuePage(url, depth) {
  const resource = currentJob.resources[url];
  if (!resource || resource.inspectQueued || resource.inspected) return;
  resource.inspectQueued = true;
  currentJob.pageQueue.push({ url, depth });
}

function queueInspectable(url, kind, depth) {
  const resource = currentJob.resources[url];
  if (!resource || resource.inspectQueued || resource.inspected) return;
  resource.inspectQueued = true;
  currentJob.inspectQueue.push({ url, kind, depth });
}

async function fetchAndCache(url, kind, fetcher, { quiet = false } = {}) {
  const cached = await db.getFile(currentJob.id, url);
  if (cached) {
    const resource = currentJob.resources[url];
    if (resource) {
      resource.status = "cached";
      resource.size = cached.size;
      resource.contentType = cached.contentType;
      resource.route = cached.route || "checkpoint";
    }
    return cached;
  }

  const resource = currentJob.resources[url];
  if (resource) resource.attempts += 1;
  if (!quiet) log("info", `Fetching ${url}`);
  const fetched = await fetcher.fetch(url);
  const detectedKind = kindFromContentType(fetched.contentType) || kind;
  const record = {
    key: fileKey(currentJob.id, url),
    jobId: currentJob.id,
    url,
    blob: fetched.blob,
    contentType: fetched.contentType,
    size: fetched.blob.size,
    route: fetched.route,
    fetchedAt: new Date().toISOString()
  };
  try {
    await db.putFile(record);
  } catch (error) {
    if (error?.name === "QuotaExceededError") {
      throw new Error("Browser storage is full. Free space or reduce the crawl before continuing.");
    }
    throw error;
  }
  if (resource) {
    resource.status = "cached";
    resource.kind = reconcileKind(resource.kind, detectedKind);
    resource.localPath = localPathFor(url, resource.kind);
    resource.contentType = fetched.contentType;
    resource.size = fetched.blob.size;
    resource.route = fetched.route;
    resource.error = "";
  }
  return record;
}

async function beginCountedCountdown(resuming = false) {
  currentJob.status = "countdown";
  if (!resuming || !currentJob.countdownEnd) currentJob.countdownEnd = Date.now() + 5000;
  await checkpoint();
  renderPhase();
  ui.countdownCard.hidden = false;
  ui.countedFilesText.textContent = `${formatNumber(currentJob.totals.files)} files`;

  await new Promise((resolve) => {
    const tick = () => {
      if (controllerState.cancelled || currentJob.status !== "countdown") {
        window.clearInterval(controllerState.countdownTimer);
        controllerState.countdownTimer = null;
        resolve();
        return;
      }
      const remaining = Math.max(0, Math.ceil((currentJob.countdownEnd - Date.now()) / 1000));
      ui.countdownNumber.textContent = String(remaining);
      if (remaining <= 0) {
        window.clearInterval(controllerState.countdownTimer);
        controllerState.countdownTimer = null;
        resolve();
      }
    };
    tick();
    controllerState.countdownTimer = window.setInterval(tick, 250);
  });

  if (!controllerState.cancelled && currentJob.status === "countdown") await downloadAllResources();
}

async function downloadAllResources() {
  currentJob.status = "downloading";
  currentJob.countdownEnd = null;
  ui.countdownCard.hidden = true;
  await checkpoint();
  renderPhase();
  const fetcher = new FetchRouter(currentJob.options, log);
  const queue = Object.values(currentJob.resources).filter((resource) => !["cached", "skipped"].includes(resource.status));
  let cursor = 0;

  const worker = async () => {
    while (true) {
      await waitIfPausedOrOffline();
      assertNotCancelled();
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const resource = queue[index];
      try {
        await fetchAndCache(resource.url, resource.kind, fetcher);
        log("success", `Saved ${resource.localPath}`);
      } catch (error) {
        markResourceError(resource.url, error);
        log("error", `Failed ${resource.url}: ${error.message}`);
      }
      recalculateTotals();
      renderStats();
      await checkpoint();
    }
  };

  const workerCount = Math.max(1, Math.min(currentJob.options.concurrency, queue.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  assertNotCancelled();
  await buildAndSaveZip();
}

async function buildAndSaveZip() {
  if (!window.JSZip) throw new Error("The ZIP engine did not load. Reconnect to the internet and reload SiteFyer.");
  currentJob.status = "zipping";
  await checkpoint();
  renderPhase();
  const files = await db.getFilesForJob(currentJob.id);
  const fileMap = new Map(files.map((record) => [record.url, record]));
  const zip = new window.JSZip();
  const root = currentJob.outputName;

  const resources = Object.values(currentJob.resources).filter((resource) => resource.status === "cached" && fileMap.has(resource.url));
  let processed = 0;
  for (const resource of resources) {
    await waitIfPausedOrOffline({ ignoreOffline: true });
    assertNotCancelled();
    const record = fileMap.get(resource.url);
    let content = record.blob;
    if (SAFE_TEXT_KINDS.has(resource.kind) || isTextContentType(record.contentType)) {
      const text = await record.blob.text();
      content = rewriteTextResource(text, resource);
    }
    zip.file(`${root}/${resource.localPath}`, content, {
      binary: content instanceof Blob,
      date: new Date(record.fetchedAt)
    });
    processed += 1;
    const percent = resources.length ? Math.round((processed / resources.length) * 45) : 45;
    setProgress(percent);
  }

  const manifest = buildCrawlManifest();
  zip.file(`${root}/sitefyer-manifest.json`, JSON.stringify(manifest, null, 2));
  zip.file(`${root}/README_OFFLINE.txt`, buildOfflineReadme(manifest));

  log("info", `Compressing ${formatNumber(resources.length)} downloaded files into one ZIP.`);
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 },
    streamFiles: true
  }, (metadata) => {
    setProgress(45 + Math.round(metadata.percent * 0.55));
    ui.phaseDescription.textContent = `Compressing ZIP: ${Math.round(metadata.percent)}%`;
  });

  controllerState.zipBlob = blob;
  controllerState.zipName = `${root}.zip`;
  saveBlob(blob, controllerState.zipName);
  currentJob.status = "completed";
  currentJob.completedAt = new Date().toISOString();
  await checkpoint();
  controllerState.running = false;
  renderCompleted(blob.size);
  log("success", `ZIP ready: ${controllerState.zipName}`);
}

function rewriteTextResource(text, resource) {
  if (resource.kind === "page" || resource.kind === "html") return rewriteHtml(text, resource);
  if (resource.kind === "css") return rewriteCss(text, resource);
  if (resource.kind === "js") return rewriteJavaScript(text, resource);
  if (resource.kind === "manifest") return rewriteManifest(text, resource);
  return text;
}

function rewriteHtml(html, resource) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
  const baseUrl = baseHref ? safeResolveUrl(baseHref, resource.url) || resource.url : resource.url;
  for (const base of doc.querySelectorAll("base")) base.remove();

  const attributes = ["href", "src", "poster", "data"];
  for (const node of doc.querySelectorAll("[href], [src], [poster], [data]")) {
    for (const attribute of attributes) {
      if (!node.hasAttribute(attribute)) continue;
      const raw = node.getAttribute(attribute);
      const rewritten = rewriteReference(raw, baseUrl, resource.localPath);
      if (rewritten) node.setAttribute(attribute, rewritten);
    }
  }

  for (const node of doc.querySelectorAll("[srcset]")) {
    const rewritten = parseSrcset(node.getAttribute("srcset")).map((candidate) => {
      const local = rewriteReference(candidate.url, baseUrl, resource.localPath) || candidate.url;
      return `${local}${candidate.descriptor ? ` ${candidate.descriptor}` : ""}`;
    }).join(", ");
    node.setAttribute("srcset", rewritten);
  }
  for (const node of doc.querySelectorAll("[style]")) node.setAttribute("style", rewriteCss(node.getAttribute("style") || "", { ...resource, url: baseUrl }));
  for (const node of doc.querySelectorAll("style")) node.textContent = rewriteCss(node.textContent || "", { ...resource, url: baseUrl });

  for (const node of doc.querySelectorAll("meta[http-equiv]")) {
    if ((node.getAttribute("http-equiv") || "").toLowerCase() !== "refresh") continue;
    const content = node.getAttribute("content") || "";
    node.setAttribute("content", content.replace(/(url\s*=\s*)(.+)$/i, (_, prefix, raw) => `${prefix}${rewriteReference(raw.trim().replace(/^['"]|['"]$/g, ""), baseUrl, resource.localPath) || raw}`));
  }

  doc.documentElement.setAttribute("data-sitefyer-source", resource.url);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function rewriteCss(css, resource) {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, quote, raw) => {
    const rewritten = rewriteReference(raw.trim(), resource.url, resource.localPath);
    return rewritten ? `url(${quote}${rewritten}${quote})` : full;
  }).replace(/(@import\s+(?:url\(\s*)?)(['"]?)([^'"\)\s;]+)(['"]?)(\s*\)?[^;]*;)/gi, (full, prefix, open, raw, close, suffix) => {
    const rewritten = rewriteReference(raw, resource.url, resource.localPath);
    return rewritten ? `${prefix}${open}${rewritten}${close}${suffix}` : full;
  });
}

function rewriteJavaScript(js, resource) {
  const replacements = [
    /(\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"])([^'"]+)(['"])/g,
    /(\bimport\(\s*['"])([^'"]+)(['"]\s*\))/g,
    /(new\s+URL\(\s*['"])([^'"]+)(['"]\s*,\s*import\.meta\.url\s*\))/g
  ];
  let result = js;
  for (const pattern of replacements) {
    result = result.replace(pattern, (full, before, raw, after) => {
      if (isBareModuleSpecifier(raw)) return full;
      const rewritten = rewriteReference(raw, resource.url, resource.localPath);
      return rewritten ? `${before}${rewritten}${after}` : full;
    });
  }
  return result;
}

function rewriteManifest(text, resource) {
  try {
    const manifest = JSON.parse(text);
    const rewrite = (value) => rewriteReference(value, resource.url, resource.localPath) || value;
    if (manifest.start_url) manifest.start_url = rewrite(manifest.start_url);
    for (const key of ["icons", "screenshots", "shortcuts"]) {
      if (!Array.isArray(manifest[key])) continue;
      for (const item of manifest[key]) {
        if (item?.src) item.src = rewrite(item.src);
        if (Array.isArray(item?.icons)) for (const icon of item.icons) if (icon?.src) icon.src = rewrite(icon.src);
      }
    }
    return JSON.stringify(manifest, null, 2);
  } catch {
    return text;
  }
}

function rewriteReference(raw, baseUrl, fromLocalPath) {
  if (!raw || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(raw.trim())) return null;
  const fragmentMatch = raw.match(/(#.*)$/);
  const fragment = fragmentMatch?.[1] || "";
  const target = safeNormalizeUrl(safeResolveUrl(raw, baseUrl));
  if (!target) return null;
  const resource = currentJob.resources[target];
  if (!resource || resource.status !== "cached") return null;
  return `${relativePosixPath(dirnamePosix(fromLocalPath), resource.localPath)}${fragment}`;
}

function buildCrawlManifest() {
  const resources = Object.values(currentJob.resources).map((resource) => ({
    sourceUrl: resource.url,
    localPath: resource.localPath,
    kind: resource.kind,
    status: resource.status,
    size: resource.size,
    contentType: resource.contentType,
    fetchedThrough: resource.route,
    source: resource.source,
    error: resource.error || undefined,
    skippedBecause: resource.skipReason || undefined
  }));
  return {
    generatedBy: `SiteFyer ${APP_VERSION}`,
    generatedAt: new Date().toISOString(),
    startUrl: currentJob.startUrl,
    scope: {
      sameWebsitePages: true,
      includeSubdomains: currentJob.options.includeSubdomains,
      includeExternalAssets: currentJob.options.includeExternalAssets,
      respectRobotsTxt: currentJob.options.respectRobots
    },
    totals: currentJob.totals,
    resources
  };
}

function buildOfflineReadme(manifest) {
  return [
    "SITEFYER OFFLINE MIRROR",
    "=======================",
    "",
    `Source: ${manifest.startUrl}`,
    `Generated: ${manifest.generatedAt}`,
    `Discovered files: ${manifest.totals.files}`,
    `Saved files: ${manifest.totals.cached}`,
    `Failed files: ${manifest.totals.failed}`,
    "",
    "Open the mirrored index.html in a browser. Some websites require a local web server",
    "because browsers restrict module scripts, routing and certain APIs when opened with file://.",
    "A simple local server can be started from this folder with a suitable development tool.",
    "",
    "See sitefyer-manifest.json for every source URL, local path and failure.",
    "Dynamic data, private backends and content created only after complex browser execution",
    "may not be present in this browser-only V1 mirror."
  ].join("\n");
}

function markResourceError(url, error) {
  const resource = currentJob.resources[url];
  if (!resource) return;
  resource.status = "failed";
  resource.error = error?.message || String(error);
}

function recalculateTotals() {
  if (!currentJob) return;
  const resources = Object.values(currentJob.resources);
  currentJob.totals = {
    files: resources.length,
    pages: resources.filter((resource) => resource.kind === "page").length,
    cached: resources.filter((resource) => resource.status === "cached").length,
    failed: resources.filter((resource) => resource.status === "failed").length,
    bytes: resources.reduce((total, resource) => total + (resource.status === "cached" ? Number(resource.size || 0) : 0), 0)
  };
}

function countPages() {
  return Object.values(currentJob.resources).filter((resource) => resource.kind === "page").length;
}

function renderStats() {
  if (!currentJob) return;
  recalculateTotals();
  const totals = currentJob.totals;
  ui.totalFilesStat.textContent = formatNumber(totals.files);
  ui.pagesStat.textContent = formatNumber(totals.pages);
  ui.downloadedStat.textContent = formatNumber(totals.cached);
  ui.remainingStat.textContent = formatNumber(Math.max(0, totals.files - totals.cached - Object.values(currentJob.resources).filter((resource) => resource.status === "skipped").length));
  ui.failedStat.textContent = formatNumber(totals.failed);
  ui.bytesStat.textContent = formatBytes(totals.bytes);

  if (currentJob.status === "scanning") {
    const inspected = Object.values(currentJob.resources).filter((resource) => resource.inspected || resource.status === "skipped").length;
    setProgress(totals.files ? Math.min(90, Math.round((inspected / totals.files) * 90)) : 0);
  } else if (currentJob.status === "countdown") {
    setProgress(100);
  } else if (currentJob.status === "downloading") {
    setProgress(totals.files ? Math.round(((totals.cached + totals.failed) / totals.files) * 100) : 0);
  }
}

function renderPhase() {
  if (!currentJob) return;
  ui.progressPanel.hidden = false;
  ui.completedPanel.hidden = true;
  ui.countdownCard.hidden = currentJob.status !== "countdown";
  const phases = {
    scanning: ["SCANNING", "Discovering the complete website", "Following internal links, sitemaps, CSS, JavaScript imports and referenced public assets.", "Working", ""],
    countdown: ["COUNT COMPLETE", "The website file count is ready", "SiteFyer will now download every discovered file and show the remaining countdown.", "Ready", "success"],
    downloading: ["DOWNLOADING", "Saving the complete public file set", "Each successful file is checkpointed in browser storage so interruption does not erase progress.", "Working", ""],
    paused: ["PAUSED", "Mirror paused", "Continue whenever you are ready. The saved checkpoint remains in this browser.", "Paused", ""],
    zipping: ["BUILDING ZIP", "Rewriting links and packaging the mirror", "Creating one portable ZIP with the mirrored site and crawl manifest.", "Compressing", ""],
    failed: ["NEEDS ATTENTION", "The mirror stopped", currentJob.lastError || "Review the activity log and resume when ready.", "Stopped", "danger"]
  };
  const [eyebrow, title, description, badge, tone] = phases[currentJob.status] || phases.scanning;
  ui.phaseEyebrow.textContent = eyebrow;
  ui.phaseTitle.textContent = title;
  ui.phaseDescription.textContent = description;
  ui.statusBadge.textContent = badge;
  ui.statusBadge.dataset.tone = tone;
  ui.pauseButton.hidden = !["scanning", "downloading", "zipping"].includes(currentJob.status);
  ui.continueButton.hidden = currentJob.status !== "paused";
  renderStats();
}

function renderCompleted(zipSize) {
  ui.progressPanel.hidden = true;
  ui.completedPanel.hidden = false;
  ui.completedSummary.textContent = `${formatNumber(currentJob.totals.cached)} files (${formatBytes(currentJob.totals.bytes)}) were packaged. ZIP size: ${formatBytes(zipSize)}. ${formatNumber(currentJob.totals.failed)} files failed and are listed in the manifest.`;
}

function resetPanelsForJob(clearLog = true) {
  ui.resumePanel.hidden = true;
  ui.progressPanel.hidden = false;
  ui.completedPanel.hidden = true;
  ui.scanButton.disabled = true;
  if (clearLog) ui.activityLog.innerHTML = "";
  renderPhase();
}

async function checkpoint() {
  if (!currentJob) return;
  recalculateTotals();
  await db.putJob(currentJob);
}

async function pauseJob() {
  if (!currentJob || !["scanning", "downloading", "zipping", "countdown"].includes(currentJob.status)) return;
  currentJob.resumeStatus = currentJob.status;
  currentJob.status = "paused";
  controllerState.manualPaused = true;
  if (currentJob.resumeStatus === "countdown") controllerState.running = false;
  if (controllerState.countdownTimer) {
    window.clearInterval(controllerState.countdownTimer);
    controllerState.countdownTimer = null;
  }
  await checkpoint();
  renderPhase();
  log("warn", "Mirror paused. The browser checkpoint is safe.");
}

async function continueJob() {
  if (!currentJob || currentJob.status !== "paused") return;
  currentJob.status = currentJob.resumeStatus || "downloading";
  currentJob.resumeStatus = null;
  controllerState.manualPaused = false;
  await checkpoint();
  renderPhase();
  log("info", "Mirror continued from checkpoint.");
  if (!controllerState.running) resumeJob(currentJob);
}

async function cancelJob() {
  if (!currentJob) return;
  if (!window.confirm("Cancel this mirror and remove its downloaded checkpoint files from this browser?")) return;
  controllerState.cancelled = true;
  controllerState.running = false;
  controllerState.manualPaused = false;
  if (controllerState.countdownTimer) window.clearInterval(controllerState.countdownTimer);
  const id = currentJob.id;
  await db.deleteJob(id);
  currentJob = null;
  ui.progressPanel.hidden = true;
  ui.completedPanel.hidden = true;
  ui.scanButton.disabled = false;
  log("warn", "Mirror cancelled and local checkpoint removed.");
}

async function failJob(error) {
  if (controllerState.cancelled || error?.name === "CancelledError") return;
  console.error(error);
  currentJob.status = "failed";
  currentJob.lastError = error?.message || String(error);
  controllerState.running = false;
  await checkpoint();
  renderPhase();
  ui.scanButton.disabled = false;
  log("error", currentJob.lastError);
}

async function waitIfPausedOrOffline({ ignoreOffline = false } = {}) {
  while (controllerState.manualPaused || (!ignoreOffline && !navigator.onLine)) {
    assertNotCancelled();
    await sleep(500);
  }
}

function waitForInternet() {
  if (navigator.onLine) return Promise.resolve();
  log("warn", "Internet interrupted. SiteFyer is waiting and will continue automatically.");
  return new Promise((resolve) => window.addEventListener("online", resolve, { once: true }));
}

function assertNotCancelled() {
  if (controllerState.cancelled) {
    const error = new Error("Mirror cancelled");
    error.name = "CancelledError";
    throw error;
  }
}

function isPageInScope(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === currentJob.hostname) return true;
    if (normalizeWww(host) === normalizeWww(currentJob.hostname)) return true;
    return currentJob.options.includeSubdomains && host.endsWith(`.${normalizeWww(currentJob.hostname)}`);
  } catch {
    return false;
  }
}

function isAllowedByRobots(rawUrl) {
  if (!currentJob.options.respectRobots || !currentJob.robots.rules.length) return true;
  const url = new URL(rawUrl);
  const path = `${url.pathname}${url.search}`;
  const matches = currentJob.robots.rules.filter((rule) => path.startsWith(rule.path));
  if (!matches.length) return true;
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0].allow;
}

function parseRobots(text) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
  let applies = false;
  const rules = [];
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") applies = value === "*";
    if (applies && (key === "allow" || key === "disallow") && value) rules.push({ allow: key === "allow", path: value });
  }
  return rules;
}

function extractRobotsSitemaps(text, baseUrl) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^sitemap\s*:/i.test(line)).map((line) => safeResolveUrl(line.replace(/^sitemap\s*:/i, "").trim(), baseUrl)).filter(Boolean);
}

function localPathFor(rawUrl, kind) {
  const url = new URL(rawUrl);
  const external = !isPageInScope(rawUrl);
  let pathname = safeDecodePath(url.pathname || "/");
  let segments = pathname.split("/").filter(Boolean).map(sanitizeSegment);
  const querySuffix = url.search ? `--q-${shortHash(url.search)}` : "";

  if (kind === "page" || kind === "html") {
    const last = segments.at(-1) || "";
    const extension = fileExtension(last);
    if (!last || pathname.endsWith("/") || !PAGE_EXTENSIONS.has(extension)) {
      segments.push("index.html");
    } else if (extension && !["html", "htm"].includes(extension)) {
      segments[segments.length - 1] = `${stripExtension(last)}.html`;
    } else if (!extension) {
      segments.push("index.html");
    }
  } else if (!segments.length || pathname.endsWith("/")) {
    segments.push(`asset-${shortHash(rawUrl)}${extensionForKind(kind)}`);
  } else if (!fileExtension(segments.at(-1))) {
    segments[segments.length - 1] += extensionForKind(kind) || `-${shortHash(rawUrl)}`;
  }

  if (querySuffix) {
    const last = segments.pop();
    const extension = fileExtension(last);
    segments.push(extension ? `${stripExtension(last)}${querySuffix}.${extension}` : `${last}${querySuffix}`);
  }

  const prefix = external ? ["_external", sanitizeSegment(url.hostname)] : [];
  return [...prefix, ...segments].join("/") || "index.html";
}

function classifyUrl(rawUrl) {
  const extension = fileExtension(new URL(rawUrl).pathname);
  if (PAGE_EXTENSIONS.has(extension)) return "asset";
  if (extension === "css") return "css";
  if (["js", "mjs", "cjs"].includes(extension)) return "js";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (FONT_EXTENSIONS.has(extension)) return "font";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (extension === "webmanifest" || extension === "manifest") return "manifest";
  if (extension === "xml") return "xml";
  if (extension === "json") return "json";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "asset";
}

function inferKind(rawUrl, preferred) {
  const classified = classifyUrl(rawUrl);
  if (classified !== "asset") return classified;
  const map = { style: "css", script: "js", font: "font", image: "image", video: "video", audio: "audio", document: "document", fetch: "asset" };
  return map[preferred] || preferred || "asset";
}

function kindFromContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("text/html")) return "page";
  if (value.includes("text/css")) return "css";
  if (value.includes("javascript") || value.includes("ecmascript")) return "js";
  if (value.includes("manifest+json")) return "manifest";
  if (value.includes("image/")) return "image";
  if (value.includes("font/") || value.includes("application/font")) return "font";
  if (value.includes("video/")) return "video";
  if (value.includes("audio/")) return "audio";
  if (value.includes("application/pdf")) return "document";
  if (value.includes("xml")) return "xml";
  if (value.includes("json")) return "json";
  if (value.startsWith("text/")) return "text";
  return null;
}

function reconcileKind(original, detected) {
  if (!detected) return original;
  if (original === "page") return "page";
  if (original === "manifest") return "manifest";
  if (original === "css" || original === "js") return original;
  return detected;
}

function isLikelyPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const extension = fileExtension(url.pathname);
    return PAGE_EXTENSIONS.has(extension) && !url.pathname.startsWith("/wp-json/");
  } catch {
    return false;
  }
}

function isDownloadableDocument(rawUrl) {
  try { return DOCUMENT_EXTENSIONS.has(fileExtension(new URL(rawUrl).pathname)); } catch { return false; }
}

function hasKnownAssetExtension(rawUrl) {
  try {
    const extension = fileExtension(new URL(rawUrl).pathname);
    return ["css", "js", "mjs", "webmanifest", ...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...DOCUMENT_EXTENSIONS].includes(extension);
  } catch { return false; }
}

function extensionForKind(kind) {
  return ({ css: ".css", js: ".js", image: ".img", font: ".font", video: ".video", audio: ".audio", manifest: ".webmanifest", xml: ".xml", json: ".json", text: ".txt", document: ".bin" })[kind] || "";
}

function parseSrcset(value) {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const pieces = part.split(/\s+/);
    return { url: pieces.shift(), descriptor: pieces.join(" ") };
  }).filter((candidate) => candidate.url && !candidate.url.startsWith("data:"));
}

function normalizeStartUrl(value) {
  let candidate = value.trim();
  if (!candidate) throw new Error("Enter a website URL.");
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  return normalizeUrl(candidate);
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.href;
}

function safeNormalizeUrl(value) {
  try { return value ? normalizeUrl(value) : null; } catch { return null; }
}

function resolveUrl(value, base) { return new URL(value, base).href; }
function safeResolveUrl(value, base) {
  if (!value || /^(?:data:|blob:|javascript:|mailto:|tel:|about:)/i.test(value.trim())) return null;
  try { return new URL(value, base).href; } catch { return null; }
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host === "0.0.0.0") return false;
    if (isPrivateIpLiteral(host)) return false;
    return true;
  } catch { return false; }
}

function assertPublicHttpUrl(value) {
  if (!isPublicHttpUrl(value)) throw new Error("Use a public HTTP or HTTPS website. Local, private-network and non-web addresses are blocked.");
}

function isPrivateIpLiteral(host) {
  if (host === "::1" || host.startsWith("fe80:")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isBareModuleSpecifier(value) {
  return !value.startsWith(".") && !value.startsWith("/") && !/^https?:\/\//i.test(value);
}

function isTextContentType(value) {
  const type = String(value || "").toLowerCase();
  return type.startsWith("text/") || type.includes("javascript") || type.includes("json") || type.includes("xml") || type.includes("manifest");
}

function fileExtension(pathname) {
  const last = String(pathname || "").split("/").pop() || "";
  const match = last.match(/\.([a-z0-9]{1,12})$/i);
  return match ? match[1].toLowerCase() : "";
}

function stripExtension(filename) { return filename.replace(/\.[^.]+$/, ""); }
function safeDecodePath(pathname) { try { return decodeURIComponent(pathname); } catch { return pathname; } }
function sanitizeSegment(value) {
  const cleaned = String(value || "").replace(/[<>:"\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^\.+$/, "dot").replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "unnamed").slice(0, 150);
}
function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function fileKey(jobId, url) { return `${jobId}|${url}`; }
function normalizeWww(host) { return host.replace(/^www\./, ""); }
function dedupe(values) { return [...new Set(values)]; }
function dedupeBy(values, selector) {
  const seen = new Set();
  return values.filter((value) => {
    const key = selector(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function buildProxyUrl(template, targetUrl) {
  if (template.includes("{url}")) return template.replaceAll("{url}", encodeURIComponent(targetUrl));
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
}
function dirnamePosix(path) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
function relativePosixPath(fromDir, toPath) {
  const from = fromDir.split("/").filter(Boolean);
  const to = toPath.split("/").filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => ".."), ...to].join("/") || "./";
}
function sleep(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function formatNumber(value) { return new Intl.NumberFormat().format(Number(value) || 0); }
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function setProgress(percent) { ui.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`; }
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function discoverSavedJob() {
  const jobs = await db.listJobs();
  recoveredJob = jobs.find((job) => !["completed", "cancelled"].includes(job.status)) || null;
  if (!recoveredJob) return;
  const totals = recoveredJob.totals || {};
  ui.resumePanel.hidden = false;
  ui.resumeDescription.textContent = `${recoveredJob.startUrl} — ${formatNumber(totals.cached || 0)} of ${formatNumber(totals.files || 0)} discovered files are already saved.`;
}

function updateNetworkUi() {
  const online = navigator.onLine;
  ui.networkPill.dataset.online = String(online);
  ui.networkText.textContent = online ? "Online" : "Offline — waiting";
  if (currentJob && controllerState.running) {
    if (!online) {
      ui.statusBadge.textContent = "Waiting for internet";
      ui.statusBadge.dataset.tone = "danger";
    } else renderPhase();
  }
}

async function initialise() {
  await db.open();
  await discoverSavedJob();
  updateNetworkUi();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

ui.mirrorForm.addEventListener("submit", startNewMirror);
ui.resumeSavedButton.addEventListener("click", () => recoveredJob && resumeJob(recoveredJob));
ui.discardSavedButton.addEventListener("click", async () => {
  if (!recoveredJob) return;
  await db.deleteJob(recoveredJob.id);
  recoveredJob = null;
  ui.resumePanel.hidden = true;
});
ui.pauseButton.addEventListener("click", pauseJob);
ui.continueButton.addEventListener("click", continueJob);
ui.cancelButton.addEventListener("click", cancelJob);
ui.downloadNowButton.addEventListener("click", () => {
  if (!currentJob || currentJob.status !== "countdown") return;
  currentJob.countdownEnd = Date.now();
});
ui.cancelCountdownButton.addEventListener("click", pauseJob);
ui.clearLogButton.addEventListener("click", () => { ui.activityLog.innerHTML = ""; });
ui.saveZipButton.addEventListener("click", async () => {
  if (controllerState.zipBlob) saveBlob(controllerState.zipBlob, controllerState.zipName);
  else if (currentJob?.status === "completed") {
    controllerState.running = true;
    try { await buildAndSaveZip(); } catch (error) { await failJob(error); }
  }
});
ui.newMirrorButton.addEventListener("click", async () => {
  if (currentJob) await db.deleteJob(currentJob.id);
  currentJob = null;
  controllerState = { running: false, manualPaused: false, cancelled: false, countdownTimer: null, zipBlob: null, zipName: null };
  ui.completedPanel.hidden = true;
  ui.progressPanel.hidden = true;
  ui.scanButton.disabled = false;
  ui.sourceUrl.focus();
});
window.addEventListener("online", () => { updateNetworkUi(); log("success", "Internet restored. SiteFyer is continuing automatically."); });
window.addEventListener("offline", updateNetworkUi);
window.addEventListener("beforeunload", (event) => {
  if (currentJob?.status === "zipping") {
    event.preventDefault();
    event.returnValue = "";
  }
});

initialise().catch((error) => {
  console.error(error);
  log("error", `SiteFyer could not open browser storage: ${error.message}`);
});
