"use strict";
// Вход сборки V8-снапшота ядра (`build-sea.mjs`, `check-snapshot.mjs`): исполняет
// `main.cjs` так же, как node исполнил бы его сам (`require`, `__filename`,
// `__dirname` — ровно то, что сборщик снапшота передаёт входу), но компилирует
// его **eagerly**: байткод всех функций бандла уходит в блоб, и у пользователя
// путь старта не платит ленивую компиляцию (треть окна от `main:start` до кадра
// с текстом — docs/arch/Common.md, «Почему снапшот»).
//
// `--no-lazy` включается только на компиляцию `main.cjs`: флагом сборки он
// скомпилировал бы и builtins node, блоб вырос бы вдвое (17.9 → 29.1 МБ) и
// десериализация съела бы выигрыш. Путь к `main.cjs` приходит env-переменной
// сборки, а не строкой в этом файле: исходник входа лежит в блобе, и путь
// машины сборки туда не попадает. Имя скрипта — `__filename` входа, то же, что
// сборщик дал бы самому `main.cjs` (в SEA — `__node_anonymous_main`).
//
// `require` сборщика отдаёт только builtins — `main.cjs` больше и не нужно (гейт
// `lazy-chunks-check`). `createRequire` здесь нельзя: после десериализации node
// падает на ассерте `initializeModuleLoaders`.
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
