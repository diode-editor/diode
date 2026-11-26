import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// For extensions whose server comes from the project's `node_modules` (Biome, Tailwind CSS).

export function npmMissing(): string | undefined {
    const found = spawnSync("npm", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    return found.status === 0 ? undefined : "npm not found in PATH: the project package cannot be installed";
}

/** A private ESM project with the package installed. The version is not pinned, as with stock vsix. */
export function writeNpmProject(projectRoot: string, packageName: string): void {
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), '{ "private": true, "type": "module" }\n');
    execFileSync("npm", ["install", packageName, "--no-audit", "--no-fund", "--loglevel=error"], {
        cwd: projectRoot,
        stdio: "pipe",
        timeout: 180_000,
    });
}
