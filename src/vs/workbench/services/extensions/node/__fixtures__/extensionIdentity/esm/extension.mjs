/**
 * Фикстура extensionHost.extensionIdentity.test.ts — ESM-расширение. Кладёт в
 * реестр проб члены своего `vscode` (именованные import'ы из виртуального
 * модуля этого расширения).
 */
import { env, Position, window } from "vscode";

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.esm = { Position, window, env };

export function activate() {}
