/**
 * Chrome Extension Streaming Handler (streaming.js)
 *
 * FILE STRUCTURE:
 * - background.js: Creates hidden tab with streaming.html when extension loads
 * - streaming.html: Loads this streaming.js file
 * - streaming.js: Contains INITIALIZE_PUBLISHER(), APPLY_REMOTE_DESCRIPTION(),
 *   CLOSE_PUBLISHER() functions and connection tracking logic
 *
 * HOW THE SYSTEM WORKS:
 *
 * 1. CONTAINER STARTUP:
 *    - Container server starts Puppeteer browser with this Chrome extension
 *    - background.js creates a hidden tab loading streaming.html
 *    - streaming.html loads this streaming.js file
 *
 * 2. PUPPETEER INTEGRATION:
 *    - Container server calls page.evaluate() to execute INITIALIZE_PUBLISHER()
 *    - This function captures the current tab's video/audio stream
 *    - Creates RTCPeerConnection, adds tracks, creates local SDP offer
 *    - Returns { sessionDescription, tracks, traceId } for the SFU
 *
 * 3. SFU NEGOTIATION:
 *    - Container server sends the local offer to CF Realtime SFU
 *    - SFU returns an answer SDP
 *    - Container server calls APPLY_REMOTE_DESCRIPTION(answer) to complete handshake
 *
 * 4. CONNECTION TRACKING SYSTEM:
 *    - window.activeConnections tracks active publisher connections
 *    - Tracks RTCPeerConnection.connectionState changes
 *    - Container server polls this state every 15 seconds via page.evaluate()
 *    - When connections drop to 0, starts 60-second shutdown timer
 *
 * 5. LIFECYCLE MANAGEMENT:
 *    - Browser stays alive as long as streams are active
 *    - CLOSE_PUBLISHER() cleans up RTCPeerConnection and capture stream
 *    - Automatically shuts down when unused (resource efficient)
 *
 * ARCHITECTURE FLOW:
 * Stream Request → Container Server → Puppeteer → Chrome Extension → RTCPeerConnection → CF Realtime SFU
 *                              ↘ Connection Monitoring ↙
 *                           (Polls window.activeConnections)
 *
 * IMPORTANT NOTES:
 * - This runs in the Chrome extension context (isolated from normal web pages)
 * - Has special permissions for tab capture (see manifest.json)
 * - Functions must be globally accessible for Puppeteer's page.evaluate()
 * - Connection tracking is critical for automatic resource management
 * - APP_SECRET is NEVER exposed here — all SFU API calls happen server-side
 */

// Initialize connection tracking for container server monitoring
// The container server polls this Set to determine when to shut down
console.log("[INIT] Initializing window.activeConnections Set");
window.activeConnections = new Set();

// Debug tracking that container server can read
console.log("[INIT] Initializing window.streamingDebug object");
window.streamingDebug = {
  initializeCalled: false,
  addConnectionCalled: false,
  lastError: null,
  callCount: 0,
  scriptLoadTime: new Date().toISOString(),
  chromeTabCaptureAvailable:
    typeof chrome !== "undefined" && typeof chrome.tabCapture !== "undefined",
  captureDiagnostics: null,
  testVideoDiagnostics: null,
  publisherState: null,
  eventLog: [],
};

function recordDebugEvent(event, details = {}) {
  const entry = {
    event,
    details,
    timestamp: new Date().toISOString(),
  };
  window.streamingDebug.eventLog.push(entry);
  if (window.streamingDebug.eventLog.length > 40) {
    window.streamingDebug.eventLog.shift();
  }
}

console.log("[INIT] streaming.js loaded successfully");
console.log("[INIT] Chrome tabCapture available:", window.streamingDebug.chromeTabCaptureAvailable);
console.log("[INIT] Initial activeConnections size:", window.activeConnections.size);

// Module-level state for the publisher RTCPeerConnection
let publisherPc = null;
let publisherTraceId = null;

/**
 * Add a connection to the tracking set
 * Container server monitors window.activeConnections.size via page.evaluate()
 */
