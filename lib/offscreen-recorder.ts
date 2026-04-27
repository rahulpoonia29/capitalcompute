import { saveRecordingAsset } from "./recording-db";
import type {
  OffscreenRecordingResult,
  RuntimeMessage,
  RuntimeResponse,
  StartRecordingOptions,
} from "./recording";

type ActiveRecordingSession = {
  chunks: Blob[];
  composedStream: MediaStream;
  displayStream: MediaStream;
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
  displayVideo: HTMLVideoElement;
  cameraVideo: HTMLVideoElement | null;
  canvas: HTMLCanvasElement;
  animationFrameId: number | null;
  audioContext: AudioContext | null;
  recorder: MediaRecorder;
  startedAt: number;
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

async function startRecording(options: StartRecordingOptions & { streamId: string }) {
  if (activeSession) {
    throw new Error("A recording session is already active.");
  }

  const displayStream = await getDisplayStream(options);
  const micStream = options.micEnabled
    ? await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
    : null;

  const cameraStream = options.cameraEnabled
    ? await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      })
    : null;

  const displayVideo = await createVideoElement(displayStream);
  const cameraVideo = cameraStream ? await createVideoElement(cameraStream) : null;

  const canvas = document.createElement("canvas");
  const displayTrackSettings = displayStream.getVideoTracks()[0]?.getSettings();
  canvas.width = displayTrackSettings.width ?? 1280;
  canvas.height = displayTrackSettings.height ?? 720;

  const { audioContext, audioTracks } = await mixAudioTracks(displayStream, micStream);
  const canvasStream = canvas.captureStream(30);
  const composedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks,
  ]);

  const recorder = new MediaRecorder(composedStream, { mimeType: getSupportedMimeType() });
  const session: ActiveRecordingSession = {
    chunks: [],
    composedStream,
    displayStream,
    micStream,
    cameraStream,
    displayVideo,
    cameraVideo,
    canvas,
    animationFrameId: null,
    audioContext,
    recorder,
    startedAt: Date.now(),
  };

  activeSession = session;
  session.animationFrameId = window.requestAnimationFrame(() => drawFrame(session));

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

  recorder.start(1000);
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

    session.recorder.stop();
  });
}

async function finalizeSession(session: ActiveRecordingSession) {
  const mimeType = session.recorder.mimeType || "video/webm";
  const blob = new Blob(session.chunks, { type: mimeType });
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
  if (session.animationFrameId !== null) {
    window.cancelAnimationFrame(session.animationFrameId);
  }

  session.composedStream.getTracks().forEach((track) => track.stop());
  session.displayStream.getTracks().forEach((track) => track.stop());
  session.micStream?.getTracks().forEach((track) => track.stop());
  session.cameraStream?.getTracks().forEach((track) => track.stop());

  if (session.audioContext && session.audioContext.state !== "closed") {
    void session.audioContext.close();
  }
}

async function getDisplayStream(options: StartRecordingOptions & { streamId: string }) {
  const source = options.target === "tab" ? "tab" : "desktop";

  const audio = options.systemAudioEnabled
    ? {
        mandatory: {
          chromeMediaSource: source,
          chromeMediaSourceId: options.streamId,
        },
      }
    : false;

  const video = {
    mandatory: {
      chromeMediaSource: source,
      chromeMediaSourceId: options.streamId,
      maxFrameRate: 30,
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

function drawFrame(session: ActiveRecordingSession) {
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
    const insetX = width - insetWidth - 28;
    const insetY = height - insetHeight - 28;
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

  session.animationFrameId = window.requestAnimationFrame(() => drawFrame(session));
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
