/**
 * Stream Container Server
 *
 * This server manages a single browser instance with Puppeteer and monitors
 * active WebRTC connections to automatically shut down when no longer needed.
 *
 * Connection Monitoring Strategy:
 * - Chrome extension maintains window.activeConnections Set with connection IDs
 * - Container server polls this state every 15 seconds via page.evaluate()
 * - When connections drop to 0, starts 60-second grace period
 * - If no connections return within grace period, shuts down browser
 * - If new connections appear during grace period, cancels shutdown
 *
 * Browser Lifecycle:
 * - Browser launches on first /publisher/prepare request
 * - Stays alive as long as connections are active
 * - Automatically shuts down after grace period with no connections
 * - Can be manually restarted with new /publisher/prepare requests
 *
 * SFU Two-Phase Flow:
 * 1. POST /publisher/prepare — launches Chrome, navigates to URL, captures tab,
 *    calls INITIALIZE_PUBLISHER in extension, returns local SDP offer + tracks
 * 2. POST /publisher/answer — passes SFU answer to extension via
 *    APPLY_REMOTE_DESCRIPTION, completes WebRTC handshake
 * 3. GET /publisher/state — returns current publisher state for debugging
 */

import crypto from "node:crypto";
import http from "node:http";
import url from "node:url";
import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer";
import { ensureExtensionApis } from "./extension-page";
import {
  type IceServerConfig,
  type PublisherPrepareResponse,
  parsePublisherAnswerRequest,
  parsePublisherPrepareRequest,
  type SessionDescription,
  type TrackInfo,
} from "./protocol";
import { createStreamLifetime, isIdle } from "./stream-lifetime";
import { streamVariant } from "./stream-variant";

// TypeScript declaration for browser window extensions
declare global {
  interface Window {
    activeConnections?: Set<string>;
    streamingDebug?: {
      initializeCalled: boolean;
      addConnectionCalled: boolean;
      lastError: string | null;
      callCount: number;
      publisherState: string | null;
    };
    INITIALIZE_PUBLISHER?: (params: {
      iceServers?: IceServerConfig[];
      maxKbps?: number;
    }) => Promise<{
      sessionDescription: { type: string; sdp: string };
      tracks: Array<{ location: string; trackName: string }>;
      traceId: string;
    }>;
    APPLY_REMOTE_DESCRIPTION?: (params: {
      sessionDescription: { type: string; sdp: string };
    }) => Promise<void>;
    CLOSE_PUBLISHER?: () => Promise<void>;
  }
}

const EXTENSION_PATH = "./extension";
let EXTENSION_ID: string | null = null; // Dynamically detected at runtime

// Connection monitoring configuration
const GRACE_PERIOD_MS = 3600000; // 1 hour — SFU tracks subscribers server-side
const POLL_INTERVAL_MS = 15000; // 15 seconds

// Module-level state for persistent browser instance
let browser: Browser | undefined;
let activePage: Page | undefined;
let streamingPage: Page | undefined;
let connectionCheckInterval: NodeJS.Timeout | null = null;
let shutdownTimer: NodeJS.Timeout | null = null;

function logTrace(traceId: string, event: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`[trace:${traceId}] ${event}`, details);
    return;
  }
  console.log(`[trace:${traceId}] ${event}`);
}

function buildTraceHeaders(traceId?: string): HeadersInit | undefined {
  if (!traceId) return undefined;
  return {
    "x-stream-trace-id": traceId,
  };
}

/** Utility: Create JSON response */
function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-stream-trace-id",
      ...(init.headers || {}),
    },
    ...init,
  });
}

async function collectBrowserState(traceId: string) {
  const activePageState = activePage
    ? await activePage
        .evaluate(() => ({
          url: window.location.href,
          title: document.title,
          visibilityState: document.visibilityState,
          readyState: document.readyState,
          hasFocus: document.hasFocus(),
        }))
        .then(async (state) => ({
          ...state,
          render: await activePage
            ?.evaluate(
              `window.__renderStats ? { seconds: Math.round(performance.now() / 1000), frames: window.__renderStats.frames(), stalls: window.__renderStats.stalls } : null`,
            )
            .catch(() => null),
        }))
        .catch((error: Error) => ({ error: error.message }))
    : null;

  const extensionState = streamingPage
    ? await streamingPage
        .evaluate(() => ({
          location: window.location.href,
          hasInitializePublisher: typeof window.INITIALIZE_PUBLISHER === "function",
          hasApplyRemoteDescription: typeof window.APPLY_REMOTE_DESCRIPTION === "function",
          hasClosePublisher: typeof window.CLOSE_PUBLISHER === "function",
          activeConnections: window.activeConnections ? Array.from(window.activeConnections) : [],
          activeConnectionsSize: window.activeConnections ? window.activeConnections.size : 0,
          streamingDebug: window.streamingDebug || null,
        }))
        .catch((error: Error) => ({ error: error.message }))
    : null;

  const targetSummary = browser
    ? browser.targets().map((target) => ({
        type: target.type(),
        url: target.url(),
      }))
    : [];

  const snapshot = {
    browserActive: !!browser,
    activePageState,
    extensionState,
    targetSummary,
    monitoringActive: !!connectionCheckInterval,
    shutdownTimerActive: !!shutdownTimer,
    capturedAt: new Date().toISOString(),
  };

  logTrace(traceId, "browser_state_snapshot", snapshot as Record<string, unknown>);
  return snapshot;
}

