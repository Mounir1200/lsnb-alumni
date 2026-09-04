const DATABASE_NAME = "lsnb-member-media";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-avatars";
const MAX_PENDING_AGE = 7 * 24 * 60 * 60 * 1000;

type PendingAvatarRecord = {
  email: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  lastModified: number;
  savedAt: number;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "email" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local media storage is unavailable."));
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    setResult: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
) {
  const database = await openDatabase();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      let result!: T;

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Local media storage failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Local media storage was interrupted."));
      };
      operation(transaction.objectStore(STORE_NAME), (value) => {
        result = value;
      }, reject);
    });
  } finally {
    database.close();
  }
}

export async function savePendingAvatar(email: string, file: File) {
  if (!("indexedDB" in window)) return false;

  const record: PendingAvatarRecord = {
    email: normalizeEmail(email),
    blob: file,
    fileName: file.name,
    mimeType: file.type,
    lastModified: file.lastModified,
    savedAt: Date.now(),
  };

  try {
    await runTransaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function readPendingAvatar(email: string) {
  if (!("indexedDB" in window)) return undefined;

  try {
    const record = await runTransaction<PendingAvatarRecord | undefined>(
      "readonly",
      (store, resolve, reject) => {
        const request = store.get(normalizeEmail(email));
        request.onsuccess = () => resolve(request.result as PendingAvatarRecord | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    if (record && Date.now() - record.savedAt > MAX_PENDING_AGE) {
      await removePendingAvatar(email);
      return undefined;
    }
    return record;
  } catch {
    return undefined;
  }
}

export async function removePendingAvatar(email: string) {
  if (!("indexedDB" in window)) return;

  try {
    await runTransaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(normalizeEmail(email));
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Failed cleanup must not invalidate a confirmed account.
  }
}
