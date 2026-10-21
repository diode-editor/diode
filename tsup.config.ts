import { defineConfig } from "tsup";

// Тем же кодом, что ключ кэша в build-selfextract.mjs: версия в main.cjs и в имени
// кэш-каталога обязаны совпадать.
// @ts-expect-error — build-скрипты живут в .mjs без типов (они не должны зависеть от tsx/jiti).
import { resolveDiodeVersion } from "./scripts/resolve-version.mjs";
// @ts-expect-error — то же: .mjs без типов.
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
  // CJS, а не ESM: парс CJS-скрипта дешевле (docs/arch/Common.md, «Почему снапшот»),
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
  // Список исчерпывающий: неперечисленное останется внешним require, которого рядом
  // с main.cjs нет — MODULE_NOT_FOUND на старте. node-pty не нужен: в рантайме он
  // грузится через createRequire (loadNodePty.ts).
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
  // Голый import("<id>") в main.cjs — запасной путь loadLazyModule для dev;
  // упакованная сборка грузит кусок из ассета (src/vs/base/node/lazyModule.ts).
  external: lazyChunkIds,
  // Куски из нашего кода (роли процесса) зовутся import()'ом пути модуля-входа:
  // плагин подменяет его на внешний import("<id>"), иначе esbuild вклеил бы роль в main.cjs.
  esbuildPlugins: [lazyEntryChunksPlugin(import.meta.dirname)],
  // Code-splitting esbuild'а нам не подходит: SEA вшивает main.cjs, а chunk-*.js
  // в бинаре не было бы. Распил — своей механикой (см. external выше).
  splitting: false,
  // По нему build-dist.mjs и check-lazy-chunks.mjs проверяют, что куски не протекли в ядро.
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
