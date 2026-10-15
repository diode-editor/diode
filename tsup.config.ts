import { defineConfig } from "tsup";

// Версия резолвится в scripts/resolve-version.mjs — тем же кодом, что и ключ кэша
// в build-selfextract.mjs. Общий источник правды: версия, зашитая в main.cjs, и
// версия в имени кэш-каталога обязаны совпадать.
// @ts-expect-error — build-скрипты живут в .mjs без типов (они не должны зависеть от tsx/jiti).
import { resolveDiodeVersion } from "./scripts/resolve-version.mjs";
// @ts-expect-error — то же: .mjs без типов.
import {
  importMetaUrlShim,
  LAZY_CHUNKS,
  lazyEntryChunksPlugin,
  MAIN_FIELDS,
} from "./scripts/build-lazy-chunks.mjs";

/** Ленивые куски (scripts/build-lazy-chunks.mjs) в main.cjs не попадают. */
const lazyChunkIds = (LAZY_CHUNKS as ReadonlyArray<{ id: string }>).map((chunk) => chunk.id);
const metaUrlShim = (importMetaUrlShim as (repoRoot: string) => { define: Record<string, string>; inject: string[] })(
  import.meta.dirname,
);

export default defineConfig({
  entry: ["src/vs/diode/main.ts"],
  // CJS, а не ESM: парс CJS-скрипта дешевле (−12 мс на старте, docs/TODO/OpenPerformance.md),
  // и V8-снапшот SEA (`useSnapshot`, `--build-snapshot`) принимает только CJS. Выход —
  // `main.cjs`: в репозитории "type": "module", а у self-extract рядом нет package.json вовсе.
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "es2024",
  // Пакеты — их ESM-сборкой, как резолвило ESM-ядро: под CJS esbuild взял бы `main`,
  // а у jsonc-parser там UMD с динамическим require, который в бандл не вклеить.
  esbuildOptions(options) {
    options.mainFields = MAIN_FIELDS as string[];
  },
  // import.meta в CJS пуст: шим даёт import.meta.url главного скрипта (ленивым геттером,
  // под снапшот), тот же, что у кусков из нашего кода — scripts/import-meta-url-shim.mjs.
  inject: metaUrlShim.inject,
  // Список исчерпывающий: всё, что не перечислено, останется внешним require,
  // которого рядом с main.cjs нет — бинарь упадёт с MODULE_NOT_FOUND на старте.
  // Новая рантайм-зависимость → сюда же (или в ленивые куски, см. external ниже).
  // node-pty здесь не нужен: в коде только type-import, в рантайме он грузится
  // через createRequire (см. src/vs/workbench/contrib/terminal/node/loadNodePty.ts).
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
  // Ленивые куски — внешние: в main.cjs от них остаётся голый import("<id>"),
  // запасной путь loadLazyModule для dev-сборки; упакованная грузит кусок из
  // ассета (src/vs/base/node/lazyModule.ts). Сами куски собирает
  // scripts/build-lazy-chunks.mjs, гейт на граф — по metafile ниже.
  external: lazyChunkIds,
  // Куски из нашего кода (роли процесса) зовутся import()'ом пути модуля-входа:
  // плагин подменяет его на внешний import("<id>"), иначе esbuild вклеил бы роль в main.cjs.
  esbuildPlugins: [lazyEntryChunksPlugin(import.meta.dirname)],
  // Code-splitting esbuild'а нам не подходит: SEA вшивает main.cjs, а chunk-*.js
  // в бинаре не было бы. Распил — своей механикой (см. external выше).
  splitting: false,
  // metafile-cjs.json рядом с main.cjs: по нему build-dist.mjs и
  // scripts/check-lazy-chunks.mjs проверяют, что куски не протекли в ядро.
  metafile: true,
  // d.ts не нужен никому: точка входа ничего не экспортирует (выходил `export {  }`),
  // а проход tsc стоил ~8 с и сотни МБ на каждую сборку бинаря.
  dts: false,
  clean: true,
  sourcemap: true,
  define: {
    __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
    ...metaUrlShim.define,
  },
});
