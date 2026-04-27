import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  formatDuration,
  formatFileSize,
  initialRecordingState,
  isRuntimeResponse,
  type RecordingState,
  type RecordingTarget,
  type RuntimeMessage,
  type RuntimeResponse,
  type StartRecordingOptions,
} from "../../lib/recording";
import "./App.css";

const TARGET_OPTIONS: Array<{ label: string; value: RecordingTarget }> = [
  { label: "Tab", value: "tab" },
  { label: "Window", value: "window" },
  { label: "Screen", value: "screen" },
];

function App() {
  const [recordingState, setRecordingState] = useState<RecordingState>(initialRecordingState);
  const [form, setForm] = useState<StartRecordingOptions>({
    target: "tab",
    micEnabled: true,
    cameraEnabled: true,
    systemAudioEnabled: true,
  });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const recordingDuration = useMemo(() => {
    if (!recordingState.startedAt) {
      return "00:00";
    }

    return formatDuration(now - recordingState.startedAt);
  }, [now, recordingState.startedAt]);

  const syncState = useEffectEvent((state: RecordingState) => {
    setRecordingState(state);
    setRequestError(null);

    if (state.options) {
      setForm(state.options);
    }
  });

  useEffect(() => {
    void loadState();

    const handleMessage = (message: RuntimeMessage) => {
      if (message.type === "RECORDING_STATE_CHANGED") {
        syncState(message.payload);
      }
    };

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      window.clearInterval(intervalId);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [syncState]);

  async function loadState() {
    const response = await browser.runtime.sendMessage({ type: "GET_RECORDING_STATE" } satisfies RuntimeMessage);
    const parsed = response as RuntimeResponse<RecordingState>;

    if (parsed.ok) {
      syncState(parsed.data);
    }
  }

  async function startRecording() {
    setRequestError(null);

    const response = await browser.runtime.sendMessage({
      type: "START_RECORDING",
      payload: form,
    } satisfies RuntimeMessage);

    if (isRuntimeResponse<RecordingState>(response) && !response.ok) {
      setRequestError(response.error);
      if (response.state) {
        setRecordingState(response.state);
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
        setRecordingState(response.state);
      }
    }
  }

  const isBusy = recordingState.status === "starting" || recordingState.status === "stopping";
  const isRecording = recordingState.status === "recording";

  return (
    <main className="shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Capital Compute Recorder</p>
          <h1>Capture updates without leaving the tab.</h1>
          <p className="subcopy">
            Screen, camera, mic, and instant playback links in one lightweight flow.
          </p>
        </div>

        <div className="status-row">
          <span className={`status-pill status-${recordingState.status}`}>
            {recordingState.status}
          </span>
          <span className="timer">{isRecording ? recordingDuration : "Ready"}</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Record</h2>
          <span>Choose what to capture</span>
        </div>

        <div className="target-grid" role="radiogroup" aria-label="Recording target">
          {TARGET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`target-card ${form.target === option.value ? "active" : ""}`}
              onClick={() => setForm((current) => ({ ...current, target: option.value }))}
              disabled={isBusy || isRecording}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <div className="toggle-list">
          <label className="toggle-row">
            <span>
              <strong>Microphone</strong>
              <small>Layer narration into the final video</small>
            </span>
            <input
              type="checkbox"
              checked={form.micEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, micEnabled: event.target.checked }))
              }
              disabled={isBusy || isRecording}
            />
          </label>

          <label className="toggle-row">
            <span>
              <strong>Camera overlay</strong>
              <small>Composite a PiP camera feed into the recording</small>
            </span>
            <input
              type="checkbox"
              checked={form.cameraEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, cameraEnabled: event.target.checked }))
              }
              disabled={isBusy || isRecording}
            />
          </label>

          <label className="toggle-row">
            <span>
              <strong>System audio</strong>
              <small>Include tab or desktop audio when available</small>
            </span>
            <input
              type="checkbox"
              checked={form.systemAudioEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, systemAudioEnabled: event.target.checked }))
              }
              disabled={isBusy || isRecording}
            />
          </label>
        </div>

        <button
          type="button"
          className={`record-button ${isRecording ? "stop" : "start"}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isBusy}
        >
          {recordingState.status === "starting"
            ? "Preparing capture..."
            : recordingState.status === "stopping"
              ? "Finalizing recording..."
              : isRecording
                ? "Stop recording"
                : "Start recording"}
        </button>

        {(requestError || recordingState.lastError) && (
          <p className="error-banner">{requestError ?? recordingState.lastError}</p>
        )}
      </section>

      <section className="panel recording-panel">
        <div className="panel-header">
          <h2>Latest capture</h2>
          <span>{recordingState.lastRecording ? "Ready to open or share" : "Nothing recorded yet"}</span>
        </div>

        {recordingState.lastRecording ? (
          <>
            <div className="recording-meta">
              <div>
                <strong>{recordingState.lastRecording.filename}</strong>
                <span>
                  {formatDuration(recordingState.lastRecording.durationMs)} · {formatFileSize(recordingState.lastRecording.size)}
                </span>
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => browser.tabs.create({ url: recordingState.lastRecording!.shareUrl })}
              >
                Open playback
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigator.clipboard.writeText(recordingState.lastRecording!.shareUrl)}
              >
                Copy link
              </button>
            </div>
          </>
        ) : (
          <p className="empty-state">
            Your latest recording will appear here with a shareable playback link.
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
