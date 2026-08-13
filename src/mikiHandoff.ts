import type { MikiCardPackageV1 } from './mikiCardPackage';

export const MIKI_IMPORT_ORIGIN = 'https://prom1se.online';
export const MIKI_IMPORT_URL = `${MIKI_IMPORT_ORIGIN}/import?handoff=card-maker`;
export const MIKI_LOCAL_PREVIEW_PORT = '4174';
export const MIKI_CARD_PACKAGE_OFFER_TYPE = 'miki.card-package.offer';
export const MIKI_CARD_PACKAGE_ACK_TYPE = 'miki.card-package.ack';
export const MIKI_HANDOFF_WINDOW_NAME_PREFIX = 'miki-card-package-v1:';
export const MIKI_HANDOFF_HASH_KEY = 'card-package';

export function resolveMikiImportTarget(sourceOrigin = window.location.origin): {
  origin: string;
  url: string;
} {
  const sourceUrl = new URL(sourceOrigin);
  const isLocalPreview = sourceUrl.hostname === 'localhost' || sourceUrl.hostname === '127.0.0.1';
  const configuredOrigin = String(import.meta.env?.VITE_MIKI_IMPORT_ORIGIN || '').replace(/\/$/, '');
  const origin = configuredOrigin || (isLocalPreview
    ? `${sourceUrl.protocol}//${sourceUrl.hostname}:${MIKI_LOCAL_PREVIEW_PORT}`
    : MIKI_IMPORT_ORIGIN);
  return { origin, url: `${origin}/import?handoff=card-maker` };
}

export function buildMikiHandoffWindowName(packageData: MikiCardPackageV1): string {
  return `${MIKI_HANDOFF_WINDOW_NAME_PREFIX}${JSON.stringify(packageData)}`;
}

export function encodeMikiHandoffPackage(packageData: MikiCardPackageV1): string {
  const bytes = new TextEncoder().encode(JSON.stringify(packageData));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function handoffMikiCardPackage(
  packageData: MikiCardPackageV1,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const target = resolveMikiImportTarget();
  const encodedPackage = encodeMikiHandoffPackage(packageData);
  const handoffUrl = `${target.url}#${MIKI_HANDOFF_HASH_KEY}=${encodedPackage}`;
  const targetWindow = window.open(handoffUrl, 'miki-card-maker-handoff');
  if (!targetWindow) return Promise.reject(new Error('miki-handoff/popup-blocked'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const offer = {
      type: MIKI_CARD_PACKAGE_OFFER_TYPE,
      protocolVersion: 1,
      packageData,
    };

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(windowNameFallbackId);
      window.removeEventListener('message', handleMessage);
      if (error) reject(error);
      else resolve();
    };

    const handleMessage = (event: MessageEvent): void => {
      if (event.origin !== target.origin || event.source !== targetWindow) return;
      if (event.data?.type !== MIKI_CARD_PACKAGE_ACK_TYPE || event.data?.packageId !== packageData.packageId) return;
      if (event.data?.accepted === true) finish();
      else finish(new Error(String(event.data?.reason || 'miki-handoff/rejected')));
    };

    const send = (): void => {
      if (targetWindow.closed) {
        finish(new Error('miki-handoff/window-closed'));
        return;
      }
      targetWindow.postMessage(offer, target.origin);
    };

    window.addEventListener('message', handleMessage);
    const intervalId = window.setInterval(send, 500);
    const timeoutId = window.setTimeout(() => finish(new Error('miki-handoff/timeout')), timeoutMs);
    const windowNameFallbackId = window.setTimeout(() => {
      if (!targetWindow.closed) finish();
    }, Math.min(2_000, Math.max(750, timeoutMs / 2)));
    send();
  });
}
