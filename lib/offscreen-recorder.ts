import { saveRecordingAsset } from "./recording-db";
import type {
  OffscreenRecordingResult,
  PipCorner,
  PreparedRecordingOptions,
  RuntimeMessage,
  RuntimeResponse,
} from "./recording";

type ActiveRecordingSession = {
  chunks: Blob[];
  composedStream: MediaStream;
  displayStream: MediaStream;
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
  monitorAudioContext: AudioContext | null;
  displayVideo: HTMLVideoElement;
  cameraVideo: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  renderIntervalId: number | null;
  audioContext: AudioContext | null;
  recorder: MediaRecorder;
  startedAt: number;
  options: PreparedRecordingOptions;
};

let activeSession: ActiveRecordingSession | null = null;

browser.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_RECORDING") {
    void startRecording(message.payload)
      .then(() => sendResponse({ ok: true, data: undefined } satisfies RuntimeResponse<void>))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to start recording.",
        } satisfies RuntimeResponse<void>);
      });

    return true;
  }

  if (message.type === "OFFSCREEN_STOP_RECORDING") {
    void stopRecording()
      .then(() => sendResponse({ ok: true, data: undefined } satisfies RuntimeResponse<void>))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to stop recording.",
        } satisfies RuntimeResponse<void>);
      });

    return true;
  }

  return false;
});

async function startRecording(options: PreparedRecordingOptions) {
  if (activeSession) {
    throw new Error("A recording session is already active.");
  }

  let displayStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let cameraStream: MediaStream | null = null;
  const warnings: string[] = [];

  try {
    displayStream = await getDisplayStream(options);
  } catch (error) {
    stopMediaStream(displayStream);
    stopMediaStream(micStream);
    stopMediaStream(cameraStream);

    throw new Error(getErrorMessage(error));
  }

  if (options.micEnabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (error) {
      warnings.push(`Microphone unavailable: ${getErrorMessage(error)}`);
    }
  }

  if (options.cameraEnabled) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
    } catch (error) {
      warnings.push(`Camera unavailable: ${getErrorMessage(error)}`);
    }
  }

  const displayVideo = await createVideoElement(displayStream);
  const cameraVideo = cameraStream ? await createVideoElement(cameraStream) : null;
  const monitorAudioContext = await createAudioMonitor(displayStream, options.tabAudioEnabled);

  const { audioContext, audioTracks } = await mixAudioTracks(displayStream, micStream);
  const useCanvasComposition = Boolean(cameraVideo);
  let canvas: HTMLCanvasElement | null = null;
  let renderIntervalId: number | null = null;
  let videoTracks: MediaStreamTrack[];

  if (useCanvasComposition) {
    canvas = document.createElement("canvas");
    const displayTrackSettings = displayStream.getVideoTracks()[0]?.getSettings();
    canvas.width = displayTrackSettings.width ?? 1280;
    canvas.height = displayTrackSettings.height ?? 720;

    const previewSession = {
      displayVideo,
      cameraVideo,
      canvas,
      options,
    };

    renderFrame(previewSession);
    renderIntervalId = window.setInterval(() => {
      renderFrame(previewSession);
    }, 1000 / options.frameRate);

    videoTracks = canvas.captureStream(options.frameRate).getVideoTracks();
  } else {
    videoTracks = displayStream.getVideoTracks();
  }

  const composedStream = new MediaStream([...videoTracks, ...audioTracks]);

  const recorder = new MediaRecorder(composedStream, {
    mimeType: getSupportedMimeType(),
    videoBitsPerSecond: options.videoBitsPerSecond,
    audioBitsPerSecond: options.audioBitsPerSecond,
  });
  const session: ActiveRecordingSession = {
    chunks: [],
    composedStream,
    displayStream,
    micStream,
    cameraStream,
    monitorAudioContext,
    displayVideo,
    cameraVideo,
    canvas,
    renderIntervalId,
    audioContext,
    recorder,
    startedAt: Date.now(),
    options,
  };

  activeSession = session;

  displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (activeSession) {
      void stopRecording();
    }
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      session.chunks.push(event.data);
    }
  };

  recorder.onerror = () => {
    void browser.runtime.sendMessage({
      type: "OFFSCREEN_RECORDING_ERROR",
      payload: { message: "The recorder encountered an unexpected error." },
    } satisfies RuntimeMessage);
  };

  recorder.start(500);

  if (warnings.length > 0) {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_RECORDING_WARNING",
      payload: { message: warnings.join(" ") },
    } satisfies RuntimeMessage);
  }
}

async function stopRecording() {
  if (!activeSession) {
    throw new Error("There is no active recording session.");
  }

  const session = activeSession;

  if (session.recorder.state === "inactive") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    session.recorder.onstop = () => {
      void finalizeSession(session).then(resolve).catch(reject);
    };

    if (session.recorder.state === "recording") {
      try {
        session.recorder.requestData();
      } catch {
        // Ignore flush failures and continue stopping.
      }
    }

    session.recorder.stop();
  });
}

