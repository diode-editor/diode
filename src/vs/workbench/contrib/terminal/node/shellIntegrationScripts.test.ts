import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadShellIntegrationScriptsDir, resolveShellIntegrationScriptsDir } from "./shellIntegrationScripts.ts";

const SOURCES = path.resolve(import.meta.dirname, "../common/scripts");
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

interface IPackShellIntegrationScript {
    buildShellIntegrationBundle(params: { repoRoot: string }): { bundle: Uint8Array };
}

/** The asset the build ships (`scripts/pack-shell-integration.mjs`), not a copy of its logic. */
async function realBundle(): Promise<Uint8Array> {
    const script = (await import(
        new URL("../../../../../../scripts/pack-shell-integration.mjs", import.meta.url).href
    )) as IPackShellIntegrationScript;
    return script.buildShellIntegrationBundle({ repoRoot: REPO_ROOT }).bundle;
}

describe("resolveShellIntegrationScriptsDir", () => {
    let cacheRoot: string;

    beforeEach(() => {
        cacheRoot = mkdtempSync(path.join(tmpdir(), "diode si cache "));
    });
    afterEach(() => {
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("dev: the sources", () => {
        expect(resolveShellIntegrationScriptsDir(null)).toBe(SOURCES);
        expect(loadShellIntegrationScriptsDir()).toBe(SOURCES);
        expect(loadShellIntegrationScriptsDir()).toBe(loadShellIntegrationScriptsDir());
    });

    it("packaged: unpacked once into a cache path with spaces; a second start doesn't rewrite the files", async () => {
        const bundle = await realBundle();
        const dir = resolveShellIntegrationScriptsDir(bundle, cacheRoot);
        expect(dir.startsWith(path.join(cacheRoot, "shell-integration"))).toBe(true);
        expect(dir).toContain(" ");
        const script = path.join(dir, "shellIntegration-bash.sh");
        expect(readFileSync(script, "utf8")).toBe(readFileSync(path.join(SOURCES, "shellIntegration-bash.sh"), "utf8"));
        const written = statSync(script).mtimeMs;
        expect(resolveShellIntegrationScriptsDir(bundle, cacheRoot)).toBe(dir);
        expect(statSync(script).mtimeMs).toBe(written);
        for (const script of ["shellIntegration-rc.zsh", "shellIntegration.fish", "shellIntegration.ps1"]) {
            expect(existsSync(path.join(dir, script)), script).toBe(true);
        }
    });
});
