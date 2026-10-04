"use strict";

/**
 * Фикстура extensionHost.extensionIdentity.test.ts — расширение «alpha» в
 * своём каталоге. Кладёт свой `vscode` (и тот, что получил модуль из его же
 * `lib/`) в общий реестр проб; сравнивает их фикстура «beta».
 */
const vscode = require("vscode");
const helper = require("./lib/helper.cjs");

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.alpha = vscode;
probes.alphaHelper = helper.vscode;

exports.activate = function activate() {};