/**
 * STREAM_GPU=egl|vulkan renders with the host GPU (Cloud Run NVIDIA L4). Use egl: on an L4 both render
 * at 60fps, but vulkan tab capture only delivers ~14fps while egl delivers the full 30. Unset falls back to
 * SwiftShader, since Chrome no longer picks software WebGL on its own and WebGL TVs (Rocket Crew) need it.
 */
function renderingFlags(): string[] {
  const gpu = process.env.STREAM_GPU;
  const common = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"];
  if (gpu === "vulkan")
    return [
      ...common,
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface",
    ];
  if (gpu === "egl") return [...common, "--use-gl=angle", "--use-angle=gl-egl"];
  return ["--disable-gpu", "--enable-unsafe-swiftshader"];
}

/** Which GL renderer Chrome actually got — proves the GPU path works without casting. */
async function handleGpuInfo(measureUrl: string | null): Promise<Response> {
  const browser = await puppeteer.launch({
    headless: "new" as any,
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...renderingFlags()],
  });
  try {
    const page = await browser.newPage();
    // ?url= also reports how fast that page animates here (requestAnimationFrame per second over 5s).
    let pageFps: number | null = null;
    if (measureUrl) {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(measureUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 8000));
      // A string, not a function: tsx injects __name helpers that don't exist in the page.
      pageFps = Number(
        await page.evaluate(`new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => { frames++; if (performance.now() - start < 5000) requestAnimationFrame(tick); else resolve(frames / 5); };
          requestAnimationFrame(tick);
        })`),
      );
    }
    await page.goto("data:text/html,<canvas id=c></canvas>");
    const info = await page.evaluate(() => {
      const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2");
      if (!gl) return { webgl2: false };
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        webgl2: true,
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      };
    });
    // Does Web Audio actually run here? (No audio device → the context never advances → silent streams.)
    const audio = await page.evaluate(`(async () => {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      await new Promise((r) => setTimeout(r, 1000));
      return { state: ctx.state, advancedSeconds: ctx.currentTime - t0, sampleRate: ctx.sampleRate };
    })()`);
    return new Response(
      JSON.stringify({ mode: process.env.STREAM_GPU ?? "swiftshader", ...info, pageFps, audio }),
      { headers: { "Content-Type": "application/json" } },
    );
  } finally {
    await browser.close();
  }
}

/**
 * The size the game page renders at: the stream's resolution (the extension captures 1280x720).
 * Rendering 1080p only to shrink it every frame cost capture rate (~26fps instead of 30).
 */
const [VIEW_W, VIEW_H] = (process.env.STREAM_VIEWPORT ?? "1280x720").split("x").map(Number);
const STREAM_VIEWPORT = { width: VIEW_W || 1280, height: VIEW_H || 720 };

/** Build Puppeteer launch options */
function buildLaunchOptions() {
  const absoluteExtensionPath = require("node:path").resolve(EXTENSION_PATH);

  return {
    headless: "new" as any, // Chrome 146 headless:new supports extensions and tab capture
    // Puppeteer adds --mute-audio by default, which makes the captured tab (and the TV stream) silent.
    ignoreDefaultArgs: ["--mute-audio"],
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...renderingFlags(),
      `--disable-extensions-except=${absoluteExtensionPath}`,
      `--load-extension=${absoluteExtensionPath}`,
      "--webrtc-udp-port-range=10000-10100",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-web-security", // Allow cross-origin requests for streaming
      "--remote-debugging-port=9222", // Enable remote debugging
      "--auto-accept-this-tab-capture",
      // Extension permission flags for headless mode
      "--enable-automation", // Enable automation extensions
      "--disable-extensions-file-access-check", // Allow file access for extensions
      "--allow-running-insecure-content", // Allow extensions to run in secure contexts
      "--disable-component-extensions-with-background-pages=false", // Enable component extensions
      "--enable-extension-activity-logging", // Better extension debugging
      "--allow-file-access-from-files", // Allow file access for extensions
      // Grant extension permissions automatically in headless
      "--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli", // Whitelist our extension by key from manifest.json
      // Container-optimized flags
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-default-apps",
      "--no-first-run",
    ],
    defaultViewport: STREAM_VIEWPORT,
  };
}

