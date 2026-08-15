import { defineConfig } from "tsup";

// Версия резолвится в scripts/resolve-version.mjs — тем же кодом, что и ключ кэша
// в build-selfextract.mjs. Общий источник правды: версия, зашитая в main.js, и
// версия в имени кэш-каталога обязаны совпадать.
// @ts-expect-error — build-скрипты живут в .mjs без типов (они не должны зависеть от tsx/jiti).
import { resolveVexxVersion } from "./scripts/resolve-version.mjs";

export default defineConfig({
  entry: ["src/vs/diode/main.ts"],
  format: ["esm"],
  target: "es2024",
  // Список исчерпывающий: всё, что не перечислено, останется внешним import'ом,
  // которого рядом с main.js нет — бинарь упадёт с ERR_MODULE_NOT_FOUND на старте.
  // Новая рантайм-зависимость → сюда же.
  // node-pty здесь не нужен: в коде только type-import, в рантайме он грузится
  // через createRequire (см. src/vs/workbench/contrib/terminal/node/loadNodePty.ts).
  noExternal: [
    "@tuidom/core",
    "@tuidom/elements",
    "@tuidom/terminal-backend",
    "@tuidom/headless-backend",
    "@tuidom/inspector",
    "@tuidom/testing",
    "@xterm/headless",
    "chokidar",
    "vscode-textmate",
    "vscode-oniguruma",
    "jsonc-parser",
    "yauzl",
    "vscode-uri",
    "iconv-lite",
  ],
  // SEA вшивает единственный main.js — code-splitting (дефолт tsup для esm)
  // вынес бы динамический import("yauzl") в отдельный chunk-*.js, которого в
  // бинаре нет. Держим всё в одном файле; import() остаётся ленивым инлайном.
  splitting: false,
  // iconv-lite (CJS) тянет require("buffer") через safer-buffer; в esm-бандле
  // esbuild превращает это в «Dynamic require … is not supported». Баннер даёт
  // модульный require из createRequire — esbuild'овский __require подхватывает
  // его через `typeof require !== "undefined"`.
  banner: {
    js: 'import { createRequire as __vexxCreateRequire } from "node:module"; const require = __vexxCreateRequire(import.meta.url);',
  },
  dts: true,
  clean: true,
  sourcemap: true,
  define: {
    __VEXX_VERSION__: JSON.stringify(resolveVexxVersion()),
  },
});
