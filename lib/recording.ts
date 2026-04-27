export type RecordingTarget = "tab" | "window" | "screen";

export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export type StartRecordingOptions = {
  target: RecordingTarget;
  micEnabled: boolean;
  cameraEnabled: boolean;
  systemAudioEnabled: boolean;
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
  lastRecording: StoredRecording | null;
};

export const initialRecordingState: RecordingState = {
  status: "idle",
  startedAt: null,
  activeTabId: null,
  options: null,
  lastError: null,
  lastRecording: null,
};

export type RuntimeMessage =
  | { type: "GET_RECORDING_STATE" }
  | { type: "START_RECORDING"; payload: StartRecordingOptions }
  | { type: "STOP_RECORDING" }
  | {
      type: "OFFSCREEN_START_RECORDING";
      payload: StartRecordingOptions & { streamId: string };
    }
  | { type: "OFFSCREEN_STOP_RECORDING" }
  | { type: "OFFSCREEN_RECORDING_COMPLETE"; payload: OffscreenRecordingResult }
  | { type: "OFFSCREEN_RECORDING_ERROR"; payload: { message: string } }
  | { type: "SHOW_CAMERA_PREVIEW" }
  | { type: "HIDE_CAMERA_PREVIEW" }
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