function addConnection(connectionId) {
  console.log(`[CONNECTION] Adding connection: ${connectionId}`);
  window.activeConnections.add(connectionId);
  console.log(`[CONNECTION] Active connections: ${window.activeConnections.size}`);
  window.streamingDebug.addConnectionCalled = true;
  recordDebugEvent("connection_added", { connectionId, size: window.activeConnections.size });
}

/**
 * Remove a connection from tracking set
 * When this reaches 0, container server starts shutdown grace period
 */
function removeConnection(connectionId) {
  console.log(`[CONNECTION] Removing connection: ${connectionId}`);
  const wasPresent = window.activeConnections.has(connectionId);
  window.activeConnections.delete(connectionId);
  console.log(
    `[CONNECTION] Was present: ${wasPresent}, Active connections: ${window.activeConnections.size}`,
  );
  recordDebugEvent("connection_removed", {
    connectionId,
    wasPresent,
    size: window.activeConnections.size,
  });
}

/**
 * INITIALIZE_PUBLISHER gets called within the context of the chrome extension
 * by puppeteer calling evaluate on the extension's background page (streaming.html)
 *
 * Captures the active puppeteer tab into a media stream, creates an
 * RTCPeerConnection, adds tracks with fixed names, and creates a local SDP offer.
 *
 * @param {Object} params - Parameters from container server
 * @param {Array} params.iceServers - ICE server configurations for TURN/STUN
 * @returns {{ sessionDescription: { type: string, sdp: string }, tracks: Array<{ location: string, trackName: string }>, traceId: string }}
 */
