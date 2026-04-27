import { getRecordingAsset } from "./recording-db";
import { formatDuration, formatFileSize } from "./recording";

const params = new URLSearchParams(window.location.search);
const recordingId = params.get("id");

document.body.innerHTML = `
  <main style="min-height:100vh;padding:32px;background:radial-gradient(circle at top, rgba(239,68,68,0.16), transparent 25%), #020617;color:#e2e8f0;font:16px/1.5 'Trebuchet MS',system-ui,sans-serif;">
    <div style="max-width:980px;margin:0 auto;display:grid;gap:20px;">
      <header style="display:grid;gap:8px;">
        <p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#fca5a5;">Capital Compute Recorder</p>
        <h1 style="margin:0;font:48px/1.02 Georgia, 'Times New Roman', serif;color:#f8fafc;max-width:10ch;">Playback and share your recording.</h1>
      </header>
      <section id="recording-shell" style="display:grid;gap:16px;padding:20px;border-radius:28px;border:1px solid rgba(148,163,184,0.18);background:linear-gradient(180deg, rgba(15,23,42,0.94), rgba(2,6,23,0.96));box-shadow:0 18px 50px rgba(2,6,23,0.45);"></section>
    </div>
  </main>
`;

const shellElement = document.getElementById("recording-shell") as HTMLDivElement | null;

if (!shellElement) {
  throw new Error("Recording shell was not created.");
}

const shell = shellElement;

if (!recordingId) {
  shell.innerHTML = renderMessage("Missing recording id.");
} else {
  void loadRecording(recordingId);
}

async function loadRecording(id: string) {
  shell.innerHTML = renderMessage("Loading recording...");

  const asset = await getRecordingAsset(id);

  if (!asset) {
    shell.innerHTML = renderMessage("This recording is not available in local storage anymore.");
    return;
  }

  const objectUrl = URL.createObjectURL(asset.blob);
  const shareUrl = window.location.href;

  shell.innerHTML = `
    <video controls playsinline style="width:100%;max-height:68vh;border-radius:22px;background:#000;outline:none;" src="${objectUrl}"></video>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
      <div style="display:grid;gap:4px;">
        <strong style="font-size:16px;color:#f8fafc;">${asset.filename}</strong>
        <span style="font-size:13px;color:#94a3b8;">${formatDuration(asset.durationMs)} · ${formatFileSize(asset.size)}</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="copy-link" style="min-height:44px;padding:0 16px;border-radius:14px;border:1px solid rgba(148,163,184,0.18);background:rgba(15,23,42,0.78);color:#f8fafc;cursor:pointer;">Copy link</button>
        <a id="download-link" href="${objectUrl}" download="${asset.filename}" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:14px;border:1px solid rgba(248,113,113,0.35);background:linear-gradient(180deg, #ef4444, #b91c1c);color:#fff;text-decoration:none;">Download</a>
      </div>
    </div>
  `;

  document.getElementById("copy-link")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(shareUrl);
  });

  window.addEventListener(
    "beforeunload",
    () => {
      URL.revokeObjectURL(objectUrl);
    },
    { once: true },
  );
}

function renderMessage(message: string) {
  return `<p style="margin:0;padding:16px;border-radius:16px;background:rgba(15,23,42,0.72);border:1px solid rgba(148,163,184,0.12);color:#cbd5e1;">${message}</p>`;
}