/** Launch browser, ensuring the extension is loaded */
async function launchBrowserWithExtension(): Promise<Browser> {
  // Just launch. (A diagnostics suite used to run here on every launch: filesystem searches, two
  // throwaway browsers and a fixed 3s sleep, ~19s before each stream; it's in git history if needed.
  // getExtensionStreamingPage waits for the extension's service worker, so no sleep is required.)
  const t0 = Date.now();
  const browserInstance = await puppeteer.launch(buildLaunchOptions());
  console.log(
    `Browser launched in ${Date.now() - t0}ms: ${await browserInstance.version().catch(() => "unknown")}`,
  );
  return browserInstance;
}

/**
 * The shared browser, launched once. Started at boot so a fresh instance has Chrome ready before
 * the first stream is requested; concurrent callers share the same launch.
 */
let browserLaunch: Promise<Browser> | null = null;
function ensureBrowser(): Promise<Browser> {
  if (browser) return Promise.resolve(browser);
  browserLaunch ??= launchBrowserWithExtension()
    .then((b) => {
      browser = b;
      return b;
    })
    .finally(() => {
      browserLaunch = null;
    });
  return browserLaunch;
}

/** Wait for the extension service worker and get streaming page */
async function getExtensionStreamingPage(browser: Browser, timeout = 15000): Promise<Page> {
  console.log("🔍 ========== EXTENSION SERVICE WORKER DETECTION ==========");
  console.log("🔍 Looking for extension service worker...");
  console.log("🔍 Timeout set to:", timeout, "ms");

  // Log all current targets before waiting
  const preTargets = browser.targets();
  console.log("🔍 Current targets before waiting:", preTargets.length);
  preTargets.forEach((target, index) => {
    console.log(`🔍 Pre-Target ${index}:`, {
      type: target.type(),
      url: target.url(),
      isServiceWorker: target.type() === "service_worker",
      isExtensionUrl: target.url().startsWith("chrome-extension://"),
      endsWithBackgroundJs: target.url().endsWith("background.js"),
    });
  });

  try {
    console.log("🔍 Starting waitForTarget for service worker...");

    // Wait for the service worker from our extension (MV3)
    const workerTarget = await browser.waitForTarget(
      (target) => {
        const isServiceWorker = target.type() === "service_worker";
        const endsWithBackgroundJs = target.url().endsWith("background.js");
        const isMatch = isServiceWorker && endsWithBackgroundJs;

        console.log(`🔍 Evaluating target: ${target.url()}`);
        console.log(`🔍   - Type: ${target.type()} (isServiceWorker: ${isServiceWorker})`);
        console.log(`🔍   - Ends with background.js: ${endsWithBackgroundJs}`);
        console.log(`🔍   - Match: ${isMatch}`);

        return isMatch;
      },
      { timeout },
    );

    console.log("✅ Found extension service worker:", workerTarget.url());

    // Try to get the worker
    let worker;
    try {
      worker = await workerTarget.worker();
      console.log("✅ Got worker object:", !!worker);
    } catch (workerError) {
      console.warn(
        "⚠️ Could not get worker object (this might be normal):",
        (workerError as Error).message,
      );
    }

    // Get the extension ID from the worker URL
    const urlMatch = workerTarget.url().match(/chrome-extension:\/\/([^/]+)/);
    const extensionId = urlMatch?.[1];

    console.log("🔍 URL match result:", urlMatch);
    console.log("🔍 Extracted extension ID:", extensionId);

    if (!extensionId) {
      throw new Error(`Could not extract extension ID from worker URL: ${workerTarget.url()}`);
    }

    console.log("✅ Detected extension ID:", extensionId);
    EXTENSION_ID = extensionId;

    // Wait for the streaming.html page to be created by background.js
    const streamingUrl = `chrome-extension://${extensionId}/streaming.html`;
    console.log("🔍 ========== STREAMING PAGE DETECTION ==========");
    console.log("🔍 Waiting for streaming page:", streamingUrl);
    console.log("🔍 Timeout set to:", timeout, "ms");

    // Log current targets before waiting for streaming page
    const preStreamingTargets = browser.targets();
    console.log(
      "🔍 Current targets before waiting for streaming page:",
      preStreamingTargets.length,
    );
    preStreamingTargets.forEach((target, index) => {
      console.log(`🔍 Pre-Streaming Target ${index}:`, {
        type: target.type(),
        url: target.url(),
        isPage: target.type() === "page",
        isStreamingUrl: target.url() === streamingUrl,
      });
    });

    const streamingTarget = await browser.waitForTarget(
      (target) => {
        const isPage = target.type() === "page";
        const isStreamingUrl = target.url() === streamingUrl;
        const isMatch = isPage && isStreamingUrl;

        console.log(`🔍 Evaluating streaming target: ${target.url()}`);
        console.log(`🔍   - Type: ${target.type()} (isPage: ${isPage})`);
        console.log(`🔍   - URL matches: ${isStreamingUrl}`);
        console.log(`🔍   - Match: ${isMatch}`);

        return isMatch;
      },
      { timeout },
    );

    console.log("✅ Found streaming page target:", streamingTarget.url());

    const page = await streamingTarget.page();
    if (!page) {
      throw new Error("Failed to get page from streaming target");
    }

    console.log("✅ Got streaming page object successfully");
    console.log("✅ Final streaming page URL:", page.url());

    return page;
  } catch (error) {
    console.error("❌ Failed to get extension streaming page:", error);

    // Enhanced debug: show all available targets at the time of failure
    console.log("🔍 ========== FAILURE DEBUG - ALL TARGETS ==========");
    const targets = browser.targets();
    console.log("🔍 Total targets at failure:", targets.length);
    targets.forEach((target, index) => {
      console.log(`🔍 Failure Target ${index}:`, {
        type: target.type(),
        url: target.url(),
        isServiceWorker: target.type() === "service_worker",
        isPage: target.type() === "page",
        isExtensionUrl: target.url().startsWith("chrome-extension://"),
        endsWithBackgroundJs: target.url().endsWith("background.js"),
        containsStreaming: target.url().includes("streaming"),
      });
    });

    throw error;
  }
}

