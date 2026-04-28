export type RecordingQuality = "standard" | "high" | "ultra" | "custom";

export type PipCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export type StartRecordingOptions = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  tabAudioEnabled: boolean;
  quality: RecordingQuality;
  customFrameRate?: number;
  customVideoBitrate?: number;
  pipCorner: PipCorner;
};

export type PreparedRecordingOptions = StartRecordingOptions & {
  streamId: string;
  frameRate: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
};

export type StoredRecording = {
  id: string;
  createdAt: number;
  durationMs: number;
  filename: string;
  mimeType: string;
  size: number;
  shareUrl: string;
};

export type RecordingAsset = Omit<StoredRecording, "shareUrl"> & {
  blob: Blob;
};

export type OffscreenRecordingResult = Omit<StoredRecording, "shareUrl">;

export type RecordingState = {
  status: RecordingStatus;
  startedAt: number | null;
  activeTabId: number | null;
  options: StartRecordingOptions | null;
  lastError: string | null;
  lastWarning: string | null;
  lastRecording: StoredRecording | null;
};

export const initialRecordingState: RecordingState = {
  status: "idle",
  startedAt: null,
  activeTabId: null,
  options: null,
  lastError: null,
  lastWarning: null,
  lastRecording: null,
};

export type RuntimeMessage =
  | { type: "GET_RECORDING_STATE" }
  | { type: "START_RECORDING"; payload: StartRecordingOptions }
  | { type: "STOP_RECORDING" }
  | {
      type: "OFFSCREEN_START_RECORDING";
      payload: PreparedRecordingOptions;
    }
  | { type: "OFFSCREEN_STOP_RECORDING" }
  | { type: "OFFSCREEN_RECORDING_COMPLETE"; payload: OffscreenRecordingResult }
  | { type: "OFFSCREEN_RECORDING_ERROR"; payload: { message: string } }
  | { type: "OFFSCREEN_RECORDING_WARNING"; payload: { message: string } }
  | { type: "RECORDING_STATE_CHANGED"; payload: RecordingState };

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; state?: RecordingState };

export function isRuntimeResponse<T>(value: unknown): value is RuntimeResponse<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export const QUALITY_PRESETS: Record<
  Exclude<RecordingQuality, "custom">,
  {
    label: string;
    description: string;
    frameRate: number;
    videoBitsPerSecond: number;
    audioBitsPerSecond: number;
  }
> = {
  standard: {
    label: "Standard",
    description: "24 fps · 4 Mbps",
    frameRate: 24,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  },
  high: {
    label: "High",
    description: "30 fps · 8 Mbps",
    frameRate: 30,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 160_000,
  },
  ultra: {
    label: "Ultra",
    description: "30 fps · 12 Mbps",
    frameRate: 30,
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 192_000,
  },
};

export function formatBitrate(bitsPerSecond: number) {
  return `${(bitsPerSecond / 1_000_000).toFixed(0)} Mbps`;
}