async function INITIALIZE_PUBLISHER({ iceServers = [], maxKbps = 4000 }) {
  const traceId = crypto.randomUUID();
  publisherTraceId = traceId;

  console.log(`[INITIALIZE_PUBLISHER] ========== STARTING INITIALIZATION ==========`);
  console.log(`[INITIALIZE_PUBLISHER] traceId: ${traceId}`);
  console.log(
    `[INITIALIZE_PUBLISHER] iceServers count: ${Array.isArray(iceServers) ? iceServers.length : 0}`,
  );

  // Mark that INITIALIZE_PUBLISHER was called
  window.streamingDebug.initializeCalled = true;
  window.streamingDebug.callCount++;
  window.streamingDebug.lastError = null;
  window.streamingDebug.captureDiagnostics = null;
  window.streamingDebug.testVideoDiagnostics = null;
  recordDebugEvent("initialize_publisher_called", {
    traceId,
    iceServerCount: Array.isArray(iceServers) ? iceServers.length : 0,
  });

  try {
    // First, find and activate the target tab to satisfy activeTab permission
    console.log(`[TAB_ACTIVATION] Finding target tab to activate extension...`);

    const tabs = await new Promise((resolve, reject) => {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
          console.error(`[TAB_ACTIVATION] Failed to query tabs:`, chrome.runtime.lastError);
          reject(new Error(`Failed to query tabs: ${chrome.runtime.lastError.message}`));
          return;
        }
        console.log(`[TAB_ACTIVATION] Found ${tabs.length} tabs`);
        tabs.forEach((tab, index) => {
          console.log(
            `[TAB_ACTIVATION] Tab ${index}: ${tab.url} (active: ${tab.active}, id: ${tab.id})`,
          );
        });
        resolve(tabs);
      });
    });

    // Find the active tab (the one Puppeteer is controlling)
    const activeTab =
      tabs.find((tab) => tab.active) ||
      tabs.find((tab) => !tab.url.startsWith("chrome-extension://"));

    if (!activeTab) {
      throw new Error("No suitable target tab found for capture");
    }

    console.log(`[TAB_ACTIVATION] Selected target tab: ${activeTab.url} (id: ${activeTab.id})`);

    // Programmatically activate the extension for this tab by injecting a small script
    // This satisfies the activeTab permission requirement
    console.log(`[TAB_ACTIVATION] Activating extension for tab ${activeTab.id}...`);

    try {
      await new Promise((resolve, _reject) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: () => {
              // This script injection activates the extension for this tab
              console.log("[TAB_INJECTION] Extension activated for this tab");
              return true;
            },
          },
          (_results) => {
            if (chrome.runtime.lastError) {
              console.warn(
                `[TAB_ACTIVATION] Script injection failed (may be normal for some pages):`,
                chrome.runtime.lastError.message,
              );
              resolve();
            } else {
              console.log(`[TAB_ACTIVATION] Successfully activated extension for tab`);
              resolve();
            }
          },
        );
      });
    } catch (activationError) {
      console.warn(
        `[TAB_ACTIVATION] Extension activation failed, proceeding anyway:`,
        activationError.message,
      );
    }

    // Now attempt tab capture
    console.log(`[TAB_CAPTURE] Starting tab capture for tab ${activeTab.id}...`);

    // Preflight: stop any previous capture to avoid "Cannot capture a tab with an active stream"
    try {
      if (window.currentCaptureStream) {
        console.log("[TAB_CAPTURE] Found previous capture stream, stopping it...");
        window.currentCaptureStream.getTracks().forEach((t) => t.stop());
        window.currentCaptureStream = null;
      }
    } catch (e) {
      console.warn("[TAB_CAPTURE] Preflight stop error:", e?.message);
    }

    let stream;

    // Wait until no active capture is registered for this tab
    async function waitForNoActiveCapture(tabId, maxTries = 20, delayMs = 100) {
      for (let i = 0; i < maxTries; i++) {
        const { anyActive } = await new Promise((res) => {
          chrome.tabCapture.getCapturedTabs((tabs) => {
            try {
              const list = (tabs || []).map((t) => ({
                tabId: t.tabId,
                status: t.status,
                fullscreen: t.fullscreen,
              }));
              const active = list.some((t) => t.status === "active" && t.tabId === tabId);
              console.log("[TAB_CAPTURE] Poll", i + 1, "/", maxTries, "captured tabs:", list);
              res({ anyActive: active });
            } catch (e) {
              console.warn("[TAB_CAPTURE] getCapturedTabs inspect error:", e?.message);
              res({ anyActive: false });
            }
          });
        });
        if (!anyActive) return;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      console.warn("[TAB_CAPTURE] Still active after wait; proceeding anyway");
    }

    await waitForNoActiveCapture(activeTab.id);

    // First try standard tabCapture.capture
    try {
      console.log("[TAB_CAPTURE] Attempting tabCapture.capture on active tab...");

      stream = await new Promise((resolve, reject) => {
        chrome.tabCapture.capture(
          {
            video: true,
            audio: true,
            videoConstraints: {
              mandatory: {
                minWidth: 1280,
                minHeight: 720,
                maxWidth: 1280,
                maxHeight: 720,
                maxFrameRate: 30,
              },
            },
          },
          (capturedStream) => {
            if (capturedStream) {
              console.log(`[TAB_CAPTURE] capture() returned a stream`);
              console.log(`[TAB_CAPTURE] Stream details:`, {
                id: capturedStream.id,
                active: capturedStream.active,
                tracks: capturedStream.getTracks().length,
                videoTracks: capturedStream.getVideoTracks().length,
                audioTracks: capturedStream.getAudioTracks().length,
              });
              resolve(capturedStream);
            } else {
              const error = chrome.runtime.lastError;
              console.warn(`[TAB_CAPTURE] capture() failed:`, error?.message);
              reject(new Error(error ? error.message : "Unknown capture error"));
            }
          },
        );
      });
    } catch (capErr) {
      console.warn(
        `[TAB_CAPTURE] capture() failed, falling back to getMediaStreamId + getUserMedia:`,
        capErr.message,
      );

      // Fallback: getMediaStreamId + getUserMedia with Chrome-specific constraints
      const streamId = await new Promise((resolve, reject) => {
        try {
          const opts = { targetTabId: activeTab.id };
          console.log(`[TAB_CAPTURE] Requesting media stream id for tab ${activeTab.id}...`);
          chrome.tabCapture.getMediaStreamId(opts, (id) => {
            if (chrome.runtime.lastError || !id) {
              const err1 = chrome.runtime.lastError?.message;
              console.warn(`[TAB_CAPTURE] getMediaStreamId with targetTabId failed:`, err1);
              chrome.tabCapture.getMediaStreamId((id2) => {
                if (chrome.runtime.lastError || !id2) {
                  const err2 = chrome.runtime.lastError?.message;
                  reject(new Error(err2 || "Failed to obtain mediaStreamId"));
                } else {
                  resolve(id2);
                }
              });
            } else {
              resolve(id);
            }
          });
        } catch (e) {
          reject(e);
        }
      });

      console.log(`[TAB_CAPTURE] Obtained mediaStreamId: ${streamId}`);

      try {
        // @ts-expect-error chrome-specific constraints
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
              maxWidth: 1280,
              maxHeight: 720,
              maxFrameRate: 30,
            },
          },
        });
        console.log(`[TAB_CAPTURE] getUserMedia returned a stream`);
      } catch (gumErr) {
        console.error(`[TAB_CAPTURE] getUserMedia with tab source failed:`, gumErr);
        throw new Error(`Failed to capture the tab: ${gumErr.message}`);
      }
    }

    // At this point we have a valid stream
    console.log(`[TAB_CAPTURE] Stream has ${stream.getTracks().length} tracks`);

    // Enhanced stream debugging
    stream.getTracks().forEach((track, index) => {
      console.log(`[TAB_CAPTURE] Track ${index}:`, {
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted,
        settings: track.getSettings ? track.getSettings() : "N/A",
      });
    });
    window.streamingDebug.captureDiagnostics = {
      streamId: stream.id,
      active: stream.active,
      trackCount: stream.getTracks().length,
      videoTrackCount: stream.getVideoTracks().length,
      audioTrackCount: stream.getAudioTracks().length,
      tracks: stream.getTracks().map((track) => ({
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted,
        settings: track.getSettings ? track.getSettings() : null,
      })),
    };
    recordDebugEvent("capture_stream_created", window.streamingDebug.captureDiagnostics);

    // Test if the stream is actually producing data
    if (stream.getVideoTracks().length > 0) {
      const videoTrack = stream.getVideoTracks()[0];
      const videoSettings = videoTrack.getSettings();

      console.log("[TAB_CAPTURE] Video track details:", {
        width: videoSettings.width,
        height: videoSettings.height,
        frameRate: videoSettings.frameRate,
        allSettings: videoSettings,
      });

      if (videoSettings.width === 0 || videoSettings.height === 0) {
        console.error("[TAB_CAPTURE] Video track has zero dimensions - capture likely failed!");
      }
      window.streamingDebug.captureDiagnostics = {
        ...window.streamingDebug.captureDiagnostics,
        videoTrackDetails: {
          width: videoSettings.width || 0,
          height: videoSettings.height || 0,
          frameRate: videoSettings.frameRate || null,
          zeroDimensions: videoSettings.width === 0 || videoSettings.height === 0,
        },
      };
      recordDebugEvent(
        "capture_video_track_inspected",
        window.streamingDebug.captureDiagnostics.videoTrackDetails,
      );
    } else {
      console.error("[TAB_CAPTURE] No video tracks in stream!");
      window.streamingDebug.captureDiagnostics = {
        ...window.streamingDebug.captureDiagnostics,
        error: "No video tracks in stream",
      };
      recordDebugEvent("capture_stream_missing_video_track");
    }

    // Store globally to detect active capture on subsequent init calls
    try {
      window.currentCaptureStream = stream;
      console.log("[TAB_CAPTURE] currentCaptureStream set");
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          console.log("[TAB_CAPTURE] Track ended:", track.kind, track.label);
          const allEnded =
            !window.currentCaptureStream ||
            window.currentCaptureStream.getTracks().every((t) => t.readyState === "ended");
          if (allEnded) {
            console.log("[TAB_CAPTURE] All tracks ended, clearing currentCaptureStream");
            window.currentCaptureStream = null;
          }
        };
      });
    } catch (e) {
      console.warn("[TAB_CAPTURE] Could not set global capture stream:", e?.message);
    }

    // Close any existing publisher peer connection
    if (publisherPc) {
      console.log("[PUBLISHER] Closing previous RTCPeerConnection before creating new one");
      try {
        publisherPc.close();
      } catch (e) {
        console.warn("[PUBLISHER] Error closing previous pc:", e?.message);
      }
      publisherPc = null;
    }

    // Create RTCPeerConnection with ICE servers
    console.log(
      `[PUBLISHER] Creating RTCPeerConnection with ${Array.isArray(iceServers) ? iceServers.length : 0} ICE servers`,
    );

    const pc = new RTCPeerConnection({
      iceServers: Array.isArray(iceServers) ? iceServers : [],
      bundlePolicy: "max-bundle",
    });
    publisherPc = pc;

    // Track connection state changes for activeConnections monitoring
    const connectionId = `publisher-${traceId}`;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[PUBLISHER] connectionState changed to: ${state}`);
      window.streamingDebug.publisherState = state;
      recordDebugEvent("publisher_connection_state_change", { state, connectionId });

      if (state === "connected") {
        addConnection(connectionId);
        // Live sender stats in /debug-state: where frames are lost (capture vs encoder vs bandwidth).
        const statsTimer = setInterval(async () => {
          if (pc.connectionState !== "connected") return clearInterval(statsTimer);
          const video = {};
          (await pc.getStats()).forEach((r) => {
            if (r.type === "media-source" && r.kind === "video")
              Object.assign(video, {
                captureFps: r.framesPerSecond,
                captureSize: `${r.width}x${r.height}`,
              });
            if (r.type === "outbound-rtp" && r.kind === "video")
              Object.assign(video, {
                sendFps: r.framesPerSecond,
                sendSize: `${r.frameWidth}x${r.frameHeight}`,
                limitedBy: r.qualityLimitationReason,
                encoder: r.encoderImplementation,
                targetBitrate: r.targetBitrate,
                limitedSeconds: r.qualityLimitationDurations,
                keyFramesEncoded: r.keyFramesEncoded,
                pliCount: r.pliCount,
                nackCount: r.nackCount,
                avgEncodeMs: r.framesEncoded
                  ? Math.round((r.totalEncodeTime / r.framesEncoded) * 10000) / 10
                  : null,
              });
            if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded")
              Object.assign(video, {
                rttMs: Math.round((r.currentRoundTripTime || 0) * 1000),
                outgoingKbps: Math.round((r.availableOutgoingBitrate || 0) / 1000),
              });
          });
          window.streamingDebug.videoStats = video;
        }, 2000);
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        removeConnection(connectionId);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[PUBLISHER] ICE candidate:", event.candidate.candidate.substring(0, 80));
      } else {
        console.log("[PUBLISHER] ICE gathering complete");
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[PUBLISHER] ICE gathering state: ${pc.iceGatheringState}`);
    };

    // Add captured tracks to the peer connection with fixed names
    // CF Realtime SFU uses track names to identify streams
    const tracks = [];

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      // Games are motion, not slides: without this Chrome treats tab capture as screen content and
      // keeps 1080p sharp by dropping to ~12 fps.
      // 720p at <=4 Mbps (not 1080p/8): measured on a Chromecast over Wi-Fi, one lost packet at 1080p
      // froze the picture ~2.4s waiting for a huge keyframe, and software VP8 used ~21ms of the 33ms
      // frame budget. 720p keyframes are ~2.5x smaller and encode in about half the time.
      videoTracks[0].contentHint = "motion";
      const sender = pc.addTrack(videoTracks[0], stream);
      const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
      if (transceiver) {
        transceiver.direction = "sendonly";
      }
      const params = sender.getParameters();
      // Hold 720p when bits run short (drop frames instead): after a dip the quality scaler kept the
      // picture at 640x360 well after the bandwidth came back (measured Oct 3, laptop and cloud alike).
      params.degradationPreference = "maintain-resolution";
      params.encodings = (params.encodings.length ? params.encodings : [{}]).map((e) => ({
        ...e,
        maxBitrate: maxKbps * 1000,
        maxFramerate: 30,
      }));
      sender
        .setParameters(params)
        .catch((err) => console.warn("[PUBLISHER] setParameters failed:", err?.message));
      tracks.push({
        location: "local",
        trackName: "cast-video",
      });
      console.log("[PUBLISHER] Added video track as 'cast-video'");
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      const sender = pc.addTrack(audioTracks[0], stream);
      const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
      if (transceiver) {
        transceiver.direction = "sendonly";
      }
      tracks.push({
        location: "local",
        trackName: "cast-audio",
      });
      console.log("[PUBLISHER] Added audio track as 'cast-audio'");
    }

    // Create local SDP offer
    console.log("[PUBLISHER] Creating SDP offer...");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("[PUBLISHER] Local description set (offer)");

    const sessionDescription = {
      type: pc.localDescription.type,
      sdp: pc.localDescription.sdp,
    };

    // After setLocalDescription, transceiver.mid is populated — add it to tracks
    const transceivers = pc.getTransceivers();
    for (const track of tracks) {
      const transceiver = transceivers.find(
        (t) =>
          t.sender.track &&
          ((track.trackName === "cast-video" && t.sender.track.kind === "video") ||
            (track.trackName === "cast-audio" && t.sender.track.kind === "audio")),
      );
      if (transceiver && transceiver.mid) {
        track.mid = transceiver.mid;
        console.log(`[PUBLISHER] Track '${track.trackName}' assigned mid: ${transceiver.mid}`);
      }
    }

    console.log(`[INITIALIZE_PUBLISHER] Initialization complete.`);
    console.log(`[INITIALIZE_PUBLISHER] Tracks: ${tracks.length}, traceId: ${traceId}`);
    console.log(`[INITIALIZE_PUBLISHER] ========== INITIALIZATION COMPLETE ==========`);
    recordDebugEvent("initialize_publisher_complete", {
      trackCount: tracks.length,
      traceId,
    });

    return {
      sessionDescription,
      tracks,
      traceId,
    };
  } catch (error) {
    console.error(`[INITIALIZE_PUBLISHER] INITIALIZATION FAILED:`, error);
    console.error(`[INITIALIZE_PUBLISHER] Error stack:`, error.stack);
    window.streamingDebug.lastError = `Initialization failed: ${error.message}`;
    recordDebugEvent("initialize_publisher_failed", { message: error.message });
    throw error;
  }
}

