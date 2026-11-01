import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** The extension has no binary: the Biome server comes from `node_modules` of the project. */

const BIOME_JSON = `{
    "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 8 },
    "linter": { "enabled": true, "rules": { "recommended": true } },
    "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
`;

/** Unsorted imports, a `debugger` for the linter, and indentation that Biome rewrites. */
const SAMPLE_JS = `import { z } from "./z.js";
import { b } from "./b.js";
export function f(x) {
  debugger;
  return b + z + x;
}
`;

export const BIOME_SETTINGS = {
    "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
    "editor.codeActionsOnSave": { "source.organizeImports.biome": "explicit" },
};

export function npmMissing(): string | undefined {
    const found = spawnSync("npm", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    return found.status === 0 ? undefined : "npm not found in PATH: the Biome package cannot be installed";
}

/** Version is not pinned, as with stock vsix. Returns the path of the sample file. */
export function writeBiomeProject(projectRoot: string): string {
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), '{ "private": true, "type": "module" }\n');
    fs.writeFileSync(path.join(projectRoot, "biome.json"), BIOME_JSON);
    execFileSync("npm", ["install", "@biomejs/biome", "--no-audit", "--no-fund", "--loglevel=error"], {
        cwd: projectRoot,
        stdio: "pipe",
        timeout: 180_000,
    });
    const file = path.join(projectRoot, "sample.js");
    fs.writeFileSync(file, SAMPLE_JS);
    return file;
}
