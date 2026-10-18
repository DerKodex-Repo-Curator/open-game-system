(() => {
  try {
    // Lightweight marker to indicate the content script ran
    window.__videoCaptureExtensionActive = true;
    // Optionally, expose a no-op to help debugging
    // eslint-disable-next-line no-console
    console.log("[CONTENT] Video Capture extension content script injected");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[CONTENT] Injection error:", e && e.message);
  }
})();