/**
 * APPLY_REMOTE_DESCRIPTION applies the SFU's answer SDP to the publisher
 * RTCPeerConnection, completing the WebRTC handshake.
 *
 * Called by the container server after it sends the local offer to the
 * CF Realtime SFU and receives the answer.
 *
 * @param {{ sessionDescription: { type: string, sdp: string } }} params
 */
/**
 * Measured on a Chromecast HD (Oct 3): every cloud stream spent its first ~30 s at 640x360 ("limited by
 * bandwidth") while Chrome's estimate climbed from ~300 kbps, and the quality scaler kept it small for a
 * while after the target reached 4 Mbps. The server and the SFU are in the same datacenter (rtt ~3 ms),
 * so starting the estimate near the cap is safe: x-google-start-bitrate in the SFU's answer seeds it.
 */
const START_KBPS = 3000;
function withStartBitrate(sdp, kbps) {
  if (typeof sdp !== "string" || sdp.includes("x-google-start-bitrate")) return sdp;
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const param = `x-google-start-bitrate=${kbps}`;
  const videoPts = new Set();
  const withFmtp = new Set();
  let video = false;
  for (const line of lines) {
    if (line.startsWith("m=")) video = line.startsWith("m=video");
    if (!video) continue;
    const rtpmap = /^a=rtpmap:(\d+) ([^/]+)\//.exec(line);
    if (rtpmap && /^(H264|VP8|VP9|AV1)$/i.test(rtpmap[2])) videoPts.add(rtpmap[1]);
    const fmtp = /^a=fmtp:(\d+) /.exec(line);
    if (fmtp) withFmtp.add(fmtp[1]);
  }
  const out = [];
  video = false;
  for (const line of lines) {
    if (line.startsWith("m=")) video = line.startsWith("m=video");
    const fmtp = video ? /^a=fmtp:(\d+) /.exec(line) : null;
    if (fmtp && videoPts.has(fmtp[1])) {
      out.push(`${line};${param}`);
      continue;
    }
    out.push(line);
    const rtpmap = video ? /^a=rtpmap:(\d+) /.exec(line) : null;
    if (rtpmap && videoPts.has(rtpmap[1]) && !withFmtp.has(rtpmap[1]))
      out.push(`a=fmtp:${rtpmap[1]} ${param}`);
  }
  return out.join(eol);
}

