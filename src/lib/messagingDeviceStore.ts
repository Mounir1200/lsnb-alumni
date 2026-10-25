import type { DeviceStore, MessagingDevice } from "./messagingDevice";

const DATABASE_NAME = "lsnb-messaging";
const DATABASE_VERSION = 1;
const DEVICES = "devices";

function settle<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => { request.result.createObjectStore(DEVICES); };
  return settle(request);
}

async function withDevices<T>(mode: IDBTransactionMode, run: (devices: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try { return await settle(run(database.transaction(DEVICES, mode).objectStore(DEVICES))); }
  finally { database.close(); }
}

function isDevice(value: unknown): value is MessagingDevice {
  if (!value || typeof value !== "object") return false;
  const device = value as Partial<MessagingDevice>;
  return typeof device.userId === "string" && typeof device.sessionId === "string"
    && typeof device.clockOffset === "number" && device.key instanceof CryptoKey;
}

/** IndexedDB keeps the CryptoKey itself, so it stays non-extractable across reloads. */
export function createIndexedDbDeviceStore(): DeviceStore {
  return {
    async load(userId) {
      const stored = await withDevices<unknown>("readonly", (devices) => devices.get(userId));
      return isDevice(stored) && stored.userId === userId ? stored : null;
    },
    async save(device) { await withDevices("readwrite", (devices) => devices.put(device, device.userId)); },
    async clear() { await withDevices("readwrite", (devices) => devices.clear()); },
  };
}