async function finalizeSession(session: ActiveRecordingSession) {
  const mimeType = session.recorder.mimeType || "video/webm";
  const blob = new Blob(session.chunks, { type: mimeType });

  if (blob.size === 0) {
    cleanupSession(session);
    activeSession = null;
    throw new Error("Recording completed without media data.");
  }

  const result: OffscreenRecordingResult = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    durationMs: Date.now() - session.startedAt,
    filename: `capitalcompute-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
    mimeType,
    size: blob.size,
  };

  await saveRecordingAsset({
    ...result,
    blob,
  });

  cleanupSession(session);
  activeSession = null;

  await browser.runtime.sendMessage({
    type: "OFFSCREEN_RECORDING_COMPLETE",
    payload: result,
  } satisfies RuntimeMessage);
}

function cleanupSession(session: ActiveRecordingSession) {
  if (session.renderIntervalId !== null) {
    window.clearInterval(session.renderIntervalId);
  }

  session.composedStream.getTracks().forEach((track) => track.stop());
  session.displayStream.getTracks().forEach((track) => track.stop());
  session.micStream?.getTracks().forEach((track) => track.stop());
  session.cameraStream?.getTracks().forEach((track) => track.stop());
  if (session.monitorAudioContext && session.monitorAudioContext.state !== "closed") {
    void session.monitorAudioContext.close();
  }

  if (session.audioContext && session.audioContext.state !== "closed") {
    void session.audioContext.close();
  }
}

async function getDisplayStream(options: PreparedRecordingOptions) {
  try {
    return await requestDisplayStream(options.streamId, options.tabAudioEnabled);
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`Unable to capture tab: ${message}`);
  }
}

async function requestDisplayStream(
  streamId: string,
  includeAudio: boolean,
) {
  const audio = includeAudio
    ? {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      }
    : false;

  const video = {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
    },
  };

  return await navigator.mediaDevices.getUserMedia({
    audio,
    video,
  } as MediaStreamConstraints);
}

async function createVideoElement(stream: MediaStream) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => {
      void video.play().then(() => resolve()).catch(() => resolve());
    };
  });

  return video;
}

async function createAudioMonitor(stream: MediaStream, enabled: boolean) {
  if (!enabled || stream.getAudioTracks().length === 0) {
    return null;
  }

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  source.connect(audioContext.destination);

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext;
  } catch {
    await audioContext.close().catch(() => undefined);
    return null;
  }
}

async function mixAudioTracks(displayStream: MediaStream, micStream: MediaStream | null) {
  const sourceStreams = [displayStream, micStream].filter(
    (stream): stream is MediaStream => Boolean(stream && stream.getAudioTracks().length > 0),
  );

  if (sourceStreams.length === 0) {
    return { audioContext: null, audioTracks: [] as MediaStreamTrack[] };
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  for (const stream of sourceStreams) {
    const source = audioContext.createMediaStreamSource(stream);
    const gain = audioContext.createGain();
    gain.gain.value = stream === micStream ? 1 : 0.9;
    source.connect(gain).connect(destination);
  }

  return {
    audioContext,
    audioTracks: destination.stream.getAudioTracks(),
  };
}

function renderFrame(session: {
  displayVideo: HTMLVideoElement;
  cameraVideo: HTMLVideoElement | null;
  canvas: HTMLCanvasElement;
  options: PreparedRecordingOptions;
}) {
  const context = session.canvas.getContext("2d");

  if (!context) {
    return;
  }

  const { width, height } = session.canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(session.displayVideo, 0, 0, width, height);

  if (session.cameraVideo) {
    const insetWidth = Math.max(220, Math.floor(width * 0.18));
    const insetHeight = Math.floor(insetWidth * 0.62);
    const { x: insetX, y: insetY } = getPipPosition(
      session.options.pipCorner,
      width,
      height,
      insetWidth,
      insetHeight,
    );
    const radius = 22;

    context.save();
    context.shadowColor = "rgba(15, 23, 42, 0.35)";
    context.shadowBlur = 30;
    context.fillStyle = "rgba(15, 23, 42, 0.9)";
    drawRoundedRect(context, insetX, insetY, insetWidth, insetHeight, radius);
    context.fill();
    context.restore();

    context.save();
    drawRoundedRect(context, insetX, insetY, insetWidth, insetHeight, radius);
    context.clip();
    context.drawImage(session.cameraVideo, insetX, insetY, insetWidth, insetHeight);
    context.restore();

    context.fillStyle = "#ef4444";
    context.beginPath();
    context.arc(insetX + 18, insetY + 18, 6, 0, Math.PI * 2);
    context.fill();
  }
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function getSupportedMimeType() {
  const preferredMimeTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  const match = preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  return match ?? "video/webm";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected recording error.";
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getPipPosition(
  corner: PipCorner,
  canvasWidth: number,
  canvasHeight: number,
  pipWidth: number,
  pipHeight: number,
) {
  const inset = 28;

  switch (corner) {
    case "top-left":
      return { x: inset, y: inset };
    case "bottom-left":
      return { x: inset, y: canvasHeight - pipHeight - inset };
    case "bottom-right":
      return { x: canvasWidth - pipWidth - inset, y: canvasHeight - pipHeight - inset };
    case "top-right":
    default:
      return { x: canvasWidth - pipWidth - inset, y: inset };
  }
}