/** Start monitoring active connections via Puppeteer polling */
async function startConnectionMonitoring() {
  if (!streamingPage) {
    console.warn("Cannot start connection monitoring: no active streaming page");
    return;
  }

  console.log("Starting connection monitoring...");

  connectionCheckInterval = setInterval(async () => {
    try {
      if (!streamingPage) {
        console.log("Streaming page no longer available, stopping monitoring");
        stopConnectionMonitoring();
        return;
      }

      const activeCount = await streamingPage.evaluate(() => {
        return window.activeConnections ? window.activeConnections.size : 0;
      });

      // Enhanced debugging - show what's actually in the set
      const activeConnectionsDebug = await streamingPage.evaluate(() => {
        if (!window.activeConnections) return { size: 0, connections: [] };
        return {
          size: window.activeConnections.size,
          connections: Array.from(window.activeConnections),
        };
      });

      // Check streaming debug info
      const streamingDebug = await streamingPage.evaluate(() => {
        return window.streamingDebug || { debug: "not available" };
      });

      // Get more detailed extension state
      const extensionState = await streamingPage.evaluate(() => {
        return {
          hasStreamingDebug: typeof window.streamingDebug !== "undefined",
          hasActiveConnections: typeof window.activeConnections !== "undefined",
          hasInitializePublisher: typeof window.INITIALIZE_PUBLISHER === "function",
          hasApplyRemoteDescription: typeof window.APPLY_REMOTE_DESCRIPTION === "function",
          hasClosePublisher: typeof window.CLOSE_PUBLISHER === "function",
          windowKeys: Object.keys(window).filter(
            (key) =>
              key.includes("streaming") ||
              key.includes("active") ||
              key.includes("INITIALIZE") ||
              key.includes("APPLY") ||
              key.includes("CLOSE"),
          ),
          location: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        };
      });

      console.log(`Active connections: ${activeCount}`);
      console.log(`Connection details:`, activeConnectionsDebug);
      console.log(`Streaming debug:`, streamingDebug);
      console.log(`Extension state:`, extensionState);

      if (activeCount === 0 && !shutdownTimer) {
        console.log(`No active connections, starting ${GRACE_PERIOD_MS}ms shutdown timer...`);
        shutdownTimer = setTimeout(() => {
          console.log("Grace period expired, shutting down browser...");
          shutdownBrowser();
        }, GRACE_PERIOD_MS);
      } else if (activeCount > 0 && shutdownTimer) {
        console.log("Active connections detected, cancelling shutdown timer");
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
    } catch (error) {
      console.error("Failed to check connection status:", error);
      // Continue monitoring even if one check fails
    }
  }, POLL_INTERVAL_MS);
}

/** Stop connection monitoring */
function stopConnectionMonitoring() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
    console.log("Connection monitoring stopped");
  }

  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
    console.log("Shutdown timer cancelled");
  }
}

