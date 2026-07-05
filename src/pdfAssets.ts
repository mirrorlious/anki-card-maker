const baseUrl = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const pdfAssetBase = `${baseUrl}pdfjs/`;

export const PDF_DOCUMENT_ASSETS = {
  cMapPacked: true,
  cMapUrl: `${pdfAssetBase}cmaps/`,
  iccUrl: `${pdfAssetBase}iccs/`,
  standardFontDataUrl: `${pdfAssetBase}standard_fonts/`,
  useWorkerFetch: true,
  wasmUrl: `${pdfAssetBase}wasm/`,
} as const;
