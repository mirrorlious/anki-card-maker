import type { AiGenerationResult, DraftData } from './types';

const DATABASE_NAME = 'anki-card-maker';
const DATABASE_VERSION = 2;
const DRAFT_STORE_NAME = 'drafts';
const AI_CACHE_STORE_NAME = 'ai-cache';
const DRAFT_KEY = 'current';
const LOCAL_STORAGE_KEY = 'anki-card-maker-draft';

export interface AiGenerationCacheEntry {
  key: string;
  result: AiGenerationResult;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(AI_CACHE_STORE_NAME)) {
        database.createObjectStore(AI_CACHE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transactStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function loadDraft(): Promise<DraftData | null> {
  try {
    return (await transactStore(
      DRAFT_STORE_NAME,
      'readonly',
      (store) => store.get(DRAFT_KEY),
    )) as DraftData | null;
  } catch {
    const fallback = localStorage.getItem(LOCAL_STORAGE_KEY);
    return fallback ? (JSON.parse(fallback) as DraftData) : null;
  }
}

export async function saveDraft(draft: DraftData): Promise<void> {
  try {
    await transactStore(DRAFT_STORE_NAME, 'readwrite', (store) =>
      store.put(draft, DRAFT_KEY),
    );
  } catch {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await transactStore(DRAFT_STORE_NAME, 'readwrite', (store) =>
      store.delete(DRAFT_KEY),
    );
  } finally {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
}

export async function loadAiGenerationCache(
  key: string,
): Promise<AiGenerationCacheEntry | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return (await transactStore(
      AI_CACHE_STORE_NAME,
      'readonly',
      (store) => store.get(key),
    )) as AiGenerationCacheEntry | null;
  } catch {
    return null;
  }
}

export async function saveAiGenerationCache(
  entry: AiGenerationCacheEntry,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await transactStore(AI_CACHE_STORE_NAME, 'readwrite', (store) =>
      store.put(entry, entry.key),
    );
  } catch {
    // Cache failures must never block card generation.
  }
}

export async function clearAiGenerationCache(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await transactStore(AI_CACHE_STORE_NAME, 'readwrite', (store) =>
    store.clear(),
  );
}
