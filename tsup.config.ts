import { defineConfig } from "tsup";

// Same code as the cache key in build-selfextract.mjs: the version in main.cjs and in the
// cache directory name must match.
// @ts-expect-error — build scripts are untyped .mjs (they must not depend on tsx/jiti).
import { resolveDiodeVersion } from "./scripts/resolve-version.mjs";
// @ts-expect-error — same: untyped .mjs.
import {
  importMetaUrlShim,
  LAZY_CHUNKS,
  lazyEntryChunksPlugin,
  MAIN_FIELDS,
} from "./scripts/build-lazy-chunks.mjs";

const lazyChunkIds = (LAZY_CHUNKS as ReadonlyArray<{ id: string }>).map((chunk) => chunk.id);
const metaUrlShim = (importMetaUrlShim as (repoRoot: string) => { define: Record<string, string>; inject: string[] })(
  import.meta.dirname,
);

export default defineConfig({
  entry: ["src/vs/diode/main.ts"],
  // CJS, not ESM: parsing a CJS script is cheaper (docs/arch/Common.md#почему-снапшот-во-что-обходится-загрузка-бандла),
  // and the SEA V8 snapshot (`useSnapshot`, `--build-snapshot`) accepts only CJS. The output is
  // `main.cjs`: the repo has "type": "module", and self-extract has no package.json next to it at all.
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "es2024",
  // Packages use their ESM build, as the ESM core resolved them: under CJS esbuild would pick `main`,
  // and jsonc-parser has a UMD build there with a dynamic require that cannot be bundled.
  esbuildOptions(options) {
    options.mainFields = MAIN_FIELDS as string[];
  },
  // import.meta is empty in CJS: the shim provides the main script's import.meta.url (a lazy getter,
  // for the V8 snapshot), the same one as chunks from our code get: scripts/import-meta-url-shim.mjs.
  inject: metaUrlShim.inject,
  // The list is exhaustive: anything unlisted stays an external require, which does not exist
  // next to main.cjs: MODULE_NOT_FOUND at startup. node-pty is not needed: at runtime it
  // loads via createRequire (loadNodePty.ts).
  noExternal: [
    "@tuidom/core",
    "@tuidom/elements",
    "@tuidom/terminal-backend",
    "@tuidom/headless-backend",
    "@tuidom/inspector",
    "@tuidom/testing",
    "chokidar",
    "vscode-textmate",
    "vscode-oniguruma",
    "jsonc-parser",
    "vscode-uri",
  ],
  // A bare import("<id>") in main.cjs is the loadLazyModule fallback for dev;
  // the packaged build loads the lazy chunk from an asset (src/vs/base/node/lazyModule.ts).
  external: lazyChunkIds,
  // Chunks from our code (process roles) are loaded by import() of the entry module path:
  // the plugin replaces it with an external import("<id>"), otherwise esbuild would inline the role into main.cjs.
  esbuildPlugins: [lazyEntryChunksPlugin(import.meta.dirname)],
  // esbuild code splitting does not fit: SEA embeds main.cjs, and chunk-*.js
  // would be missing from the binary. Splitting uses our own mechanism (see external above).
  splitting: false,
  // build-dist.mjs and check-lazy-chunks.mjs use it to check that chunks did not leak into the core.
  metafile: true,
  // Nobody needs d.ts: the entry point exports nothing (it emitted `export {  }`),
  // and the tsc pass cost ~8 s and hundreds of MB per binary build.
  dts: false,
  clean: true,
  sourcemap: true,
  define: {
    __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
    ...metaUrlShim.define,
  },
});
