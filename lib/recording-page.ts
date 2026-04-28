import { getRecordingAsset, getAllRecordingAssets } from "./recording-db";
import { formatDuration, formatFileSize } from "./recording";

const params = new URLSearchParams(window.location.search);
const recordingId = params.get("id");
const isSetup = params.get("setup") === "true";

if (isSetup) {
  document.body.innerHTML = `
    <main style="min-height:100vh;padding:32px;background:#ffffff;color:#0f172a;font:16px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;">
      <div style="max-width:480px;text-align:center;display:flex;flex-direction:column;gap:16px;">
        <h1 style="margin:0;font-size:24px;font-weight:600;color:#0f172a;">Permissions Required</h1>
        <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
          To record your microphone and camera, you need to grant the extension permission. 
          Please click the button below and then select <b>Allow</b> in your browser's prompt.
        </p>
        <button id="grant-btn" style="margin-top:8px;padding:12px 24px;background:#0f172a;color:#ffffff;border:none;border-radius:8px;font-size:15px;font-weight:500;cursor:pointer;">
          Grant Permissions
        </button>
        <p id="setup-status" style="margin:0;font-size:14px;color:#ef4444;height:20px;"></p>
      </div>
    </main>
  `;

  document.getElementById("grant-btn")?.addEventListener("click", async () => {
    const status = document.getElementById("setup-status");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(t => t.stop());
      if (status) {
        status.style.color = "#10b981";
        status.textContent = "Permissions granted! You can safely close this tab.";
      }
      setTimeout(() => window.close(), 1500);
    } catch (e) {
      if (status) status.textContent = "Permission denied. Please check your browser settings.";
    }
  });
} else {
  document.body.innerHTML = `
    <main style="min-height:100vh;padding:32px;background:#ffffff;color:#0f172a;font:16px/1.5 system-ui,sans-serif;">
      <div style="max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:24px;">
        <header style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <h1 style="margin:0;font-size:24px;font-weight:600;color:#0f172a;">Recordings Library</h1>
            <p style="margin:0;font-size:14px;color:#64748b;">Manage and playback your tab captures.</p>
          </div>
          ${recordingId ? `<a href="?" style="font-size:14px;color:#2563eb;text-decoration:none;font-weight:500;">&larr; Back to Library</a>` : ''}
        </header>
        <section id="recording-shell"></section>
      </div>
    </main>
  `;

  const shellElement = document.getElementById("recording-shell") as HTMLDivElement | null;

  if (!shellElement) {
    throw new Error("Recording shell was not created.");
  }

  const shell = shellElement;

  if (!recordingId) {
    void loadLibrary();
  } else {
    void loadRecording(recordingId);
  }

  async function loadLibrary() {
    shell.innerHTML = renderMessage("Loading library...");
    const assets = await getAllRecordingAssets();
    
    if (!assets || assets.length === 0) {
      shell.innerHTML = renderMessage("No recordings found in the library.");
      return;
    }
    
    // Sort by newest
    assets.sort((a, b) => b.createdAt - a.createdAt);

    const listHtml = assets.map(asset => {
      const objectUrl = URL.createObjectURL(asset.blob);
      const dateStr = new Date(asset.createdAt).toLocaleString();
      return `
        <div style="padding:16px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <a href="?id=${asset.id}" style="font-size:16px;font-weight:500;color:#0f172a;text-decoration:none;">${asset.filename}</a>
            <span style="font-size:13px;color:#64748b;">${dateStr} &middot; ${formatDuration(asset.durationMs)} &middot; ${formatFileSize(asset.size)}</span>
          </div>
          <div style="display:flex;gap:12px;">
            <a href="${objectUrl}" download="${asset.filename}" style="font-size:14px;color:#475569;text-decoration:none;padding:6px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;">Download</a>
            <a href="?id=${asset.id}" style="font-size:14px;color:#ffffff;text-decoration:none;padding:6px 12px;background:#0f172a;border-radius:6px;">Play</a>
          </div>
        </div>
      `;
    }).join("");

    shell.innerHTML = `<div style="display:flex;flex-direction:column;">${listHtml}</div>`;
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
      <div style="display:flex;flex-direction:column;gap:16px;">
        <video controls playsinline style="width:100%;max-height:68vh;background:#000;border-radius:8px;" src="${objectUrl}"></video>
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <strong style="font-size:16px;color:#0f172a;">${asset.filename}</strong>
            <span style="font-size:13px;color:#64748b;">${new Date(asset.createdAt).toLocaleString()} &middot; ${formatDuration(asset.durationMs)} &middot; ${formatFileSize(asset.size)}</span>
          </div>
          <div style="display:flex;gap:12px;">
            <button id="copy-link" style="padding:8px 16px;border-radius:6px;border:1px solid #e2e8f0;background:#ffffff;color:#0f172a;cursor:pointer;font-size:14px;">Copy link</button>
            <a id="download-link" href="${objectUrl}" download="${asset.filename}" style="display:inline-flex;align-items:center;padding:8px 16px;border-radius:6px;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;">Download</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById("copy-link")?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    });

    window.addEventListener(
      "beforeunload",
      () => {
        URL.revokeObjectURL(objectUrl);
      },
      { once: true },
    );
  }
}

function renderMessage(message: string) {
  return `<p style="margin:0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:14px;">${message}</p>`;
}