async function APPLY_REMOTE_DESCRIPTION({ sessionDescription }) {
  console.log(`[APPLY_REMOTE_DESCRIPTION] Applying remote description...`);
  console.log(`[APPLY_REMOTE_DESCRIPTION] Type: ${sessionDescription.type}`);
  recordDebugEvent("apply_remote_description_called", { type: sessionDescription.type });

  if (!publisherPc) {
    const msg = "No publisher RTCPeerConnection — call INITIALIZE_PUBLISHER first";
    console.error(`[APPLY_REMOTE_DESCRIPTION] ${msg}`);
    window.streamingDebug.lastError = msg;
    throw new Error(msg);
  }

  try {
    await publisherPc.setRemoteDescription(
      new RTCSessionDescription({
        type: sessionDescription.type,
        sdp: withStartBitrate(sessionDescription.sdp, START_KBPS),
      }),
    );
    console.log(`[APPLY_REMOTE_DESCRIPTION] Remote description applied successfully`);
    console.log(`[APPLY_REMOTE_DESCRIPTION] Connection state: ${publisherPc.connectionState}`);
    console.log(
      `[APPLY_REMOTE_DESCRIPTION] ICE connection state: ${publisherPc.iceConnectionState}`,
    );
    recordDebugEvent("apply_remote_description_complete", {
      connectionState: publisherPc.connectionState,
      iceConnectionState: publisherPc.iceConnectionState,
    });
  } catch (error) {
    console.error(`[APPLY_REMOTE_DESCRIPTION] Failed:`, error);
    window.streamingDebug.lastError = `Apply remote description failed: ${error.message}`;
    recordDebugEvent("apply_remote_description_failed", { message: error.message });
    throw error;
  }
}

