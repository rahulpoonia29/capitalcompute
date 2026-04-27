import {
  initialRecordingState,
  type OffscreenRecordingResult,
  type RecordingState,
  type RuntimeMessage,
  type RuntimeResponse,
  type StartRecordingOptions,
  type StoredRecording,
} from "../lib/recording";

const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html";
const RECORDING_STATE_KEY = "recordingState";

let recordingState: RecordingState = initialRecordingState;

export default defineBackground(() => {
  void restoreRecordingState();

  browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    void handleMessage(message)
      .then((response) => sendResponse(response))
      .catch(async (error) => {
        const messageText =
          error instanceof Error ? error.message : "Unexpected recording error.";

        await updateRecordingState({
          status: "error",
          lastError: messageText,
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
    default:
      return { ok: false, error: "Unsupported message." };
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
  });

  await ensureOffscreenDocument();

  const streamId =
    options.target === "tab"
      ? await browser.tabCapture.getMediaStreamId({ targetTabId: activeTab.id })
      : await chooseDesktopStream(activeTab, options);

  const response = await sendRuntimeMessage<void>({
    type: "OFFSCREEN_START_RECORDING",
    payload: {
      ...options,
      streamId,
    },
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  if (options.cameraEnabled) {
    await browser.tabs.sendMessage(activeTab.id, { type: "SHOW_CAMERA_PREVIEW" }).catch(() => undefined);
  }

  await updateRecordingState({
    status: "recording",
    startedAt: Date.now(),
  });

  return recordingState;
}

async function stopRecording() {
  if (recordingState.status !== "recording") {
    throw new Error("There is no active recording to stop.");
  }

  await updateRecordingState({
    status: "stopping",
    lastError: null,
  });

  if (recordingState.activeTabId) {
    await browser.tabs
      .sendMessage(recordingState.activeTabId, { type: "HIDE_CAMERA_PREVIEW" })
      .catch(() => undefined);
  }

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

  if (recordingState.activeTabId) {
    await browser.tabs
      .sendMessage(recordingState.activeTabId, { type: "HIDE_CAMERA_PREVIEW" })
      .catch(() => undefined);
  }

  await updateRecordingState({
    status: "idle",
    startedAt: null,
    activeTabId: null,
    options: null,
    lastError: null,
    lastRecording: completeRecording,
  });

  return completeRecording;
}

async function failRecording(message: string) {
  if (recordingState.activeTabId) {
    await browser.tabs
      .sendMessage(recordingState.activeTabId, { type: "HIDE_CAMERA_PREVIEW" })
      .catch(() => undefined);
  }

  await updateRecordingState({
    status: "error",
    startedAt: null,
    activeTabId: null,
    options: null,
    lastError: message,
  });

  return recordingState;
}

async function chooseDesktopStream(
  activeTab: chrome.tabs.Tab,
  options: StartRecordingOptions,
) {
  const sources = [options.target === "window" ? "window" : "screen"] as string[];

  if (options.systemAudioEnabled) {
    sources.push("audio");
  }

  return await new Promise<string>((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(
      sources as unknown as chrome.desktopCapture.DesktopCaptureSourceType[],
      activeTab,
      (streamId) => {
      if (!streamId) {
        reject(new Error("Screen selection was cancelled."));
        return;
      }

      resolve(streamId);
      },
    );
  });
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
    justification: "Capture display, camera, and microphone in a persistent context.",
  });
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
  return (await browser.runtime.sendMessage(message)) as RuntimeResponse<Response>;
}
