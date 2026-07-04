import type { DraftData } from './types';

const DATABASE_NAME = 'anki-card-maker';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current';
const LOCAL_STORAGE_KEY = 'anki-card-maker-draft';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transactStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function loadDraft(): Promise<DraftData | null> {
  try {
    return (await transactStore('readonly', (store) =>
      store.get(DRAFT_KEY),
    )) as DraftData | null;
  } catch {
    const fallback = localStorage.getItem(LOCAL_STORAGE_KEY);
    return fallback ? (JSON.parse(fallback) as DraftData) : null;
  }
}

export async function saveDraft(draft: DraftData): Promise<void> {
  try {
    await transactStore('readwrite', (store) => store.put(draft, DRAFT_KEY));
  } catch {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await transactStore('readwrite', (store) => store.delete(DRAFT_KEY));
  } finally {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
}
