(function initializeContentScript() {
  "use strict";

  if (globalThis.__testEvidenceCaptureInstalled) {
    return;
  }
  globalThis.__testEvidenceCaptureInstalled = true;

  const MESSAGE = Object.freeze({
    START_CAPTURE: "test-evidence:start-capture",
    CAPTURE_VISIBLE_TAB: "test-evidence:capture-visible-tab",
    DOWNLOAD_PNG: "test-evidence:download-png",
    SET_CAPTURE_MODE_STATE: "test-evidence:set-capture-mode-state",
    SHOULD_RESTORE_CAPTURE_MODE: "test-evidence:should-restore-capture-mode",
  });
  const TOOL_ATTRIBUTE = "data-test-evidence-capture-tool";
  const PADDING_CSS_PX = 8;
  const CAPTURE_HISTORY_KEY = "testEvidenceCaptureHistory";
  const CAPTURE_HISTORY_LIMIT = 5;
  const CAPTURE_INTERVAL_MS = 550;
  const MAX_CAPTURE_TILES = 100;
  const MAX_OUTPUT_DIMENSION_PX = 32767;
  const MAX_OUTPUT_PIXELS = 100000000;
  const INPUT_SETTINGS_KEY = "testEvidenceCaptureInputSettings";
  const DEFAULT_INPUT_SETTINGS = Object.freeze({
    prefix: "AC",
    numbers: Object.freeze([1, 1, 1]),
    numberEnabled: Object.freeze([true, true, true]),
    timing: "before",
    timingEnabled: true,
    includeTooltips: true,
    captureBeyondViewport: false,
  });
  const BLOCKED_MOUSE_EVENTS = [
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
  ];

  let session = null;
  let rememberedDirectoryHandle = null;
  let inputSettingsSave = Promise.resolve();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE.START_CAPTURE) {
      return false;
    }

    startCaptureMode();
    sendResponse({ ok: true });
    return false;
  });

  void restoreCaptureModeAfterReload();

  function startCaptureMode() {
    if (session?.active) {
      setStatus("撮影モード中 · 右クリック/Spaceで選択 · 撮影ボタン/Enterで保存 · Escで終了");
      return;
    }

    const ui = createOverlayUi();
    session = {
      active: true,
      capturing: false,
      host: ui.host,
      hoverBox: ui.hoverBox,
      captureBoundsBox: ui.captureBoundsBox,
      selectedLayer: ui.selectedLayer,
      tooltipLayer: ui.tooltipLayer,
      annotationLayer: ui.annotationLayer,
      status: ui.status,
      filenameControls: ui.filenameControls,
      selectionList: ui.selectionList,
      selectionSummary: ui.selectionSummary,
      selectionDetails: ui.selectionDetails,
      captureButton: ui.captureButton,
      hoverElement: null,
      selectedElements: new Set(),
      selectedBoxes: new Map(),
      annotatedElements: new Set(),
      annotationBoxes: new Map(),
      tooltipBoxes: [],
      showTooltipFeedback: false,
      historyRecords: [],
      historyList: ui.historyList,
      childHistory: [],
      pointer: null,
      animationFrame: null,
    };

    renderSelectionList();
    void loadCaptureHistory(session);
    void loadInputSettings(session);

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    for (const eventName of BLOCKED_MOUSE_EVENTS) {
      window.addEventListener(eventName, suppressPageMouseEvent, true);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur, true);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange, true);
    session.animationFrame = requestAnimationFrame(renderOverlays);
    void notifyCaptureModeState(true);
  }

  async function restoreCaptureModeAfterReload() {
    try {
      const response = await sendMessage({
        type: MESSAGE.SHOULD_RESTORE_CAPTURE_MODE,
        pageKey: currentDocumentKey(),
      });
      if (response?.restore && !session?.active) {
        startCaptureMode();
        setStatus("画面更新前の撮影モードを復元しました");
      }
    } catch (error) {
      console.warn("[Test Evidence Capture] Could not restore capture mode.", error);
    }
  }

  function notifyCaptureModeState(active) {
    return sendMessage({
      type: MESSAGE.SET_CAPTURE_MODE_STATE,
      active,
      pageKey: currentDocumentKey(),
    }).catch((error) => {
      console.warn("[Test Evidence Capture] Could not persist capture mode state.", error);
    });
  }

  function createOverlayUi() {
    const host = document.createElement("div");
    host.setAttribute(TOOL_ATTRIBUTE, "");
    setImportantStyles(host, {
      all: "initial",
      position: "fixed",
      inset: "0",
      width: "0",
      height: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });

    const shadow = host.attachShadow({ mode: "closed" });
    const selectedLayer = document.createElement("div");
    const tooltipLayer = document.createElement("div");
    const annotationLayer = document.createElement("div");
    const hoverBox = createBox("#ff9f0a", "rgba(255, 159, 10, 0.12)");
    const captureBoundsBox = createCaptureBoundsBox();
    const {
      panel,
      controls: filenameControls,
      historyList,
      selectionList,
      selectionSummary,
      selectionDetails,
      captureButton,
    } = createFilenamePanel();
    const status = document.createElement("div");
    status.textContent = "撮影モード · 右クリック/Spaceで選択 · Shiftで追加 · ↑で親要素 · 撮影ボタン/Enterで保存 · Escで終了";
    setImportantStyles(status, {
      all: "initial",
      position: "fixed",
      bottom: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      boxSizing: "border-box",
      maxWidth: "calc(100vw - 24px)",
      padding: "8px 12px",
      borderRadius: "6px",
      background: "rgba(20, 24, 31, 0.94)",
      color: "#ffffff",
      font: "600 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif",
      letterSpacing: "0",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      boxShadow: "0 3px 12px rgba(0, 0, 0, 0.28)",
      pointerEvents: "none",
    });

    shadow.append(
      captureBoundsBox,
      selectedLayer,
      tooltipLayer,
      annotationLayer,
      hoverBox,
      status,
      panel,
    );
    document.documentElement.append(host);
    return {
      host,
      selectedLayer,
      tooltipLayer,
      annotationLayer,
      hoverBox,
      captureBoundsBox,
      status,
      filenameControls,
      historyList,
      selectionList,
      selectionSummary,
      selectionDetails,
      captureButton,
    };
  }

  function createFilenamePanel() {
    let controls = null;
    const panel = document.createElement("section");
    setImportantStyles(panel, {
      all: "initial",
      position: "fixed",
      top: "12px",
      right: "12px",
      boxSizing: "border-box",
      width: "264px",
      maxHeight: "calc(100vh - 24px)",
      overflowY: "auto",
      padding: "12px",
      border: "1px solid rgba(0, 0, 0, 0.18)",
      borderRadius: "9px",
      background: "rgba(250, 250, 250, 0.98)",
      color: "#1d1d1f",
      font: "13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif",
      boxShadow: "0 5px 20px rgba(0, 0, 0, 0.24)",
      pointerEvents: "auto",
    });

    const title = document.createElement("div");
    title.textContent = "証跡ファイル名";
    setImportantStyles(title, {
      all: "initial",
      display: "block",
      color: "#1d1d1f",
      font: "700 13px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
    });

    const clearSettingsButton = createSecondaryButton("入力設定をクリア");
    clearSettingsButton.setAttribute("aria-label", "保存した証跡入力設定をクリア");
    setImportantStyles(clearSettingsButton, {
      padding: "3px 6px",
      color: "#6e6e73",
      font: "600 10px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
    });

    const titleRow = document.createElement("div");
    setImportantStyles(titleRow, {
      all: "initial",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      marginBottom: "9px",
    });
    titleRow.append(title, clearSettingsButton);

    const prefixInput = document.createElement("input");
    prefixInput.type = "text";
    prefixInput.value = "AC";
    prefixInput.maxLength = 20;
    prefixInput.setAttribute("aria-label", "テスト番号のprefix");
    setInputStyles(prefixInput, "62px");

    const numberInputs = Array.from({ length: 3 }, (_, index) => {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.step = "1";
      input.value = "1";
      input.setAttribute("aria-label", `テスト番号 ${index + 1}`);
      setInputStyles(input, "48px");
      input.addEventListener("change", () => {
        input.value = String(TestEvidenceFilename.normalizeNumber(input.value));
      });
      return input;
    });
    const optionalNumberCheckboxes = [2, 3].map((number) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.setAttribute("aria-label", `テスト番号 ${number} をファイル名に含める`);
      setImportantStyles(checkbox, {
        all: "initial",
        display: "block",
        width: "13px",
        height: "13px",
        appearance: "auto",
        cursor: "pointer",
        pointerEvents: "auto",
      });
      return checkbox;
    });

    const syncOptionalNumbers = () => {
      const secondEnabled = optionalNumberCheckboxes[0].checked;
      if (!secondEnabled) {
        optionalNumberCheckboxes[1].checked = false;
      }
      optionalNumberCheckboxes[1].disabled = !secondEnabled;
      setNumberInputEnabled(numberInputs[1], secondEnabled);
      setNumberInputEnabled(numberInputs[2], secondEnabled && optionalNumberCheckboxes[1].checked);
    };
    optionalNumberCheckboxes[0].addEventListener("change", syncOptionalNumbers);
    optionalNumberCheckboxes[1].addEventListener("change", syncOptionalNumbers);
    syncOptionalNumbers();

    const fields = document.createElement("div");
    setImportantStyles(fields, {
      all: "initial",
      display: "flex",
      alignItems: "end",
      gap: "6px",
      marginBottom: "10px",
    });
    fields.append(
      createField("Prefix", prefixInput),
      createField("№（1）", numberInputs[0]),
      createOptionalField("№（2）", numberInputs[1], optionalNumberCheckboxes[0]),
      createOptionalField("№（3）", numberInputs[2], optionalNumberCheckboxes[1]),
    );

    const timingRow = document.createElement("div");
    setImportantStyles(timingRow, {
      all: "initial",
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: "3px",
      padding: "3px",
      borderRadius: "7px",
      background: "#e5e5e7",
    });

    let timing = "before";
    const beforeButton = createTimingButton("before");
    const afterButton = createTimingButton("after");
    const resultButton = createTimingButton("result");
    const selectTiming = (value) => {
      timing = value;
      setTimingButtonState(beforeButton, value === "before");
      setTimingButtonState(afterButton, value === "after");
      setTimingButtonState(resultButton, value === "result");
    };
    beforeButton.addEventListener("click", () => selectTiming("before"));
    afterButton.addEventListener("click", () => selectTiming("after"));
    resultButton.addEventListener("click", () => selectTiming("result"));
    selectTiming("before");
    timingRow.append(beforeButton, afterButton, resultButton);

    const timingEnabledCheckbox = document.createElement("input");
    timingEnabledCheckbox.type = "checkbox";
    timingEnabledCheckbox.checked = true;
    timingEnabledCheckbox.setAttribute("aria-label", "before after resultをファイル名に含める");
    setImportantStyles(timingEnabledCheckbox, {
      all: "initial",
      display: "block",
      width: "13px",
      height: "13px",
      appearance: "auto",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    const timingEnabledLabel = document.createElement("label");
    const timingEnabledText = document.createElement("span");
    timingEnabledText.textContent = "区分を付ける";
    setImportantStyles(timingEnabledLabel, {
      all: "initial",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginBottom: "5px",
      color: "#515154",
      font: "11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    setImportantStyles(timingEnabledText, {
      all: "initial",
      display: "block",
      color: "#515154",
      font: "11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
    });
    timingEnabledLabel.append(timingEnabledCheckbox, timingEnabledText);

    const timingSection = document.createElement("div");
    setImportantStyles(timingSection, {
      all: "initial",
      display: "block",
    });
    timingSection.append(timingEnabledLabel, timingRow);

    const syncTimingEnabled = () => {
      const enabled = timingEnabledCheckbox.checked;
      for (const button of [beforeButton, afterButton, resultButton]) {
        button.disabled = !enabled;
        button.style.setProperty("cursor", enabled ? "pointer" : "default", "important");
      }
      timingRow.style.setProperty("opacity", enabled ? "1" : "0.45", "important");
    };
    timingEnabledCheckbox.addEventListener("change", syncTimingEnabled);
    syncTimingEnabled();

    const includeTooltipsCheckbox = document.createElement("input");
    includeTooltipsCheckbox.type = "checkbox";
    includeTooltipsCheckbox.checked = true;
    includeTooltipsCheckbox.setAttribute("aria-label", "表示中のTooltipを撮影範囲に含める");
    setImportantStyles(includeTooltipsCheckbox, {
      all: "initial",
      display: "block",
      width: "14px",
      height: "14px",
      appearance: "auto",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    const tooltipSetting = document.createElement("label");
    const tooltipSettingText = document.createElement("span");
    tooltipSettingText.textContent = "表示中のTooltipを含める";
    setImportantStyles(tooltipSetting, {
      all: "initial",
      display: "flex",
      alignItems: "center",
      gap: "7px",
      marginTop: "9px",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    setImportantStyles(tooltipSettingText, {
      all: "initial",
      display: "block",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
    });
    tooltipSetting.append(includeTooltipsCheckbox, tooltipSettingText);

    const captureBeyondViewportCheckbox = document.createElement("input");
    captureBeyondViewportCheckbox.type = "checkbox";
    captureBeyondViewportCheckbox.checked = false;
    captureBeyondViewportCheckbox.setAttribute(
      "aria-label",
      "viewport外の選択DOMも自動スクロールして撮影する",
    );
    setImportantStyles(captureBeyondViewportCheckbox, {
      all: "initial",
      display: "block",
      width: "14px",
      height: "14px",
      appearance: "auto",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    const captureBeyondViewportSetting = document.createElement("label");
    const captureBeyondViewportText = document.createElement("span");
    captureBeyondViewportText.textContent = "viewport外も自動スクロール撮影";
    setImportantStyles(captureBeyondViewportSetting, {
      all: "initial",
      display: "flex",
      alignItems: "center",
      gap: "7px",
      marginTop: "7px",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    setImportantStyles(captureBeyondViewportText, {
      all: "initial",
      display: "block",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
    });
    captureBeyondViewportSetting.append(
      captureBeyondViewportCheckbox,
      captureBeyondViewportText,
    );

    const selectionDetails = document.createElement("details");
    setImportantStyles(selectionDetails, {
      all: "initial",
      display: "block",
      marginTop: "10px",
      paddingTop: "10px",
      borderTop: "1px solid #dedee2",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      pointerEvents: "auto",
    });
    const selectionSummary = document.createElement("summary");
    selectionSummary.textContent = "選択中のDOM（0）";
    setImportantStyles(selectionSummary, {
      all: "revert",
      display: "list-item",
      color: "#3a3a3c",
      font: "600 12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      userSelect: "none",
      pointerEvents: "auto",
    });
    const selectionList = document.createElement("div");
    selectionList.setAttribute("role", "list");
    selectionList.setAttribute("aria-label", "選択中のDOM一覧");
    setImportantStyles(selectionList, {
      all: "initial",
      display: "grid",
      alignContent: "start",
      gap: "3px",
      boxSizing: "border-box",
      height: "144px",
      marginTop: "7px",
      padding: "4px",
      overflowY: "auto",
      border: "1px solid #d1d1d6",
      borderRadius: "5px",
      background: "#ffffff",
      color: "#3a3a3c",
      font: "11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
      pointerEvents: "auto",
    });
    selectionDetails.append(selectionSummary, selectionList);

    const destination = {
      directoryHandle: rememberedDirectoryHandle,
      pendingDirectoryHandle: null,
      useSaveAs: false,
    };
    const destinationName = document.createElement("span");
    destinationName.textContent = "ダウンロード（既定）";
    destinationName.title = "Chromeで設定されているダウンロード先";
    setImportantStyles(destinationName, {
      all: "initial",
      display: "block",
      minWidth: "0",
      overflow: "hidden",
      color: "#3a3a3c",
      font: "12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    const chooseDirectoryButton = createSecondaryButton("変更…");
    chooseDirectoryButton.setAttribute("aria-label", "保存先ディレクトリを変更");
    chooseDirectoryButton.addEventListener("click", async () => {
      chooseDirectoryButton.disabled = true;
      try {
        if (destination.pendingDirectoryHandle) {
          let permission = "denied";
          try {
            permission = await destination.pendingDirectoryHandle.requestPermission({
              mode: "readwrite",
            });
          } catch (error) {
            console.warn("[Test Evidence Capture] Directory permission renewal failed.", error);
          }
          if (permission === "granted") {
            destination.directoryHandle = destination.pendingDirectoryHandle;
            destination.pendingDirectoryHandle = null;
            rememberedDirectoryHandle = destination.directoryHandle;
            destinationName.textContent = destination.directoryHandle.name;
            destinationName.title = destination.directoryHandle.name;
            chooseDirectoryButton.textContent = "変更…";
            setStatus(`保存先を復元しました: ${destination.directoryHandle.name}`);
            return;
          }
        }

        if (typeof globalThis.showDirectoryPicker !== "function") {
          destination.directoryHandle = null;
          destination.useSaveAs = true;
          destinationName.textContent = "保存時に選択";
          destinationName.title = "Enter後に名前を付けて保存ダイアログを表示します";
          setStatus("このページではフォルダ選択を使えないため、保存時に保存先を選択します");
          return;
        }

        const directoryHandle = await globalThis.showDirectoryPicker({
          id: "test-evidence-output",
          mode: "readwrite",
          startIn: destination.directoryHandle || "downloads",
        });
        destination.directoryHandle = directoryHandle;
        destination.pendingDirectoryHandle = null;
        destination.useSaveAs = false;
        rememberedDirectoryHandle = directoryHandle;
        destinationName.textContent = directoryHandle.name;
        destinationName.title = directoryHandle.name;
        chooseDirectoryButton.textContent = "変更…";
        try {
          await TestEvidenceStorage.rememberDirectoryHandle(directoryHandle);
        } catch (error) {
          console.warn("[Test Evidence Capture] Could not remember capture directory.", error);
          setStatus("保存先は利用できますが、次回起動用に記憶できませんでした");
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("[Test Evidence Capture] Directory picker failed.", error);
          destination.directoryHandle = null;
          destination.useSaveAs = true;
          destinationName.textContent = "保存時に選択";
          destinationName.title = "Enter後に名前を付けて保存ダイアログを表示します";
          setStatus("フォルダを直接選択できないため、保存時に保存先を選択します");
        }
      } finally {
        chooseDirectoryButton.disabled = false;
      }
    });

    void restoreRememberedDirectory(
      destination,
      destinationName,
      chooseDirectoryButton,
    );

    const destinationRow = document.createElement("div");
    setImportantStyles(destinationRow, {
      all: "initial",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      alignItems: "center",
      gap: "8px",
      marginTop: "10px",
      paddingTop: "10px",
      borderTop: "1px solid #dedee2",
    });
    destinationRow.append(destinationName, chooseDirectoryButton);

    const captureButton = createSecondaryButton("撮影する (Enter)");
    captureButton.setAttribute("aria-label", "選択中のDOMを撮影して保存");
    setImportantStyles(captureButton, {
      width: "100%",
      marginTop: "10px",
      padding: "8px 10px",
      border: "1px solid #006edb",
      background: "#0a84ff",
      color: "#ffffff",
      font: "700 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      textAlign: "center",
    });
    captureButton.addEventListener("click", () => {
      void captureSelection();
    });

    const historyTitle = document.createElement("div");
    historyTitle.textContent = "直近のDOM選択";
    setImportantStyles(historyTitle, {
      all: "initial",
      display: "block",
      marginBottom: "6px",
      color: "#515154",
      font: "600 11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
    });
    const historyList = document.createElement("div");
    setImportantStyles(historyList, {
      all: "initial",
      display: "grid",
      gap: "4px",
    });
    const historySection = document.createElement("section");
    setImportantStyles(historySection, {
      all: "initial",
      display: "block",
      marginTop: "10px",
      paddingTop: "10px",
      borderTop: "1px solid #dedee2",
    });
    historySection.append(historyTitle, historyList);

    panel.append(
      titleRow,
      fields,
      timingSection,
      tooltipSetting,
      captureBeyondViewportSetting,
      selectionDetails,
      destinationRow,
      captureButton,
      historySection,
    );
    controls = {
      prefixInput,
      numberInputs,
      optionalNumberCheckboxes,
      includeTooltipsCheckbox,
      captureBeyondViewportCheckbox,
      timingEnabledCheckbox,
      getTiming: () => timing,
      setTiming: selectTiming,
      syncOptionalNumbers,
      syncTimingEnabled,
      settingsDirty: false,
      getDestination: () => ({ ...destination }),
    };

    const persistSettings = () => {
      controls.settingsDirty = true;
      void saveInputSettings(controls);
    };
    prefixInput.addEventListener("input", persistSettings);
    for (const input of numberInputs) {
      input.addEventListener("input", persistSettings);
    }
    for (const checkbox of optionalNumberCheckboxes) {
      checkbox.addEventListener("change", persistSettings);
    }
    for (const button of [beforeButton, afterButton, resultButton]) {
      button.addEventListener("click", persistSettings);
    }
    timingEnabledCheckbox.addEventListener("change", persistSettings);
    includeTooltipsCheckbox.addEventListener("change", persistSettings);
    captureBeyondViewportCheckbox.addEventListener("change", persistSettings);
    clearSettingsButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm(
        "証跡の入力設定を初期値に戻しますか？\n保存先とスクショ履歴は削除されません。",
      );
      if (!confirmed) {
        return;
      }
      controls.settingsDirty = true;
      applyInputSettings(controls, DEFAULT_INPUT_SETTINGS);
      await saveInputSettings(controls);
      setStatus("証跡の入力設定を初期値へ戻しました");
    });

    return {
      panel,
      historyList,
      selectionList,
      selectionSummary,
      selectionDetails,
      captureButton,
      controls,
    };
  }

  async function restoreRememberedDirectory(destination, destinationName, chooseButton) {
    try {
      const directoryHandle =
        rememberedDirectoryHandle || (await TestEvidenceStorage.loadDirectoryHandle());
      if (!directoryHandle) {
        return;
      }

      rememberedDirectoryHandle = directoryHandle;
      const permission =
        typeof directoryHandle.queryPermission === "function"
          ? await directoryHandle.queryPermission({ mode: "readwrite" })
          : "prompt";
      if (permission === "granted") {
        destination.directoryHandle = directoryHandle;
        destination.pendingDirectoryHandle = null;
        destination.useSaveAs = false;
        destinationName.textContent = directoryHandle.name;
        destinationName.title = directoryHandle.name;
        chooseButton.textContent = "変更…";
        return;
      }

      destination.directoryHandle = null;
      destination.pendingDirectoryHandle = directoryHandle;
      destinationName.textContent = `${directoryHandle.name}（要再許可）`;
      destinationName.title = "クリックして保存先へのアクセスを再許可してください";
      chooseButton.textContent = "再許可…";
    } catch (error) {
      console.warn("[Test Evidence Capture] Could not restore capture directory.", error);
    }
  }

  function createField(labelText, input) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = labelText;
    setImportantStyles(label, {
      all: "initial",
      display: "grid",
      gap: "3px",
      color: "#515154",
      font: "11px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
    });
    setImportantStyles(caption, {
      all: "initial",
      display: "block",
      color: "#515154",
      font: "11px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      whiteSpace: "nowrap",
    });
    label.append(caption, input);
    return label;
  }

  function createOptionalField(labelText, input, checkbox) {
    const field = document.createElement("div");
    const captionRow = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = labelText;
    setImportantStyles(field, {
      all: "initial",
      display: "grid",
      gap: "3px",
    });
    setImportantStyles(captionRow, {
      all: "initial",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "2px",
    });
    setImportantStyles(caption, {
      all: "initial",
      display: "block",
      color: "#515154",
      font: "11px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      whiteSpace: "nowrap",
    });
    captionRow.append(caption, checkbox);
    field.append(captionRow, input);
    return field;
  }

  function setInputStyles(input, width) {
    setImportantStyles(input, {
      all: "initial",
      display: "block",
      boxSizing: "border-box",
      width,
      height: "30px",
      padding: "4px 6px",
      border: "1px solid #b8b8bd",
      borderRadius: "5px",
      background: "#ffffff",
      color: "#1d1d1f",
      font: "13px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      textAlign: "left",
      pointerEvents: "auto",
    });
    if (input.type === "number") {
      input.style.setProperty("appearance", "auto", "important");
    }
  }

  function setNumberInputEnabled(input, enabled) {
    input.disabled = !enabled;
    input.style.setProperty("background", enabled ? "#ffffff" : "#e5e5e7", "important");
    input.style.setProperty("color", enabled ? "#1d1d1f" : "#8e8e93", "important");
  }

  function createTimingButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    setImportantStyles(button, {
      all: "initial",
      display: "block",
      boxSizing: "border-box",
      padding: "6px 8px",
      borderRadius: "5px",
      color: "#3a3a3c",
      font: "600 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      textAlign: "center",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    return button;
  }

  function createSecondaryButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    setImportantStyles(button, {
      all: "initial",
      display: "block",
      boxSizing: "border-box",
      padding: "5px 9px",
      border: "1px solid #b8b8bd",
      borderRadius: "5px",
      background: "#ffffff",
      color: "#1d1d1f",
      font: "600 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      pointerEvents: "auto",
    });
    return button;
  }

  function setTimingButtonState(button, selected) {
    button.setAttribute("aria-pressed", String(selected));
    button.style.setProperty("background", selected ? "#8e8e93" : "transparent", "important");
    button.style.setProperty("color", selected ? "#ffffff" : "#3a3a3c", "important");
  }

  function createBox(borderColor, backgroundColor) {
    const box = document.createElement("div");
    setImportantStyles(box, {
      all: "initial",
      display: "none",
      position: "fixed",
      boxSizing: "border-box",
      border: `2px solid ${borderColor}`,
      background: backgroundColor,
      boxShadow: `0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 3px ${borderColor}`,
      pointerEvents: "none",
    });
    return box;
  }

  function createCaptureBoundsBox() {
    const box = createBox("#30a46c", "rgba(48, 164, 108, 0.04)");
    box.style.setProperty("border-style", "dashed", "important");
    box.style.setProperty("box-shadow", "0 0 0 1px rgba(255, 255, 255, 0.9)", "important");
    const label = document.createElement("span");
    label.textContent = "スクショ範囲";
    setImportantStyles(label, {
      all: "initial",
      position: "absolute",
      top: "2px",
      left: "2px",
      padding: "2px 5px",
      borderRadius: "3px",
      background: "#30a46c",
      color: "#ffffff",
      font: "700 10px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    box.append(label);
    return box;
  }

  function createAnnotationBox() {
    const box = document.createElement("div");
    setImportantStyles(box, {
      all: "initial",
      display: "none",
      position: "fixed",
      boxSizing: "border-box",
      border: `${TestEvidenceAnnotations.FRAME_BORDER_CSS_PX}px solid ${TestEvidenceAnnotations.FRAME_COLOR}`,
      background: "transparent",
      pointerEvents: "none",
    });
    return box;
  }

  function handlePointerMove(event) {
    if (!session?.active || session.capturing) {
      return;
    }

    const pointerChanged =
      !session.pointer ||
      session.pointer.x !== event.clientX ||
      session.pointer.y !== event.clientY;
    session.pointer = { x: event.clientX, y: event.clientY };

    if (pointerChanged) {
      session.hoverElement = selectableElementAt(event.clientX, event.clientY);
      session.childHistory = [];
    }
  }

  function handlePointerDown(event) {
    if (!session?.active) {
      return;
    }

    if (session.capturing) {
      suppressEvent(event);
      return;
    }

    if (isToolEvent(event)) {
      return;
    }

    if (event.button !== 2) {
      return;
    }
    suppressEvent(event);

    const target = session.hoverElement || selectableElementAt(event.clientX, event.clientY);
    if (!target) {
      return;
    }

    selectElement(target, event.shiftKey, "click");
  }

  function suppressPageMouseEvent(event) {
    if (
      session?.active &&
      !isToolEvent(event) &&
      (session.capturing || event.button === 2 || event.type === "contextmenu")
    ) {
      suppressEvent(event);
    }
  }

  function handleKeyDown(event) {
    if (!session?.active) {
      return;
    }

    if (event.key === "Escape") {
      suppressEvent(event);
      endCaptureMode();
      return;
    }

    if (session.capturing) {
      suppressEvent(event);
      return;
    }

    if (event.key === "Enter") {
      suppressEvent(event);
      void captureSelection();
      return;
    }

    // Prefer the element currently under the pointer so Space provides
    // click-free selection without dismissing transient UI.
    if (
      (event.code === "Space" || event.key === " ") &&
      session.hoverElement?.isConnected
    ) {
      suppressEvent(event);
      if (!event.repeat) {
        selectElement(session.hoverElement, event.shiftKey, "space");
      }
      return;
    }

    // Keep ArrowUp/ArrowDown available to number inputs while the filename
    // panel has focus. Other panel keystrokes must not navigate the DOM tree.
    if (isToolEvent(event)) {
      return;
    }

    if (event.key === "ArrowUp") {
      suppressEvent(event);
      moveToParent();
      return;
    }

    if (event.key === "ArrowDown") {
      suppressEvent(event);
      moveToPreviousChild();
      return;
    }

    if (event.code === "Space" || event.key === " ") {
      suppressEvent(event);
      return;
    }

  }

  function handleWindowBlur() {
    // Release any remembered pointer ancestry. The mode remains active so the
    // user can return without losing selections.
    if (session?.active) {
      session.childHistory = [];
      session.pointer = null;
    }
  }

  function handleViewportChange() {
    if (!session?.active || !session.pointer) {
      return;
    }

    session.hoverElement = selectableElementAt(session.pointer.x, session.pointer.y);
    session.childHistory = [];
  }

  function moveToParent() {
    const current = session?.hoverElement;
    if (!current || current === document.body) {
      return;
    }

    const parent = current.parentElement;
    if (!parent || parent === document.documentElement) {
      return;
    }

    session.childHistory.push(current);
    session.hoverElement = parent;
  }

  function moveToPreviousChild() {
    if (!session || session.childHistory.length === 0) {
      return;
    }

    const child = session.childHistory.pop();
    if (child?.isConnected) {
      session.hoverElement = child;
    }
  }

  function selectableElementAt(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!(element instanceof Element)) {
      return null;
    }

    if (element === document.documentElement || element.closest(`[${TOOL_ATTRIBUTE}]`)) {
      return null;
    }
    return findDisabledElementAtPoint(element, x, y) || element;
  }

  function findDisabledElementAtPoint(hitElement, x, y) {
    const selector = ':disabled, [aria-disabled="true"]';
    const candidates = [
      ...(hitElement.matches(selector) ? [hitElement] : []),
      ...hitElement.querySelectorAll(selector),
    ].filter((element) => {
      if (element.closest(`[${TOOL_ATTRIBUTE}]`) || !isVisible(element)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      );
    });

    return candidates.reduce((best, candidate) => {
      if (!best || best.contains(candidate)) {
        return candidate;
      }
      if (candidate.contains(best)) {
        return best;
      }
      const bestRect = best.getBoundingClientRect();
      const candidateRect = candidate.getBoundingClientRect();
      return candidateRect.width * candidateRect.height < bestRect.width * bestRect.height
        ? candidate
        : best;
    }, null);
  }

  function addSelection(element) {
    if (!session || session.selectedElements.has(element)) {
      return;
    }

    session.selectedElements.add(element);
    const box = createBox("#0a84ff", "rgba(10, 132, 255, 0.12)");
    session.selectedBoxes.set(element, box);
    session.selectedLayer.append(box);
    renderSelectionList();
  }

  function selectElement(element, additive, source) {
    if (!session || !element?.isConnected) {
      return;
    }

    if (additive) {
      if (session.selectedElements.has(element)) {
        removeSelection(element);
      } else {
        addSelection(element);
      }
    } else {
      clearSelections();
      addSelection(element);
    }

    session.showTooltipFeedback = source === "space" && session.selectedElements.size > 0;
    if (!session.showTooltipFeedback) {
      clearTooltipFeedback();
    }

    const includesVisibleTooltip =
      session.showTooltipFeedback &&
      session.filenameControls.includeTooltipsCheckbox.checked &&
      findVisibleTooltipTargets({ width: window.innerWidth, height: window.innerHeight }).length > 0;
    setStatus(
      includesVisibleTooltip
        ? `Spaceで${session.selectedElements.size}件選択済み · Tooltipも紫枠で撮影対象 · 撮影ボタン/Enterで保存`
        : `${source === "space" ? "Spaceで" : ""}${session.selectedElements.size}件選択中 · Shiftで追加・解除 · 撮影ボタン/Enterで保存`,
    );
  }

  function removeSelection(element) {
    if (!session) {
      return;
    }

    setElementAnnotated(element, false);
    session.selectedElements.delete(element);
    session.selectedBoxes.get(element)?.remove();
    session.selectedBoxes.delete(element);
    renderSelectionList();
  }

  function setElementAnnotated(element, annotated) {
    if (!session || !session.selectedElements.has(element)) {
      return;
    }
    if (annotated) {
      if (session.annotatedElements.has(element)) {
        return;
      }
      session.annotatedElements.add(element);
      const box = createAnnotationBox();
      session.annotationBoxes.set(element, box);
      session.annotationLayer.append(box);
      return;
    }

    session.annotatedElements.delete(element);
    session.annotationBoxes.get(element)?.remove();
    session.annotationBoxes.delete(element);
  }

  function renderSelectionList() {
    if (!session?.selectionList || !session.selectionSummary) {
      return;
    }

    const elements = [...session.selectedElements].filter((element) => element.isConnected);
    session.selectionSummary.textContent = `選択中のDOM（${elements.length}）`;
    session.selectionList.replaceChildren();
    if (elements.length === 0) {
      const empty = document.createElement("span");
      empty.textContent = "DOMが選択されていません";
      setImportantStyles(empty, {
        all: "initial",
        display: "block",
        padding: "5px",
        color: "#8e8e93",
        font: "11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      });
      session.selectionList.append(empty);
      return;
    }

    for (const [index, element] of elements.entries()) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = session.annotatedElements.has(element);
      checkbox.setAttribute("aria-label", `${describeElement(element)}を赤枠で囲う`);
      setImportantStyles(checkbox, {
        all: "initial",
        display: "block",
        flex: "0 0 auto",
        width: "13px",
        height: "13px",
        appearance: "auto",
        cursor: "pointer",
        pointerEvents: "auto",
      });
      checkbox.addEventListener("change", () => {
        setElementAnnotated(element, checkbox.checked);
      });

      const description = describeElement(element);
      const labelText = document.createElement("span");
      labelText.textContent = `${index + 1}. ${description}`;
      labelText.title = description;
      setImportantStyles(labelText, {
        all: "initial",
        display: "block",
        minWidth: "0",
        overflow: "hidden",
        color: "#3a3a3c",
        font: "11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });

      const row = document.createElement("label");
      row.setAttribute("role", "listitem");
      setImportantStyles(row, {
        all: "initial",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: "0",
        padding: "4px 5px",
        borderRadius: "4px",
        background: checkbox.checked ? "rgba(255, 59, 48, 0.08)" : "transparent",
        cursor: "pointer",
        pointerEvents: "auto",
      });
      checkbox.addEventListener("change", () => {
        row.style.setProperty(
          "background",
          checkbox.checked ? "rgba(255, 59, 48, 0.08)" : "transparent",
          "important",
        );
      });
      row.append(checkbox, labelText);
      session.selectionList.append(row);
    }
  }

  function describeElement(element) {
    const tagName = element.localName || "element";
    const idPart = element.id ? `#${element.id}` : "";
    const classPart = [...element.classList]
      .slice(0, 3)
      .map((className) => `.${className}`)
      .join("");
    const text = String(element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    return `${tagName}${idPart}${classPart}${text ? ` — ${text}` : ""}`;
  }

  function clearSelections() {
    if (!session) {
      return;
    }
    for (const element of [...session.selectedElements]) {
      removeSelection(element);
    }
  }

  function renderOverlays() {
    if (!session?.active) {
      return;
    }

    if (session.hoverElement?.isConnected) {
      positionBox(session.hoverBox, session.hoverElement.getBoundingClientRect());
    } else {
      session.hoverElement = null;
      session.hoverBox.style.setProperty("display", "none", "important");
    }

    for (const element of [...session.selectedElements]) {
      if (!element.isConnected) {
        removeSelection(element);
        continue;
      }
      positionBox(session.selectedBoxes.get(element), element.getBoundingClientRect());
    }
    for (const element of [...session.annotatedElements]) {
      if (!element.isConnected || !session.selectedElements.has(element)) {
        setElementAnnotated(element, false);
        continue;
      }
      positionAnnotationBox(
        session.annotationBoxes.get(element),
        element.getBoundingClientRect(),
      );
    }
    renderTooltipFeedback();
    const captureBounds = calculateCurrentCaptureBounds({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    if (captureBounds) {
      positionBox(session.captureBoundsBox, captureBounds);
    } else {
      session.captureBoundsBox.style.setProperty("display", "none", "important");
    }

    session.animationFrame = requestAnimationFrame(renderOverlays);
  }

  function renderTooltipFeedback() {
    if (
      !session?.showTooltipFeedback ||
      session.selectedElements.size === 0 ||
      !session.filenameControls.includeTooltipsCheckbox.checked
    ) {
      clearTooltipFeedback();
      return;
    }

    const targets = findVisibleTooltipTargets({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    while (session.tooltipBoxes.length < targets.length) {
      const box = createBox("#bf5af2", "rgba(191, 90, 242, 0.12)");
      box.style.setProperty("border-style", "dashed", "important");
      session.tooltipLayer.append(box);
      session.tooltipBoxes.push(box);
    }
    while (session.tooltipBoxes.length > targets.length) {
      session.tooltipBoxes.pop().remove();
    }
    targets.forEach((target, index) => {
      positionBox(session.tooltipBoxes[index], target.getBoundingClientRect());
    });
  }

  function clearTooltipFeedback() {
    if (!session) {
      return;
    }
    for (const box of session.tooltipBoxes) {
      box.remove();
    }
    session.tooltipBoxes.length = 0;
  }

  function positionBox(box, rect) {
    if (!box || rect.width <= 0 || rect.height <= 0) {
      box?.style.setProperty("display", "none", "important");
      return;
    }

    setImportantStyles(box, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  function positionAnnotationBox(box, elementRect) {
    const frameRect = TestEvidenceAnnotations.calculateFrameRect(
      elementRect,
      window.innerWidth,
      window.innerHeight,
    );
    if (!frameRect) {
      box?.style.setProperty("display", "none", "important");
      return;
    }
    positionBox(box, frameRect);
  }

  async function captureSelection() {
    if (!session || session.selectedElements.size === 0) {
      setStatus("要素を選択してください · 右クリック/Spaceで選択 · Escで終了");
      return;
    }

    const elements = [...session.selectedElements].filter((element) => element.isConnected);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const documentSurface = getDocumentSurface();
    const captureBeyondViewport =
      session.filenameControls.captureBeyondViewportCheckbox.checked;
    if (
      !captureBeyondViewport &&
      elements.some((element) => !isVisibleRect(element.getBoundingClientRect(), viewport))
    ) {
      setStatus(
        "viewport外の選択DOMがあります · 自動スクロール撮影をONにするか対象を解除してください",
      );
      return;
    }

    const viewportBounds = captureBeyondViewport
      ? null
      : calculateCaptureBoundsForElements(elements, viewport);
    const bounds = captureBeyondViewport
      ? calculateDocumentCaptureBounds(elements, viewport, documentSurface)
      : viewportBounds
        ? toDocumentRect(viewportBounds)
        : null;
    if (!bounds) {
      setStatus("選択DOMの撮影範囲を計算できませんでした");
      return;
    }

    const selectors = elements.map(createElementLocator);
    if (selectors.some((selector) => !selector)) {
      setStatus("選択DOMの履歴情報を作成できませんでした");
      return;
    }

    const annotationIndexes = elements.flatMap((element, index) =>
      session.annotatedElements.has(element) ? [index] : [],
    );
    const annotationRects = captureBeyondViewport
      ? calculateDocumentAnnotationRects(elements, annotationIndexes, documentSurface)
      : calculateViewportAnnotationRects(elements, annotationIndexes, viewport);
    await captureBounds(bounds, selectors, annotationIndexes, annotationRects);
  }

  function restoreHistoryRecord(record) {
    if (!session?.active || session.capturing) {
      return;
    }

    const elements = resolveHistoryElements(record.selectors);
    if (!elements) {
      setStatus("履歴のDOM要素を解決できません。ページ構造が変わった可能性があります");
      return;
    }

    const annotationIndexes = TestEvidenceHistory.normalizeAnnotationIndexes(
      record.annotationIndexes,
      elements.length,
    );
    clearSelections();
    for (const element of elements) {
      addSelection(element);
    }
    for (const index of annotationIndexes) {
      setElementAnnotated(elements[index], true);
    }
    renderSelectionList();
    session.selectionDetails.open = true;
    elements[0].scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    setStatus(
      `履歴から${elements.length}件を選択しました · 範囲を確認して撮影ボタン/Enterで保存`,
    );
  }

  async function captureBounds(
    bounds,
    selectors,
    annotationIndexes = [],
    annotationRects = [],
  ) {
    if (!session?.active || session.capturing) {
      return;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const filename = createFilenameFromControls(session.filenameControls);
    const destination = session.filenameControls.getDestination();
    const captureSession = session;
    captureSession.capturing = true;
    captureSession.captureButton.disabled = true;
    captureSession.captureButton.style.setProperty("opacity", "0.55", "important");
    captureSession.host.style.setProperty("display", "none", "important");
    let uiHidden = true;
    let completionMessage = null;

    try {
      const croppedPng = await captureDocumentBounds(bounds, annotationRects);
      if (session !== captureSession) {
        return;
      }

      captureSession.host.style.removeProperty("display");
      uiHidden = false;
      setStatus(`保存中: ${filename}`);
      if (destination.directoryHandle) {
        try {
          const savedFilename = await TestEvidenceStorage.savePngToDirectory(
            destination.directoryHandle,
            filename,
            croppedPng,
          );
          completionMessage = `保存しました: ${savedFilename}`;
          await rememberCapture(
            bounds,
            selectors,
            annotationIndexes,
            savedFilename,
            viewport,
          );
          return;
        } catch (error) {
          console.warn(
            "[Test Evidence Capture] Direct folder save failed; falling back to Save As.",
            error,
          );
          destination.useSaveAs = true;
        }
      }
      if (session !== captureSession) {
        return;
      }

      const download = await sendMessage({
        type: MESSAGE.DOWNLOAD_PNG,
        dataUrl: croppedPng,
        filename,
        saveAs: destination.useSaveAs,
      });
      if (!download?.ok) {
        throw new Error(download?.error || "PNG download failed.");
      }
      completionMessage = `保存しました: ${filename}`;
      await rememberCapture(bounds, selectors, annotationIndexes, filename, viewport);
    } catch (error) {
      console.error("[Test Evidence Capture]", error);
      completionMessage = `保存に失敗しました: ${error.message || "Consoleを確認してください"}`;
    } finally {
      if (session === captureSession) {
        if (uiHidden) {
          captureSession.host.style.removeProperty("display");
        }
        captureSession.capturing = false;
        captureSession.captureButton.disabled = false;
        captureSession.captureButton.style.setProperty("opacity", "1", "important");
        setStatus(
          completionMessage ||
            "撮影モード中 · 右クリック/Spaceで選択 · Shiftで追加 · 撮影ボタン/Enterで保存 · Escで終了",
        );
      }
    }
  }

  async function loadCaptureHistory(targetSession) {
    try {
      const stored = await getLocalStorage(CAPTURE_HISTORY_KEY);
      if (session !== targetSession) {
        return;
      }
      targetSession.historyRecords = TestEvidenceHistory.normalizeRecords(
        stored,
        CAPTURE_HISTORY_LIMIT,
      );
      renderCaptureHistory();
    } catch (error) {
      console.warn("[Test Evidence Capture] Could not load capture history.", error);
      if (session === targetSession) {
        renderCaptureHistory();
      }
    }
  }

  async function loadInputSettings(targetSession) {
    try {
      const stored = await getLocalStorage(INPUT_SETTINGS_KEY);
      if (session !== targetSession || targetSession.filenameControls.settingsDirty) {
        return;
      }
      applyInputSettings(
        targetSession.filenameControls,
        normalizeInputSettings(stored),
      );
    } catch (error) {
      console.warn("[Test Evidence Capture] Could not load input settings.", error);
    }
  }

  function saveInputSettings(controls) {
    const settings = readInputSettings(controls);
    inputSettingsSave = inputSettingsSave
      .catch(() => {})
      .then(() => setLocalStorage(INPUT_SETTINGS_KEY, settings));
    return inputSettingsSave.catch((error) => {
      console.warn("[Test Evidence Capture] Could not persist input settings.", error);
    });
  }

  function readInputSettings(controls) {
    return normalizeInputSettings({
      prefix: controls.prefixInput.value,
      numbers: controls.numberInputs.map((input) => input.value),
      numberEnabled: [
        true,
        controls.optionalNumberCheckboxes[0].checked,
        controls.optionalNumberCheckboxes[1].checked,
      ],
      timing: controls.getTiming(),
      timingEnabled: controls.timingEnabledCheckbox.checked,
      includeTooltips: controls.includeTooltipsCheckbox.checked,
      captureBeyondViewport: controls.captureBeyondViewportCheckbox.checked,
    });
  }

  function normalizeInputSettings(value) {
    const secondEnabled = value?.numberEnabled?.[1] !== false;
    return {
      prefix:
        typeof value?.prefix === "string"
          ? value.prefix.slice(0, 20)
          : DEFAULT_INPUT_SETTINGS.prefix,
      numbers: [0, 1, 2].map((index) =>
        TestEvidenceFilename.normalizeNumber(value?.numbers?.[index]),
      ),
      numberEnabled: [
        true,
        secondEnabled,
        secondEnabled && value?.numberEnabled?.[2] !== false,
      ],
      timing: ["before", "after", "result"].includes(value?.timing)
        ? value.timing
        : DEFAULT_INPUT_SETTINGS.timing,
      timingEnabled: value?.timingEnabled !== false,
      includeTooltips: value?.includeTooltips !== false,
      captureBeyondViewport: value?.captureBeyondViewport === true,
    };
  }

  function applyInputSettings(controls, settings) {
    const normalized = normalizeInputSettings(settings);
    controls.prefixInput.value = normalized.prefix;
    controls.numberInputs.forEach((input, index) => {
      input.value = String(normalized.numbers[index]);
    });
    controls.optionalNumberCheckboxes[0].checked = normalized.numberEnabled[1];
    controls.optionalNumberCheckboxes[1].checked = normalized.numberEnabled[2];
    controls.syncOptionalNumbers();
    controls.setTiming(normalized.timing);
    controls.timingEnabledCheckbox.checked = normalized.timingEnabled;
    controls.syncTimingEnabled();
    controls.includeTooltipsCheckbox.checked = normalized.includeTooltips;
    controls.captureBeyondViewportCheckbox.checked = normalized.captureBeyondViewport;
  }

  async function rememberCapture(
    bounds,
    selectors,
    annotationIndexes,
    filename,
    viewport,
  ) {
    try {
      const stored = await getLocalStorage(CAPTURE_HISTORY_KEY);
      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageKey: currentPageKey(),
        filename,
        createdAt: Date.now(),
        selectors: [...selectors],
        annotationIndexes: [...annotationIndexes],
        viewport,
        bounds: {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        },
      };
      const nextRecords = TestEvidenceHistory.addRecord(
        stored,
        record,
        CAPTURE_HISTORY_LIMIT,
      );
      await setLocalStorage(CAPTURE_HISTORY_KEY, nextRecords);
      if (session?.active) {
        session.historyRecords = nextRecords;
        renderCaptureHistory();
      }
    } catch (error) {
      console.warn("[Test Evidence Capture] Could not persist capture history.", error);
    }
  }

  function renderCaptureHistory() {
    if (!session?.historyList) {
      return;
    }

    session.historyList.replaceChildren();
    const records = session.historyRecords.filter((record) => record.pageKey === currentPageKey());
    if (records.length === 0) {
      const empty = document.createElement("span");
      empty.textContent = "このページの履歴はありません";
      setImportantStyles(empty, {
        all: "initial",
        display: "block",
        color: "#8e8e93",
        font: "11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif",
      });
      session.historyList.append(empty);
      return;
    }

    for (const record of records) {
      const width = record.bounds.width ?? record.bounds.right - record.bounds.left;
      const height = record.bounds.height ?? record.bounds.bottom - record.bounds.top;
      const button = createSecondaryButton(record.filename);
      button.title = `クリックで選択を復元 · ${record.filename} · ${record.selectors.length} DOM · 赤枠 ${record.annotationIndexes.length}件 · 撮影時 ${Math.round(width)}×${Math.round(height)} CSS px`;
      setImportantStyles(button, {
        width: "100%",
        overflow: "hidden",
        textAlign: "left",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      button.addEventListener("click", () => {
        restoreHistoryRecord(record);
      });
      session.historyList.append(button);
    }
  }

  function currentPageKey() {
    return `${location.origin}${location.pathname}`;
  }

  function currentDocumentKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function createElementLocator(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return null;
    }

    const directSelector = createUniqueElementSelector(element);
    if (directSelector) {
      return directSelector;
    }

    const segments = [];
    let current = element;
    while (current instanceof Element) {
      const anchorSelector = createUniqueElementSelector(current);
      if (anchorSelector) {
        segments.unshift(anchorSelector);
        break;
      }

      const tagName = current.localName;
      if (!tagName) {
        return null;
      }
      const sameTagSiblings = current.parentElement
        ? [...current.parentElement.children].filter((sibling) => sibling.localName === tagName)
        : [current];
      segments.unshift(`${tagName}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }

    const selector = segments.join(" > ");
    return selector && document.querySelector(selector) === element ? selector : null;
  }

  function createUniqueElementSelector(element) {
    for (const attribute of ["data-testid", "data-test", "data-cy", "data-test-id"]) {
      const value = element.getAttribute(attribute);
      if (!value) {
        continue;
      }
      const selector = `[${attribute}="${escapeCssString(value)}"]`;
      if (isUniqueSelector(selector, element)) {
        return selector;
      }
    }

    if (element.id) {
      const selector = `#${escapeCssIdentifier(element.id)}`;
      if (isUniqueSelector(selector, element)) {
        return selector;
      }
    }
    return null;
  }

  function isUniqueSelector(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch (_error) {
      return false;
    }
  }

  function escapeCssString(value) {
    return value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "\\a ")
      .replaceAll("\r", "\\d ")
      .replaceAll("\f", "\\c ");
  }

  function escapeCssIdentifier(value) {
    if (globalThis.CSS?.escape) {
      return globalThis.CSS.escape(value);
    }
    return [...value]
      .map((character) => (/^[a-zA-Z0-9_-]$/.test(character) ? character : `\\${character}`))
      .join("");
  }

  function resolveHistoryElements(selectors) {
    if (!Array.isArray(selectors) || selectors.length === 0) {
      return null;
    }
    try {
      const elements = selectors.map((selector) => document.querySelector(selector));
      return elements.every((element) => element instanceof Element) ? elements : null;
    } catch (_error) {
      return null;
    }
  }

  function getLocalStorage(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function setLocalStorage(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function calculateCurrentCaptureBounds(viewport) {
    if (!session || session.selectedElements.size === 0) {
      return null;
    }

    const connectedElements = [...session.selectedElements].filter((element) => element.isConnected);
    return calculateCaptureBoundsForElements(connectedElements, viewport);
  }

  function calculateCaptureBoundsForElements(elements, viewport) {
    if (!session || elements.length === 0) {
      return null;
    }

    const visibleTooltips = session.filenameControls.includeTooltipsCheckbox.checked
      ? findVisibleTooltipTargets(viewport)
      : [];
    return TestEvidenceBounds.calculateBounds(
      [...new Set([...elements, ...visibleTooltips])],
      viewport.width,
      viewport.height,
      PADDING_CSS_PX,
    );
  }

  function calculateDocumentCaptureBounds(elements, viewport, documentSurface) {
    const visibleTooltips = session.filenameControls.includeTooltipsCheckbox.checked
      ? findVisibleTooltipTargets(viewport)
      : [];
    const targets = [...new Set([...elements, ...visibleTooltips])].map((element) => {
      const rect = toDocumentRect(element.getBoundingClientRect());
      return { getBoundingClientRect: () => rect };
    });
    return TestEvidenceBounds.calculateBounds(
      targets,
      documentSurface.width,
      documentSurface.height,
      PADDING_CSS_PX,
    );
  }

  function calculateDocumentAnnotationRects(elements, annotationIndexes, documentSurface) {
    return annotationIndexes
      .map((index) => elements[index])
      .filter((element) => element?.isConnected)
      .map((element) => {
        const documentRect = toDocumentRect(element.getBoundingClientRect());
        return TestEvidenceAnnotations.calculateFrameRect(
          documentRect,
          documentSurface.width,
          documentSurface.height,
        );
      })
      .filter(Boolean);
  }

  function calculateViewportAnnotationRects(elements, annotationIndexes, viewport) {
    return annotationIndexes
      .map((index) => elements[index])
      .filter((element) => element?.isConnected)
      .map((element) =>
        TestEvidenceAnnotations.calculateFrameRect(
          element.getBoundingClientRect(),
          viewport.width,
          viewport.height,
        ),
      )
      .filter(Boolean)
      .map(toDocumentRect);
  }

  function toDocumentRect(rect) {
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;
    const right = rect.right + window.scrollX;
    const bottom = rect.bottom + window.scrollY;
    return { left, top, right, bottom, width: rect.width, height: rect.height };
  }

  function getDocumentSurface() {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(window.innerWidth, root.scrollWidth, body?.scrollWidth || 0),
      height: Math.max(window.innerHeight, root.scrollHeight, body?.scrollHeight || 0),
    };
  }

  function findVisibleTooltipTargets(viewport) {
    const targets = [
      ...document.querySelectorAll('[role="tooltip"], .tooltip > .tooltip-content'),
    ].filter((element) => isVisibleRect(element.getBoundingClientRect(), viewport) && isVisible(element));

    for (const host of document.querySelectorAll('.tooltip[data-tip]')) {
      if (!host.getAttribute("data-tip") || !isVisible(host)) {
        continue;
      }

      const pseudoRects = [];
      for (const pseudoElement of ["::before", "::after"]) {
        const style = getComputedStyle(host, pseudoElement);
        if (!isVisibleStyle(style)) {
          continue;
        }

        const rect = TestEvidenceBounds.calculatePseudoElementRect(
          host.getBoundingClientRect(),
          style,
        );
        if (rect && isVisibleRect(rect, viewport)) {
          pseudoRects.push(rect);
        }
      }
      if (pseudoRects.length > 0) {
        const rect = unionRects(pseudoRects);
        targets.push({ getBoundingClientRect: () => rect });
      }
    }

    return targets;
  }

  function isVisible(element) {
    return (
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      isVisibleStyle(getComputedStyle(element))
    );
  }

  function isVisibleStyle(style) {
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0.01
    );
  }

  function isVisibleRect(rect, viewport) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < viewport.width &&
      rect.top < viewport.height
    );
  }

  function unionRects(rects) {
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function endCaptureMode() {
    if (!session) {
      return;
    }

    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("pointerdown", handlePointerDown, true);
    for (const eventName of BLOCKED_MOUSE_EVENTS) {
      window.removeEventListener(eventName, suppressPageMouseEvent, true);
    }
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("blur", handleWindowBlur, true);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange, true);
    cancelAnimationFrame(session.animationFrame);
    session.host.remove();
    session.selectedElements.clear();
    session.selectedBoxes.clear();
    session.annotatedElements.clear();
    session.annotationBoxes.clear();
    clearTooltipFeedback();
    session.childHistory.length = 0;
    session = null;
    void notifyCaptureModeState(false);
  }

  async function captureDocumentBounds(bounds, annotationRects = []) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const surface = getDocumentSurface();
    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const xPositions = TestEvidenceBounds.calculateScrollPositions(
      bounds.left,
      bounds.right,
      viewport.width,
      Math.max(0, surface.width - viewport.width),
      originalScroll.x,
    );
    const yPositions = TestEvidenceBounds.calculateScrollPositions(
      bounds.top,
      bounds.bottom,
      viewport.height,
      Math.max(0, surface.height - viewport.height),
      originalScroll.y,
    );
    const tileCount = xPositions.length * yPositions.length;
    if (tileCount > MAX_CAPTURE_TILES) {
      throw new Error(`撮影範囲が広すぎます（最大${MAX_CAPTURE_TILES}画面）`);
    }

    let canvas = null;
    let context = null;
    let scaleX = null;
    let scaleY = null;
    let captureIndex = 0;

    try {
      for (const y of yPositions) {
        for (const x of xPositions) {
          window.scrollTo({ left: x, top: y, behavior: "instant" });
          await nextAnimationFrame();
          await nextAnimationFrame();
          if (captureIndex > 0) {
            await delay(CAPTURE_INTERVAL_MS);
          }

          const tileScroll = { x: window.scrollX, y: window.scrollY };
          const capture = await sendMessage({ type: MESSAGE.CAPTURE_VISIBLE_TAB });
          if (!capture?.ok) {
            throw new Error(capture?.error || "Screenshot capture failed.");
          }
          const image = await loadImage(capture.dataUrl);
          const tileScaleX = image.naturalWidth / viewport.width;
          const tileScaleY = image.naturalHeight / viewport.height;
          if (!canvas) {
            scaleX = tileScaleX;
            scaleY = tileScaleY;
            const outputWidth = Math.ceil(bounds.width * scaleX);
            const outputHeight = Math.ceil(bounds.height * scaleY);
            if (
              outputWidth > MAX_OUTPUT_DIMENSION_PX ||
              outputHeight > MAX_OUTPUT_DIMENSION_PX ||
              outputWidth * outputHeight > MAX_OUTPUT_PIXELS
            ) {
              throw new Error("撮影範囲が画像サイズの上限を超えています");
            }
            canvas = document.createElement("canvas");
            canvas.width = outputWidth;
            canvas.height = outputHeight;
            context = canvas.getContext("2d");
            if (!context) {
              throw new Error("Canvas 2D is unavailable.");
            }
          } else if (
            Math.abs(tileScaleX - scaleX) > 0.01 ||
            Math.abs(tileScaleY - scaleY) > 0.01
          ) {
            throw new Error("撮影中にブラウザの画像倍率が変化しました");
          }

          drawCapturedTile(
            context,
            image,
            bounds,
            viewport,
            tileScroll,
            scaleX,
            scaleY,
          );
          captureIndex += 1;
        }
      }

      if (!canvas || !context || scaleX === null || scaleY === null) {
        throw new Error("スクリーンショットを取得できませんでした");
      }
      drawAnnotationFrames(context, annotationRects, {
        left: bounds.left * scaleX,
        top: bounds.top * scaleY,
        width: canvas.width,
        height: canvas.height,
        scaleX,
        scaleY,
      });
      return canvas.toDataURL("image/png");
    } finally {
      window.scrollTo({
        left: originalScroll.x,
        top: originalScroll.y,
        behavior: "instant",
      });
      await nextAnimationFrame();
      await nextAnimationFrame();
    }
  }

  function drawCapturedTile(context, image, bounds, viewport, tileScroll, scaleX, scaleY) {
    const left = Math.max(bounds.left, tileScroll.x);
    const top = Math.max(bounds.top, tileScroll.y);
    const right = Math.min(bounds.right, tileScroll.x + viewport.width);
    const bottom = Math.min(bounds.bottom, tileScroll.y + viewport.height);
    if (right <= left || bottom <= top) {
      return;
    }

    context.drawImage(
      image,
      (left - tileScroll.x) * scaleX,
      (top - tileScroll.y) * scaleY,
      (right - left) * scaleX,
      (bottom - top) * scaleY,
      (left - bounds.left) * scaleX,
      (top - bounds.top) * scaleY,
      (right - left) * scaleX,
      (bottom - top) * scaleY,
    );
  }

  function drawAnnotationFrames(context, annotationRects, crop) {
    context.save();
    context.fillStyle = TestEvidenceAnnotations.FRAME_COLOR;
    for (const frameRect of annotationRects) {
      const pixelRect = TestEvidenceAnnotations.mapFrameToCrop(frameRect, crop);
      if (!pixelRect) {
        continue;
      }

      const horizontalThickness = Math.min(pixelRect.height, pixelRect.borderWidthY);
      const verticalThickness = Math.min(pixelRect.width, pixelRect.borderWidthX);
      context.fillRect(
        pixelRect.left,
        pixelRect.top,
        pixelRect.width,
        horizontalThickness,
      );
      context.fillRect(
        pixelRect.left,
        pixelRect.bottom - horizontalThickness,
        pixelRect.width,
        horizontalThickness,
      );
      context.fillRect(
        pixelRect.left,
        pixelRect.top,
        verticalThickness,
        pixelRect.height,
      );
      context.fillRect(
        pixelRect.right - verticalThickness,
        pixelRect.top,
        verticalThickness,
        pixelRect.height,
      );
    }
    context.restore();
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The captured PNG could not be decoded."));
      image.src = dataUrl;
    });
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function createFilenameFromControls(controls) {
    return TestEvidenceFilename.createEvidenceFilename({
      prefix: controls.prefixInput.value,
      numbers: controls.numberInputs.map((input) => input.value),
      numberEnabled: [
        true,
        controls.optionalNumberCheckboxes[0].checked,
        controls.optionalNumberCheckboxes[1].checked,
      ],
      timing: controls.getTiming(),
      timingEnabled: controls.timingEnabledCheckbox.checked,
    });
  }

  function setStatus(text) {
    if (session?.status) {
      session.status.textContent = text;
    }
  }

  function suppressEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function isToolEvent(event) {
    return Boolean(session?.host && event.composedPath().includes(session.host));
  }

  function setImportantStyles(element, styles) {
    for (const [property, value] of Object.entries(styles)) {
      const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      element.style.setProperty(cssProperty, value, "important");
    }
  }
})();
