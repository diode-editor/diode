"use strict";

/**
 * Фикстура extensionHost.extensionIdentity.test.ts — builtin: тест отдаёт её
 * исходником (`source`) под синтетическим `filename`, которого нет на диске, —
 * так грузятся встроенные расширения под SEA (`Module._compile`).
 */
const vscode = require("vscode");

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.builtin = vscode;

exports.activate = function activate() {};
