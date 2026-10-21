"use strict";
// Вход сборки V8-снапшота ядра: исполняет `main.cjs`, как node исполнил бы его сам,
// но компилирует **eagerly** — байткод всех функций уходит в блоб, и старт не платит
// ленивую компиляцию (треть окна до кадра с текстом, docs/arch/Common.md).
//
// `--no-lazy` только на компиляцию `main.cjs`: флагом сборки он скомпилировал бы и
// builtins node, блоб вырос бы вдвое (17.9 → 29.1 МБ). Путь — env-переменной, а не
// строкой: исходник входа лежит в блобе, и путь машины сборки туда не попадает.
//
// `createRequire` нельзя: после десериализации node падает на ассерте
// `initializeModuleLoaders`; `require` сборщика отдаёт только builtins, и `main.cjs` больше не нужно.
const fs = require("node:fs");
const v8 = require("node:v8");
const vm = require("node:vm");

const mainPath = process.env.DIODE_SNAPSHOT_MAIN;
if (mainPath === undefined || mainPath === "") {
    throw new Error("snapshot-entry: путь к main.cjs не задан (env DIODE_SNAPSHOT_MAIN)");
}
const source = fs.readFileSync(mainPath, "utf8");

v8.setFlagsFromString("--no-lazy");
let runMain;
try {
    runMain = new vm.Script(`(function (require, __filename, __dirname) {${source}\n})`, {
        filename: __filename,
    }).runInThisContext();
} finally {
    v8.setFlagsFromString("--lazy");
}
runMain(require, __filename, __dirname);
