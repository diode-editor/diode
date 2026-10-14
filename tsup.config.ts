import { defineConfig } from "tsup";

// Версия резолвится в scripts/resolve-version.mjs — тем же кодом, что и ключ кэша
// в build-selfextract.mjs. Общий источник правды: версия, зашитая в main.js, и
// версия в имени кэш-каталога обязаны совпадать.
// @ts-expect-error — build-скрипты живут в .mjs без типов (они не должны зависеть от tsx/jiti).
import { resolveDiodeVersion } from "./scripts/resolve-version.mjs";
// @ts-expect-error — то же: .mjs без типов.
import { LAZY_CHUNKS } from "./scripts/build-lazy-chunks.mjs";

/** Ленивые куски (scripts/build-lazy-chunks.mjs) в main.js не попадают. */
const lazyChunkIds = (LAZY_CHUNKS as ReadonlyArray<{ id: string }>).map((chunk) => chunk.id);

export default defineConfig({
  entry: ["src/vs/diode/main.ts"],
  format: ["esm"],
  target: "es2024",
  // Список исчерпывающий: всё, что не перечислено, останется внешним import'ом,
  // которого рядом с main.js нет — бинарь упадёт с ERR_MODULE_NOT_FOUND на старте.
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
    "iconv-lite",
  ],
  // Ленивые куски — внешние: в main.js от них остаётся голый import("<id>"),
  // запасной путь loadLazyModule для dev-сборки; упакованная грузит кусок из
  // ассета (src/vs/base/node/lazyModule.ts). Сами куски собирает
  // scripts/build-lazy-chunks.mjs, гейт на граф — по metafile ниже.
  external: lazyChunkIds,
  // Code-splitting esbuild'а нам не подходит: SEA вшивает main.js, а chunk-*.js
  // в бинаре не было бы. Распил — своей механикой (см. external выше).
  splitting: false,
  // metafile-esm.json рядом с main.js: по нему build-dist.mjs и
  // scripts/check-lazy-chunks.mjs проверяют, что куски не протекли в ядро.
  metafile: true,
  // iconv-lite (CJS) тянет require("buffer") через safer-buffer; в esm-бандле
  // esbuild превращает это в «Dynamic require … is not supported». Баннер даёт
  // модульный require из createRequire — esbuild'овский __require подхватывает
  // его через `typeof require !== "undefined"`.
  banner: {
    js: 'import { createRequire as __diodeCreateRequire } from "node:module"; const require = __diodeCreateRequire(import.meta.url);',
  },
  // d.ts не нужен никому: точка входа ничего не экспортирует (выходил `export {  }`),
  // а проход tsc стоил ~8 с и сотни МБ на каждую сборку бинаря.
  dts: false,
  clean: true,
  sourcemap: true,
  define: {
    __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
  },
});