/** Gracefully shutdown the browser and clean up resources */
async function shutdownBrowser() {
  console.log("Shutting down browser...");

  stopConnectionMonitoring();
  streamLifetime.stopped();

  if (browser) {
    try {
      await browser.close();
      console.log("Browser closed successfully");
    } catch (error) {
      console.error("Error closing browser:", error);
    }
    browser = undefined;
    activePage = undefined;
    streamingPage = undefined;
    EXTENSION_ID = null;
  }
}

/* ---------- Route Handlers ---------- */
async function handleHealth(): Promise<Response> {
  return jsonResponse({
    status: "healthy",
    puppeteer: "imported",
    location: process.env.CLOUDFLARE_LOCATION || "local",
    region: process.env.CLOUDFLARE_REGION || "dev",
    expectedExtensionId: EXTENSION_ID || "unknown",
    browserActive: !!browser,
    monitoringActive: !!connectionCheckInterval,
  });
}

const streamLifetime = createStreamLifetime({
  maxMs: Number(process.env.STREAM_MAX_MS ?? 3 * 60 * 60 * 1000),
});

const STREAM_IDLE_MS = Number(process.env.STREAM_IDLE_MS ?? 20 * 60 * 1000);

async function handlePing(): Promise<Response> {
  // A forgotten cast (TV left on): end it and refuse the heartbeat, so the pings stop and the GPU
  // scales to zero. Either it ran past its maximum lifetime, or the game reports no player activity.
  const activityAt = activePage
    ? await activePage.evaluate("window.__ogsActivityAt").catch(() => undefined)
    : undefined;
  const idle = isIdle(activityAt, Date.now(), STREAM_IDLE_MS);
  if (streamLifetime.expired() || idle) {
    console.log(
      idle
        ? "No player activity for too long; shutting down"
        : "Stream exceeded its maximum lifetime; shutting down",
    );
    await shutdownBrowser();
    return jsonResponse({ status: "expired", reason: idle ? "idle" : "lifetime" }, { status: 410 });
  }
  return jsonResponse({
    status: "pong",
    timestamp: Date.now(),
    browserActive: !!browser,
  });
}

async function handleTest(): Promise<Response> {
  let testBrowser: Browser | undefined;
  try {
    testBrowser = await launchBrowserWithExtension();
    const version = await testBrowser.version();

    // Get extension streaming page
    streamingPage = await getExtensionStreamingPage(testBrowser);

    await testBrowser.close();
    return jsonResponse({
      status: "success",
      browserVersion: version,
      extensionFound: true,
      extensionId: EXTENSION_ID,
    });
  } catch (err: any) {
    console.error("handleTest error:", err);
    if (testBrowser) await testBrowser.close();
    return jsonResponse({ status: "error", message: err.message }, { status: 500 });
  }
}

async function handleDebugState(traceId: string): Promise<Response> {
  const snapshot = await collectBrowserState(traceId);
  return jsonResponse(snapshot, {
    headers: buildTraceHeaders(traceId),
  });
}

