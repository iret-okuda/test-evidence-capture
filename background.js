"use strict";

const MESSAGE = Object.freeze({
  START_CAPTURE: "test-evidence:start-capture",
  CAPTURE_VISIBLE_TAB: "test-evidence:capture-visible-tab",
  DOWNLOAD_PNG: "test-evidence:download-png",
  SET_CAPTURE_MODE_STATE: "test-evidence:set-capture-mode-state",
  SHOULD_RESTORE_CAPTURE_MODE: "test-evidence:should-restore-capture-mode",
});
const CAPTURE_MODE_TABS_KEY = "testEvidenceCaptureActiveTabs";
let captureModeStateUpdate = Promise.resolve();

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-capture") {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    startCaptureInTab(tabs[0]);
  });
});

chrome.action.onClicked.addListener((tab) => {
  startCaptureInTab(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void updateCaptureModeState(tabId, null);
});

function startCaptureInTab(tab) {
  if (!Number.isInteger(tab?.id)) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: MESSAGE.START_CAPTURE }, () => {
    // Restricted pages such as chrome:// do not host content scripts.
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE.SET_CAPTURE_MODE_STATE) {
    if (!Number.isInteger(sender.tab?.id)) {
      sendResponse({ ok: false, error: "The sender tab is unavailable." });
      return false;
    }
    void updateCaptureModeState(
      sender.tab.id,
      message.active && typeof message.pageKey === "string" ? message.pageKey : null,
    )
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE.SHOULD_RESTORE_CAPTURE_MODE) {
    if (!Number.isInteger(sender.tab?.id) || typeof message.pageKey !== "string") {
      sendResponse({ ok: false, restore: false });
      return false;
    }
    void getCaptureModeStates()
      .then(async (states) => {
        const storedPageKey = states[String(sender.tab.id)];
        const restore = storedPageKey === message.pageKey;
        if (storedPageKey && !restore) {
          await updateCaptureModeState(sender.tab.id, null);
        }
        sendResponse({ ok: true, restore });
      })
      .catch((error) => sendResponse({ ok: false, restore: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE.CAPTURE_VISIBLE_TAB) {
    if (!Number.isInteger(sender.tab?.windowId)) {
      sendResponse({ ok: false, error: "The sender tab is unavailable." });
      return false;
    }

    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png" },
      (dataUrl) => {
        const error = chrome.runtime.lastError;
        if (error || !dataUrl) {
          sendResponse({
            ok: false,
            error: error?.message || "Chrome returned no screenshot data.",
          });
          return;
        }

        // Echo the CSS-pixel crop contract supplied by the content script so
        // the response and bitmap are handled as one capture result.
        sendResponse({ ok: true, dataUrl, crop: message.crop });
      },
    );
    return true;
  }

  if (message?.type === MESSAGE.DOWNLOAD_PNG) {
    if (
      typeof message.dataUrl !== "string" ||
      !message.dataUrl.startsWith("data:image/png;base64,")
    ) {
      sendResponse({ ok: false, error: "Invalid PNG data." });
      return false;
    }

    const filename = sanitizeFilename(message.filename);
    chrome.downloads.download(
      { url: message.dataUrl, filename, saveAs: Boolean(message.saveAs) },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error || downloadId === undefined) {
          sendResponse({
            ok: false,
            error: error?.message || "The PNG download could not be started.",
          });
          return;
        }

        sendResponse({ ok: true, downloadId });
      },
    );
    return true;
  }

  return false;
});

function sanitizeFilename(filename) {
  if (typeof filename !== "string") {
    return "evidence.png";
  }

  const safeName = filename
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/^\.+/, "");
  if (!safeName) {
    return "evidence.png";
  }
  return safeName.endsWith(".png") ? safeName : `${safeName}.png`;
}

function getCaptureModeStates() {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(CAPTURE_MODE_TABS_KEY, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      const states = result[CAPTURE_MODE_TABS_KEY];
      resolve(states && typeof states === "object" ? states : {});
    });
  });
}

function updateCaptureModeState(tabId, pageKey) {
  captureModeStateUpdate = captureModeStateUpdate.catch(() => {}).then(async () => {
    const states = await getCaptureModeStates();
    const tabKey = String(tabId);
    if (pageKey) {
      states[tabKey] = pageKey;
    } else {
      delete states[tabKey];
    }
    await new Promise((resolve, reject) => {
      chrome.storage.session.set({ [CAPTURE_MODE_TABS_KEY]: states }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  });
  return captureModeStateUpdate;
}
