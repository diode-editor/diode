#!/usr/bin/env node
/**
 * The upstream shell integration scripts -> the `shell-integration.bundle` asset: the shell needs a path on
 * disk, so `shellIntegrationScripts.ts` unpacks the asset into the user cache on first use. Entries are the bare
 * file names, the unpacked directory is the scripts directory.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { packBundle } from "./pack-assets.mjs";

export const SHELL_INTEGRATION_SCRIPTS_DIR = "src/vs/workbench/contrib/terminal/common/scripts";

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, inputs: { virtualPath: string, data: Buffer }[] }}
 */
export function buildShellIntegrationBundle({ repoRoot }) {
    const dir = join(repoRoot, SHELL_INTEGRATION_SCRIPTS_DIR);
    const inputs = readdirSync(dir)
        .filter((name) => name.startsWith("shellIntegration"))
        .sort()
        .map((name) => ({ virtualPath: name, data: readFileSync(join(dir, name)) }));
    if (inputs.length === 0) throw new Error(`[pack-shell-integration] no scripts in ${dir}`);
    return { bundle: packBundle(inputs), inputs };
}
