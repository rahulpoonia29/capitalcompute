import type { RecordingAsset } from "./recording";

const DATABASE_NAME = "loom-clone-recordings";
const STORE_NAME = "recordings";
const DATABASE_VERSION = 1;

async function openDatabase() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export async function saveRecordingAsset(asset: RecordingAsset) {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.put(asset);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to save recording."));
  });

  database.close();
}

export async function getRecordingAsset(id: string) {
  const database = await openDatabase();

  const asset = await new Promise<RecordingAsset | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as RecordingAsset | undefined);
    request.onerror = () => reject(request.error ?? new Error("Failed to load recording."));
  });

  database.close();
  return asset;
}

export async function getAllRecordingAssets() {
  const database = await openDatabase();

  const assets = await new Promise<RecordingAsset[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as RecordingAsset[]);
    request.onerror = () => reject(request.error ?? new Error("Failed to load recordings."));
  });

  database.close();
  return assets;
}
