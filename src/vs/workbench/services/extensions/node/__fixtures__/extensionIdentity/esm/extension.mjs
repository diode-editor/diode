/**
 * Fixture for extensionHost.extensionIdentity.test.ts: an ESM extension. Puts the
 * members of its `vscode` (named imports from this extension's virtual module)
 * into the probe registry.
 */
import { env, Position, window } from "vscode";

const probes = (globalThis[Symbol.for("diode.test.identity")] ??= {});
probes.esm = { Position, window, env };

export function activate() {}
