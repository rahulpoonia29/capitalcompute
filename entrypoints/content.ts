export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    let overlayRoot: HTMLDivElement | null = null;
    let previewVideo: HTMLVideoElement | null = null;
    let previewStream: MediaStream | null = null;

    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'SHOW_CAMERA_PREVIEW') {
        void showCameraPreview();
      }

      if (message.type === 'HIDE_CAMERA_PREVIEW') {
        hideCameraPreview();
      }
    });

    async function showCameraPreview() {
      if (overlayRoot) {
        return;
      }

      previewStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
        },
        audio: false,
      });

      overlayRoot = document.createElement('div');
      overlayRoot.id = 'loom-clone-preview';
      overlayRoot.style.cssText = [
        'position:fixed',
        'right:20px',
        'bottom:20px',
        'width:220px',
        'border-radius:18px',
        'overflow:hidden',
        'background:#0f172a',
        'box-shadow:0 20px 50px rgba(15,23,42,0.45)',
        'z-index:2147483647',
        'border:1px solid rgba(255,255,255,0.18)',
        'backdrop-filter:blur(10px)',
      ].join(';');

      const badge = document.createElement('div');
      badge.textContent = 'REC Camera Preview';
      badge.style.cssText = [
        'position:absolute',
        'top:10px',
        'left:10px',
        'padding:6px 10px',
        'border-radius:999px',
        'font:600 11px/1.2 system-ui,sans-serif',
        'letter-spacing:0.04em',
        'text-transform:uppercase',
        'background:rgba(15,23,42,0.72)',
        'color:#fff',
      ].join(';');

      previewVideo = document.createElement('video');
      previewVideo.autoplay = true;
      previewVideo.muted = true;
      previewVideo.playsInline = true;
      previewVideo.srcObject = previewStream;
      previewVideo.style.cssText = 'display:block;width:100%;aspect-ratio:16/10;object-fit:cover;';

      overlayRoot.append(previewVideo, badge);
      document.documentElement.append(overlayRoot);
    }

    function hideCameraPreview() {
      previewStream?.getTracks().forEach((track) => track.stop());
      previewStream = null;
      previewVideo = null;
      overlayRoot?.remove();
      overlayRoot = null;
    }
  },
});
