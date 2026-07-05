import { cp, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const PDFJS_ASSET_DIRECTORIES = [
  'wasm',
  'cmaps',
  'standard_fonts',
  'iccs',
] as const;

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.wasm':
      return 'application/wasm';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.bcmap':
    case '.pfb':
    case '.icc':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function pdfjsAssets(): Plugin {
  const sourceRoot = resolve('node_modules/pdfjs-dist');
  let buildRoot = resolve('dist');
  let command: 'build' | 'serve' = 'serve';

  return {
    name: 'local-pdfjs-assets',
    configResolved(config) {
      command = config.command;
      buildRoot = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', async (request, response, next) => {
        try {
          const requestPath = decodeURIComponent(
            (request.url ?? '').split('?', 1)[0],
          ).replace(/^\/+/, '');
          const assetPath = resolve(sourceRoot, requestPath);
          if (!assetPath.startsWith(`${sourceRoot}${sep}`)) {
            next();
            return;
          }
          const body = await readFile(assetPath);
          response.statusCode = 200;
          response.setHeader('Content-Type', contentType(assetPath));
          response.setHeader('Cache-Control', 'public, max-age=31536000');
          response.end(body);
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            next();
            return;
          }
          next(error);
        }
      });
    },
    async closeBundle() {
      if (command !== 'build') return;
      await Promise.all(
        PDFJS_ASSET_DIRECTORIES.map((directory) =>
          cp(
            resolve(sourceRoot, directory),
            resolve(buildRoot, 'pdfjs', directory),
            { recursive: true },
          ),
        ),
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
});
