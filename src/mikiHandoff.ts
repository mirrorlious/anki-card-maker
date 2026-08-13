import type { MikiCardPackageV1 } from './mikiCardPackage';

export const MIKI_IMPORT_ORIGIN = 'https://prom1se.online';
export const MIKI_IMPORT_URL = `${MIKI_IMPORT_ORIGIN}/import?handoff=card-maker`;
export const MIKI_CARD_PACKAGE_OFFER_TYPE = 'miki.card-package.offer';
export const MIKI_CARD_PACKAGE_ACK_TYPE = 'miki.card-package.ack';

export function handoffMikiCardPackage(
  packageData: MikiCardPackageV1,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const targetWindow = window.open(MIKI_IMPORT_URL, '_blank');
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
      window.removeEventListener('message', handleMessage);
      if (error) reject(error);
      else resolve();
    };

    const handleMessage = (event: MessageEvent): void => {
      if (event.origin !== MIKI_IMPORT_ORIGIN || event.source !== targetWindow) return;
      if (event.data?.type !== MIKI_CARD_PACKAGE_ACK_TYPE || event.data?.packageId !== packageData.packageId) return;
      if (event.data?.accepted === true) finish();
      else finish(new Error(String(event.data?.reason || 'miki-handoff/rejected')));
    };

    const send = (): void => {
      if (targetWindow.closed) {
        finish(new Error('miki-handoff/window-closed'));
        return;
      }
      targetWindow.postMessage(offer, MIKI_IMPORT_ORIGIN);
    };

    window.addEventListener('message', handleMessage);
    const intervalId = window.setInterval(send, 500);
    const timeoutId = window.setTimeout(() => finish(new Error('miki-handoff/timeout')), timeoutMs);
    send();
  });
}