async function handlePublisherPrepare(
  data: { url: string; iceServers: IceServerConfig[] },
  traceId: string,
): Promise<Response> {
  try {
    const { url: targetUrl, iceServers } = data;
    streamLifetime.started();

    logTrace(traceId, "publisher_prepare_request_received", {
      targetUrl,
      iceServerCount: Array.isArray(iceServers) ? iceServers.length : 0,
      browserReused: !!browser,
    });

    // Use existing browser or launch new one (possibly already launching since boot)
    if (!browser) {
      logTrace(traceId, "browser_launch_start");
      browser = await ensureBrowser();
      logTrace(traceId, "browser_launch_complete");
    } else {
      logTrace(traceId, "browser_reuse");
    }

    // Close pages from earlier streams. The browser is shared, and every open game tab keeps
    // rendering — stale tabs starve the CPU and could be captured instead of the new one.
    for (const old of await browser.pages()) {
      if (!old.url().startsWith("chrome-extension://")) {
        await old.close().catch(() => {});
      }
    }
    logTrace(traceId, "stale_pages_closed");

    // Create new page for this stream
    const page = await browser.newPage();
    activePage = page; // Set as active page for monitoring
    page.on("console", (msg) => {
      logTrace(traceId, `page_console_${msg.type()}`, { text: msg.text() });
    });
    page.on("pageerror", (error) => {
      logTrace(traceId, "page_error", { message: error.message });
    });

    // Record rendering stalls on the captured page (rAF gaps > 100ms), so a choppy TV can be traced
    // to the page itself (e.g. shader compiles) vs. the network. Read back in /debug-state.
    await page.evaluateOnNewDocument(`(() => {
      const stalls = []; let last = 0, frames = 0, lastLongTask = null;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) lastLongTask = { ms: Math.round(e.duration), at: Math.round(e.startTime / 100) / 10 };
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      window.__renderStats = { stalls, frames: () => frames };
      const tick = (t) => {
        frames++;
        if (last && t - last > 100) {
          const tv = document.querySelector('.tv');
          stalls.push({ at: Math.round(t / 100) / 10, ms: Math.round(t - last), phase: tv ? tv.className : null, longTask: lastLongTask });
          if (stalls.length > 50) stalls.shift();
        }
        last = t; requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);

    // Navigate to target URL
    logTrace(traceId, "page_navigation_start", { targetUrl });
    // Live games (WebSockets, animation) may never go idle; the DOM being ready is enough to start.
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    logTrace(traceId, "page_navigation_complete", {
      finalUrl: page.url(),
      title: await page.title().catch(() => "(unavailable)"),
    });

    // Render at the stream's resolution: capture then needs no downscale and copies half the pixels.
    const variant = streamVariant(targetUrl);
    await page.setViewport({ ...STREAM_VIEWPORT, deviceScaleFactor: variant.scale });
    logTrace(traceId, "page_viewport_set", { ...STREAM_VIEWPORT, ...variant });

    // Get extension streaming page and initialize streaming
    logTrace(traceId, "extension_page_wait_start");
    streamingPage = await getExtensionStreamingPage(browser, 30000);
    logTrace(traceId, "extension_page_ready", { extensionId: EXTENSION_ID });

    // Trigger a user-gesture-like command to satisfy activeTab requirements
    try {
      // Capture the page we just opened (not whichever https page happens to be first).
      const targetPage = page;
      if (targetPage) {
        await targetPage.keyboard.down("Alt");
        await targetPage.keyboard.down("Shift");
        await targetPage.keyboard.press("KeyS");
        await targetPage.keyboard.up("Shift");
        await targetPage.keyboard.up("Alt");
        logTrace(traceId, "capture_shortcut_sent");
      }
    } catch (e) {
      logTrace(traceId, "capture_shortcut_failed", { message: (e as Error).message });
    }

    // Set up console log monitoring for the extension page
    streamingPage.on("console", (msg) => {
      logTrace(traceId, `extension_console_${msg.type()}`, { text: msg.text() });
    });

    streamingPage.on("pageerror", (error) => {
      logTrace(traceId, "extension_page_error", { message: error.message });
    });

    // Test if we can execute code in the extension context
    console.log("Testing extension context execution...");
    try {
      const testResult = await streamingPage.evaluate(() => {
        console.log("[TEST] This is a test log from extension context");
        return {
          location: window.location.href,
          hasWindow: typeof window !== "undefined",
          hasChrome: typeof (globalThis as Record<string, unknown>).chrome !== "undefined",
          hasTabCapture:
            typeof (globalThis as Record<string, unknown>).chrome !== "undefined" &&
            typeof ((globalThis as Record<string, unknown>).chrome as Record<string, unknown>)
              ?.tabCapture !== "undefined",
          windowKeys: Object.keys(window).filter(
            (key) =>
              key.includes("streaming") ||
              key.includes("active") ||
              key.includes("INITIALIZE") ||
              key.includes("APPLY") ||
              key.includes("CLOSE"),
          ),
        };
      });
      logTrace(traceId, "extension_context_test", testResult as Record<string, unknown>);
    } catch (error) {
      logTrace(traceId, "extension_context_test_failed", { message: (error as Error).message });
    }

    // Ensure INITIALIZE_PUBLISHER function is loaded
    // Its script and its extension APIs (a relaunched Chrome sometimes loads it without the APIs).
    const reloads = await ensureExtensionApis(streamingPage);
    logTrace(traceId, "extension_initialize_publisher_detected", { reloads });

    // Force a simple log to test console monitoring
    logTrace(traceId, "extension_console_probe_start");
    await streamingPage.evaluate(() => {
      console.log("[FORCED-TEST] This should appear in container logs if console monitoring works");
      console.error("[FORCED-ERROR] This is a test error");
      console.warn("[FORCED-WARN] This is a test warning");
    });

    logTrace(traceId, "extension_console_probe_complete");

    const publisherParams = {
      iceServers: Array.isArray(iceServers) ? iceServers : [],
      maxKbps: variant.maxKbps,
    };

    // Initialize publisher in extension page — creates RTCPeerConnection, captures tab, returns local SDP offer
    logTrace(traceId, "extension_initialize_publisher_start", {
      iceServerCount: publisherParams.iceServers.length,
      extensionUrl: streamingPage.url(),
    });

    let publisherResult: PublisherPrepareResponse;
    try {
      const result = await Promise.race([
        streamingPage.evaluate(async (p: { iceServers: IceServerConfig[]; maxKbps: number }) => {
          console.log("[PUPPETEER] INITIALIZE_PUBLISHER call starting with params:", p);
          const initFn = window.INITIALIZE_PUBLISHER;
          if (!initFn) throw new Error("INITIALIZE_PUBLISHER not found on window");
          const r = await initFn(p);
          console.log("[PUPPETEER] INITIALIZE_PUBLISHER call completed, result:", r);
          return r;
        }, publisherParams),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("INITIALIZE_PUBLISHER timeout")), 30000),
        ),
      ]);

      publisherResult = result as PublisherPrepareResponse;
      logTrace(traceId, "extension_initialize_publisher_complete", {
        trackCount: publisherResult.tracks.length,
        traceId: publisherResult.traceId,
      });

      // Check the state immediately after INITIALIZE_PUBLISHER
      const postInitState = await streamingPage.evaluate(() => {
        return {
          activeConnections: window.activeConnections ? Array.from(window.activeConnections) : null,
          activeConnectionsSize: window.activeConnections ? window.activeConnections.size : 0,
          streamingDebug: window.streamingDebug || null,
          hasInitializePublisher: typeof window.INITIALIZE_PUBLISHER === "function",
        };
      });

      logTrace(
        traceId,
        "post_initialize_publisher_state",
        postInitState as Record<string, unknown>,
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await collectBrowserState(traceId);
    } catch (error) {
      logTrace(traceId, "extension_initialize_publisher_failed", {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    }

    // Keep the game tab painting. The extension's streaming page can end up in front, and Chrome
    // stops rendering background tabs — the captured video then freezes on the last frame while the
    // game carries on. Bring the game to the front and have it behave as focused and active.
    try {
      await page.bringToFront();
      const cdp = await page.createCDPSession();
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
      logTrace(traceId, "game_page_foregrounded", {
        visibility: await page.evaluate(() => document.visibilityState),
      });
    } catch (e) {
      logTrace(traceId, "game_page_foreground_failed", { message: (e as Error).message });
    }

    // Start connection monitoring if not already running
    if (!connectionCheckInterval) {
      startConnectionMonitoring();
    }

    logTrace(traceId, "publisher_prepare_response_sent", {
      trackCount: publisherResult.tracks.length,
      monitoringActive: !!connectionCheckInterval,
    });
    return jsonResponse(
      {
        sessionDescription: publisherResult.sessionDescription,
        tracks: publisherResult.tracks,
        traceId: publisherResult.traceId,
      },
      {
        headers: buildTraceHeaders(traceId),
      },
    );
  } catch (err: unknown) {
    const error = err as Error;
    logTrace(traceId, "publisher_prepare_error", {
      message: error.message,
      stack: error.stack,
    });
    return jsonResponse(
      { status: "error", message: error.message, traceId },
      { status: 500, headers: buildTraceHeaders(traceId) },
    );
  }
}

async function handlePublisherAnswer(
  data: { sessionDescription: SessionDescription },
  traceId: string,
): Promise<Response> {
  try {
    const { sessionDescription } = data;

    logTrace(traceId, "publisher_answer_request_received", {
      sdpType: sessionDescription.type,
    });

    if (!streamingPage) {
      return jsonResponse(
        { error: "No active publisher session — call /publisher/prepare first", traceId },
        { status: 400, headers: buildTraceHeaders(traceId) },
      );
    }

    logTrace(traceId, "extension_apply_remote_description_start");

    await Promise.race([
      streamingPage.evaluate(
        async (desc: { sessionDescription: { type: string; sdp: string } }) => {
          console.log("[PUPPETEER] APPLY_REMOTE_DESCRIPTION call starting");
          const applyFn = window.APPLY_REMOTE_DESCRIPTION;
          if (!applyFn) throw new Error("APPLY_REMOTE_DESCRIPTION not found on window");
          await applyFn(desc);
          console.log("[PUPPETEER] APPLY_REMOTE_DESCRIPTION call completed");
        },
        { sessionDescription },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("APPLY_REMOTE_DESCRIPTION timeout")), 30000),
      ),
    ]);

    logTrace(traceId, "extension_apply_remote_description_complete");

    return jsonResponse({ status: "success", traceId }, { headers: buildTraceHeaders(traceId) });
  } catch (err: unknown) {
    const error = err as Error;
    logTrace(traceId, "publisher_answer_error", {
      message: error.message,
      stack: error.stack,
    });
    return jsonResponse(
      { status: "error", message: error.message, traceId },
      { status: 500, headers: buildTraceHeaders(traceId) },
    );
  }
}

async function handlePublisherState(traceId: string): Promise<Response> {
  const publisherState = streamingPage
    ? await streamingPage
        .evaluate(() => {
          return {
            hasInitializePublisher: typeof window.INITIALIZE_PUBLISHER === "function",
            hasApplyRemoteDescription: typeof window.APPLY_REMOTE_DESCRIPTION === "function",
            hasClosePublisher: typeof window.CLOSE_PUBLISHER === "function",
            activeConnections: window.activeConnections ? Array.from(window.activeConnections) : [],
            activeConnectionsSize: window.activeConnections ? window.activeConnections.size : 0,
            streamingDebug: window.streamingDebug || null,
          };
        })
        .catch((error: Error) => ({ error: error.message }))
    : null;

  return jsonResponse(
    {
      browserActive: !!browser,
      extensionId: EXTENSION_ID,
      publisherState,
      monitoringActive: !!connectionCheckInterval,
      shutdownTimerActive: !!shutdownTimer,
      traceId,
    },
    { headers: buildTraceHeaders(traceId) },
  );
}

/* ---------- Node.js HTTP Server ---------- */
const server = http.createServer(async (req: any, res: any) => {
  const parsedUrl = url.parse(req.url || "", true);
  const { pathname } = parsedUrl;
  const traceId = req.headers["x-stream-trace-id"] || crypto.randomUUID();

  try {
    logTrace(traceId, "http_request_received", {
      method: req.method,
      pathname,
    });
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-stream-trace-id");
    res.setHeader("x-stream-trace-id", traceId);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    let response: Response;

    if (pathname === "/health") {
      response = await handleHealth();
    } else if (pathname === "/ping") {
      response = await handlePing();
    } else if (pathname === "/gpu-info") {
      response = await handleGpuInfo(new URL(req.url ?? "/", "http://x").searchParams.get("url"));
    } else if (pathname === "/test-puppeteer") {
      response = await handleTest();
    } else if (pathname === "/debug-state") {
      response = await handleDebugState(traceId);
    } else if (pathname === "/publisher/prepare" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk.toString();
      });

      await new Promise((resolve) => {
        req.on("end", resolve);
      });

      const data = parsePublisherPrepareRequest(JSON.parse(body));
      response = await handlePublisherPrepare(data, traceId);
    } else if (pathname === "/publisher/answer" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk.toString();
      });

      await new Promise((resolve) => {
        req.on("end", resolve);
      });

      const data = parsePublisherAnswerRequest(JSON.parse(body));
      response = await handlePublisherAnswer(data, traceId);
    } else if (pathname === "/publisher/state" && req.method === "GET") {
      response = await handlePublisherState(traceId);
    } else {
      response = new Response(`Not Found: ${req.method} ${req.url} (parsed path: ${pathname})`, {
        status: 404,
      });
    }

    // Convert Response object to Node.js response
    res.writeHead(response.status || 200, {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      ...Object.fromEntries(response.headers.entries()),
    });

    const responseText = await response.text();
    res.end(responseText);
  } catch (err: any) {
    if (err instanceof SyntaxError || err?.message?.includes("must be")) {
      res.writeHead(400, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-stream-trace-id",
        "x-stream-trace-id": req.headers["x-stream-trace-id"] || "",
      });
      res.end(JSON.stringify({ status: "error", message: err.message }));
      return;
    }

    console.error("Unhandled error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

const PORT = parseInt(process.env.PORT || "8080", 10);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Container server running at http://0.0.0.0:${PORT}`);
  // Warm Chrome now, so the first stream on a fresh instance doesn't wait for it.
  ensureBrowser().catch((error) => console.error("Browser prelaunch failed:", error));
});

// Graceful shutdown on process termination
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  await shutdownBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down gracefully...");
  await shutdownBrowser();
  process.exit(0);
});
