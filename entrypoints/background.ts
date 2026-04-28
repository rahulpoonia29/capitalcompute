import {
  initialRecordingState,
  QUALITY_PRESETS,
  type OffscreenRecordingResult,
  type PreparedRecordingOptions,
  type RecordingState,
  type StartRecordingOptions,
  type RuntimeMessage,
  type RuntimeResponse,
  type StoredRecording,
} from "../lib/recording";

const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html";
const RECORDING_STATE_KEY = "recordingState";

let recordingState: RecordingState = initialRecordingState;

export default defineBackground(() => {
  void restoreRecordingState();

  browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    const shouldHandle =
      message.type === "GET_RECORDING_STATE" ||
      message.type === "START_RECORDING" ||
      message.type === "STOP_RECORDING" ||
      message.type === "OFFSCREEN_RECORDING_COMPLETE" ||
      message.type === "OFFSCREEN_RECORDING_ERROR" ||
      message.type === "OFFSCREEN_RECORDING_WARNING";

    if (!shouldHandle) {
      return false;
    }

    void handleMessage(message)
      .then((response) => sendResponse(response))
      .catch(async (error) => {
        const messageText =
          error instanceof Error ? error.message : "Unexpected recording error.";

        await updateRecordingState({
          activeTabId: null,
          options: null,
          status: "error",
          startedAt: null,
          lastError: messageText,
          lastWarning: null,
        });

        sendResponse({ ok: false, error: messageText, state: recordingState });
      });

    return true;
  });
});

async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse<unknown>> {
  switch (message.type) {
    case "GET_RECORDING_STATE":
      return { ok: true, data: recordingState };
    case "START_RECORDING":
      return { ok: true, data: await startRecording(message.payload) };
    case "STOP_RECORDING":
      return { ok: true, data: await stopRecording() };
    case "OFFSCREEN_RECORDING_COMPLETE":
      return { ok: true, data: await finalizeRecording(message.payload) };
    case "OFFSCREEN_RECORDING_ERROR":
      return { ok: true, data: await failRecording(message.payload.message) };
    case "OFFSCREEN_RECORDING_WARNING":
      return { ok: true, data: await setRecordingWarning(message.payload.message) };
    default:
      throw new Error("Unsupported message.");
  }
}

async function restoreRecordingState() {
  const stored = await browser.storage.local.get(RECORDING_STATE_KEY);
  const restored = stored[RECORDING_STATE_KEY] as RecordingState | undefined;

  if (!restored) {
    await persistRecordingState();
    return;
  }

  if (restored.status === "recording" || restored.status === "starting" || restored.status === "stopping") {
    recordingState = {
      ...initialRecordingState,
      lastRecording: restored.lastRecording,
      lastError: "The previous recording session was interrupted.",
      status: "error",
    };
  } else {
    recordingState = restored;
  }

  await persistRecordingState();
}

async function startRecording(options: StartRecordingOptions) {
  if (recordingState.status === "starting" || recordingState.status === "recording") {
    throw new Error("A recording is already in progress.");
  }

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error("No active tab is available for recording.");
  }

  await updateRecordingState({
    status: "starting",
    startedAt: null,
    activeTabId: activeTab.id,
    options,
    lastError: null,
    lastWarning: null,
  });

  await ensureOffscreenDocument();

  const preparedOptions = await prepareRecordingOptions(activeTab, options);
  const response = await sendRuntimeMessage<void>({
    type: "OFFSCREEN_START_RECORDING",
    payload: preparedOptions,
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  await updateRecordingState({
    status: "recording",
    startedAt: Date.now(),
  });

  return recordingState;
}

async function prepareRecordingOptions(
  activeTab: chrome.tabs.Tab,
  options: StartRecordingOptions,
): Promise<PreparedRecordingOptions> {
  if (!activeTab.id) {
    throw new Error("No active tab is available for recording.");
  }

  const frameRate =
    options.quality === "custom" && options.customFrameRate
      ? options.customFrameRate
      : options.quality === "custom"
        ? 30
        : QUALITY_PRESETS[options.quality as keyof typeof QUALITY_PRESETS].frameRate;

  const videoBitsPerSecond =
    options.quality === "custom" && options.customVideoBitrate
      ? options.customVideoBitrate
      : options.quality === "custom"
        ? 8_000_000
        : QUALITY_PRESETS[options.quality as keyof typeof QUALITY_PRESETS].videoBitsPerSecond;

  const audioBitsPerSecond =
    options.quality === "custom"
      ? 160_000
      : QUALITY_PRESETS[options.quality as keyof typeof QUALITY_PRESETS].audioBitsPerSecond;

  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (value) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
        return;
      }

      if (!value) {
        reject(new Error("Tab capture did not return a stream id."));
        return;
      }

      resolve(value);
    });
  });

  return {
    ...options,
    streamId,
    frameRate,
    videoBitsPerSecond,
    audioBitsPerSecond,
  };
}

async function stopRecording() {
  if (recordingState.status !== "recording") {
    throw new Error("There is no active recording to stop.");
  }

  await updateRecordingState({
    status: "stopping",
    lastError: null,
  });

  const response = await sendRuntimeMessage<void>({ type: "OFFSCREEN_STOP_RECORDING" });

  if (!response.ok) {
    throw new Error(response.error);
  }

  return recordingState;
}

async function finalizeRecording(result: OffscreenRecordingResult) {
  const shareUrl = `${chrome.runtime.getURL("recording.html")}?id=${result.id}`;
  const completeRecording: StoredRecording = {
    ...result,
    shareUrl,
  };

  await updateRecordingState({
    status: "idle",
    startedAt: null,
    activeTabId: null,
    options: null,
    lastError: null,
    lastWarning: null,
    lastRecording: completeRecording,
  });

  return completeRecording;
}

async function failRecording(message: string) {
  await updateRecordingState({
    status: "error",
    startedAt: null,
    activeTabId: null,
    options: null,
    lastError: message,
    lastWarning: null,
  });

  return recordingState;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capture tab video, camera, and microphone in a persistent context.",
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function updateRecordingState(partialState: Partial<RecordingState>) {
  recordingState = {
    ...recordingState,
    ...partialState,
  };

  await persistRecordingState();
  await broadcastRecordingState();
}

async function persistRecordingState() {
  await browser.storage.local.set({
    [RECORDING_STATE_KEY]: recordingState,
  });
}

async function broadcastRecordingState() {
  const message: RuntimeMessage = {
    type: "RECORDING_STATE_CHANGED",
    payload: recordingState,
  };

  await browser.runtime.sendMessage(message).catch(() => undefined);

  if (recordingState.activeTabId) {
    await browser.tabs.sendMessage(recordingState.activeTabId, message).catch(() => undefined);
  }
}

async function sendRuntimeMessage<Response>(message: RuntimeMessage) {
  return await new Promise<RuntimeResponse<Response>>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Runtime message failed: ${chrome.runtime.lastError.message}`));
        return;
      }

      resolve(response as RuntimeResponse<Response>);
    });
  });
}

async function setRecordingWarning(message: string) {
  await updateRecordingState({
    lastWarning: message,
  });

  return recordingState;
}