/**
 * CLOSE_PUBLISHER cleans up the publisher RTCPeerConnection and capture stream.
 * Called when a cast session ends or the container is shutting down.
 */
async function CLOSE_PUBLISHER() {
  console.log(`[CLOSE_PUBLISHER] Closing publisher...`);
  recordDebugEvent("close_publisher_called");

  try {
    if (publisherPc) {
      console.log(
        `[CLOSE_PUBLISHER] Closing RTCPeerConnection (state: ${publisherPc.connectionState})`,
      );
      publisherPc.close();
      publisherPc = null;
    }

    if (window.currentCaptureStream) {
      console.log("[CLOSE_PUBLISHER] Stopping capture stream tracks...");
      window.currentCaptureStream.getTracks().forEach((t) => {
        console.log(`[CLOSE_PUBLISHER] Stopping track: ${t.kind} ${t.label}`);
        t.stop();
      });
      window.currentCaptureStream = null;
    }

    // Clear all connections
    window.activeConnections.clear();
    console.log("[CLOSE_PUBLISHER] All connections cleared");

    window.streamingDebug.publisherState = null;
    publisherTraceId = null;
    recordDebugEvent("close_publisher_complete");
  } catch (error) {
    console.error(`[CLOSE_PUBLISHER] Error during cleanup:`, error);
    window.streamingDebug.lastError = `Close publisher failed: ${error.message}`;
    recordDebugEvent("close_publisher_failed", { message: error.message });
    throw error;
  }
}

// Log when the script finishes loading
console.log("[INIT] streaming.js script execution complete");
console.log(
  "[INIT] INITIALIZE_PUBLISHER function available:",
  typeof INITIALIZE_PUBLISHER === "function",
);
console.log(
  "[INIT] APPLY_REMOTE_DESCRIPTION function available:",
  typeof APPLY_REMOTE_DESCRIPTION === "function",
);
console.log("[INIT] CLOSE_PUBLISHER function available:", typeof CLOSE_PUBLISHER === "function");
console.log("[INIT] Global objects available:", {
  RTCPeerConnection: typeof RTCPeerConnection !== "undefined",
  chrome: typeof chrome !== "undefined",
  "chrome.tabCapture": typeof chrome !== "undefined" && typeof chrome.tabCapture !== "undefined",
});
