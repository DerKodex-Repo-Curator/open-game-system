/**
 * Chrome Extension Background Script
 *
 * This background script runs when the extension loads and creates a tab
 * that loads our streaming interface. This tab becomes the target that
 * Puppeteer will interact with to initiate screen streaming.
 *
 * FLOW:
 * 1. Extension loads → background.js runs
 * 2. Creates hidden tab with streaming.html
 * 3. streaming.html loads PeerJS and streaming.js
 * 4. Puppeteer calls INITIALIZE() function in streaming.js context
 * 5. Screen capture and streaming begins
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("streaming.html"), active: false });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("streaming.html"), active: false });
});

chrome.commands.onCommand.addListener(async (command) => {
  console.log("[BACKGROUND] Command received:", command);
  if (command === "start-capture") {
    // Focus the target tab (current active in current window)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log("[BACKGROUND] Active tab for capture:", tab && { id: tab.id, url: tab.url });
      if (tab && tab.id) {
        // Send a message to the streaming page to start capture immediately
        // Broadcast to all extension contexts; streaming.html listens on runtime.onMessage
        chrome.runtime.sendMessage({ type: "START_CAPTURE", targetTabId: tab.id });
        console.log("[BACKGROUND] START_CAPTURE runtime message sent");
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[BACKGROUND] start-capture error:", e && e.message);
    }
  }
});
