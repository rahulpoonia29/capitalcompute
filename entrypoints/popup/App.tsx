import { useEffect, useCallback, useMemo, useState } from "react";
import {
  formatDuration,
  formatFileSize,
  formatBitrate,
  initialRecordingState,
  isRuntimeResponse,
  QUALITY_PRESETS,
  type PipCorner,
  type RecordingQuality,
  type RecordingState,
  type RuntimeMessage,
  type RuntimeResponse,
  type StartRecordingOptions,
} from "../../lib/recording";

const QUALITY_OPTIONS = [
  ...Object.entries(QUALITY_PRESETS),
  ["custom", { label: "Custom", description: "Set framerate and bitrate manually" }]
] as Array<[RecordingQuality, { label: string; description: string }]>;

const CORNER_OPTIONS: Array<{ value: PipCorner; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

function App() {
  const [recordingState, setRecordingState] = useState<RecordingState>(initialRecordingState);
  const [form, setForm] = useState<StartRecordingOptions>({
    micEnabled: true,
    cameraEnabled: true,
    tabAudioEnabled: true,
    quality: "high",
    pipCorner: "bottom-right",
    customFrameRate: 30,
    customVideoBitrate: 8000000,
  });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const recordingDuration = useMemo(() => {
    if (!recordingState.startedAt) {
      return "00:00";
    }
    return formatDuration(now - recordingState.startedAt);
  }, [now, recordingState.startedAt]);

  const syncState = useCallback((state: RecordingState) => {
    setRecordingState(state);
    setRequestError(null);

    if (state.status === "recording" || state.status === "starting" || state.status === "stopping") {
      if (state.options) {
        setForm(f => ({ ...f, ...state.options }));
      }
      return;
    }

    if (state.options) {
      setForm(f => ({ ...f, ...state.options }));
    }
  }, []);

  useEffect(() => {
    void loadState();

    const handleMessage = (message: RuntimeMessage) => {
      if (message.type === "RECORDING_STATE_CHANGED") {
        syncState(message.payload);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [syncState]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  async function loadState() {
    const response = await browser.runtime.sendMessage({ type: "GET_RECORDING_STATE" } satisfies RuntimeMessage);
    const parsed = response as RuntimeResponse<RecordingState>;

    if (parsed.ok) {
      syncState(parsed.data);
    }
  }

  async function requestPermissions(mic: boolean, camera: boolean) {
    if (!mic && !camera) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mic,
        video: camera,
      });
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      setRequestError("Camera/Mic access is required. Please grant permissions in the setup tab that just opened.");
      void browser.tabs.create({ url: chrome.runtime.getURL("recording.html?setup=true") });
      return false;
    }
  }

  async function startRecording() {
    setRequestError(null);

    const hasPermissions = await requestPermissions(form.micEnabled, form.cameraEnabled);
    if (!hasPermissions) {
      return;
    }

    const payload = { ...form };
    if (payload.quality !== "custom") {
      delete payload.customFrameRate;
      delete payload.customVideoBitrate;
    }

    const response = await browser.runtime.sendMessage({
      type: "START_RECORDING",
      payload,
    } satisfies RuntimeMessage);

    if (isRuntimeResponse<RecordingState>(response) && !response.ok) {
      setRequestError(response.error);
      if (response.state) {
        syncState(response.state);
      }
    }
  }

  async function stopRecording() {
    setRequestError(null);

    const response = await browser.runtime.sendMessage({
      type: "STOP_RECORDING",
    } satisfies RuntimeMessage);

    if (isRuntimeResponse<RecordingState>(response) && !response.ok) {
      setRequestError(response.error);
      if (response.state) {
        syncState(response.state);
      }
    }
  }

  const isBusy = recordingState.status === "starting" || recordingState.status === "stopping";
  const isRecording = recordingState.status === "recording";
  const activeQuality = form.quality === "custom" 
    ? { videoBitsPerSecond: form.customVideoBitrate || 8000000 } 
    : QUALITY_PRESETS[form.quality as keyof typeof QUALITY_PRESETS] || { videoBitsPerSecond: 8000000 };

  return (
    <main className="min-h-full bg-white p-4 text-slate-900">
      <div className="space-y-6">
        <header className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Tab Recorder</h1>
            <p className="text-sm text-slate-500">Record current tab</p>
          </div>
          <div className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {isRecording ? recordingDuration : recordingState.status}
          </div>
        </header>

        <section className="space-y-4">
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-800">Recording quality</span>
              <select
                value={form.quality}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    quality: event.target.value as RecordingQuality,
                  }))
                }
                disabled={isBusy || isRecording}
                className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
              >
                {QUALITY_OPTIONS.map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label} · {preset.description}
                  </option>
                ))}
              </select>
            </label>

            {form.quality === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-slate-800">Framerate (fps)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.customFrameRate || 30}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setForm(f => ({ ...f, customFrameRate: val }));
                    }}
                    disabled={isBusy || isRecording}
                    className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-slate-800">Bitrate (Mbps)</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.customVideoBitrate ? form.customVideoBitrate / 1000000 : 8}
                    onChange={(e) => {
                      const val = Number(e.target.value) * 1000000;
                      setForm(f => ({ ...f, customVideoBitrate: val }));
                    }}
                    disabled={isBusy || isRecording}
                    className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
                  />
                </label>
              </div>
            )}
            
            {form.quality !== "custom" && (
               <div className="text-xs text-slate-500">
                  Bitrate: <span className="font-medium">{formatBitrate(activeQuality.videoBitsPerSecond)}</span>
               </div>
            )}

            <label className="grid gap-1.5 text-sm pt-2">
              <span className="font-medium text-slate-800">Camera position</span>
              <select
                value={form.pipCorner}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    pipCorner: event.target.value as PipCorner,
                  }))
                }
                disabled={isBusy || isRecording || !form.cameraEnabled}
                className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
              >
                {CORNER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2 pt-2">
            <ToggleRow
              label="Tab audio"
              checked={form.tabAudioEnabled}
              disabled={isBusy || isRecording}
              onChange={(checked) =>
                setForm((current) => ({ ...current, tabAudioEnabled: checked }))
              }
            />
            <ToggleRow
              label="Microphone"
              checked={form.micEnabled}
              disabled={isBusy || isRecording}
              onChange={(checked) =>
                setForm((current) => ({ ...current, micEnabled: checked }))
              }
            />
            <ToggleRow
              label="Camera PiP"
              checked={form.cameraEnabled}
              disabled={isBusy || isRecording}
              onChange={(checked) =>
                setForm((current) => ({ ...current, cameraEnabled: checked }))
              }
            />
          </div>

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isBusy}
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded bg-slate-900 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {recordingState.status === "starting"
              ? "Preparing..."
              : recordingState.status === "stopping"
                ? "Finalizing..."
                : isRecording
                  ? "Stop recording"
                  : "Start recording"}
          </button>

          {(requestError || recordingState.lastError) && (
            <p className="mt-2 text-xs text-red-600">
              {requestError ?? recordingState.lastError}
            </p>
          )}

          {recordingState.lastWarning && !requestError && !recordingState.lastError && (
            <p className="mt-2 text-xs text-amber-600">
              {recordingState.lastWarning}
            </p>
          )}
        </section>

        <section className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-900">Latest recording</h2>
          </div>

          {recordingState.lastRecording ? (
            <div className="mt-3 space-y-2">
              <div className="truncate text-sm text-slate-600">
                {recordingState.lastRecording.filename}
              </div>
              <div className="text-xs text-slate-500">
                {formatDuration(recordingState.lastRecording.durationMs)} · {formatFileSize(recordingState.lastRecording.size)}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex h-8 px-3 items-center justify-center rounded border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => browser.tabs.create({ url: recordingState.lastRecording!.shareUrl })}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 px-3 items-center justify-center rounded border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => browser.tabs.create({ url: chrome.runtime.getURL("recording.html") })}
                >
                  Library
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No recent recordings.</p>
          )}
          
          {!recordingState.lastRecording && (
             <div className="mt-4">
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                  onClick={() => browser.tabs.create({ url: chrome.runtime.getURL("recording.html") })}
                >
                  View Library
                </button>
             </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="block text-sm text-slate-800">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
      />
    </label>
  );
}

export default App;
