import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packBundle } from "../../../../base/common/assets/assetBundleFormat.ts";

import { loadNodePty } from "./loadNodePty.ts";
import { loadShellIntegrationScriptsDir, resolveShellIntegrationScriptsDir } from "./shellIntegrationScripts.ts";

const SOURCES = path.resolve(import.meta.dirname, "../common/scripts");

/** What `scripts/pack-shell-integration.mjs` packs: the scripts under their bare names. */
function realBundle(): Uint8Array {
    return packBundle(
        readdirSync(SOURCES).map((name) => ({ virtualPath: name, data: readFileSync(path.join(SOURCES, name)) })),
    );
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

    it("packaged: unpacked once into the cache; a second start doesn't rewrite the files", () => {
        const bundle = realBundle();
        const dir = resolveShellIntegrationScriptsDir(bundle, cacheRoot);
        expect(dir.startsWith(path.join(cacheRoot, "shell-integration"))).toBe(true);
        const script = path.join(dir, "shellIntegration-bash.sh");
        expect(readFileSync(script, "utf8")).toBe(readFileSync(path.join(SOURCES, "shellIntegration-bash.sh"), "utf8"));
        const written = statSync(script).mtimeMs;
        expect(resolveShellIntegrationScriptsDir(bundle, cacheRoot)).toBe(dir);
        expect(statSync(script).mtimeMs).toBe(written);
        expect(existsSync(path.join(dir, "shellIntegration-rc.zsh"))).toBe(true);
    });

    it("packaged: bash runs the unpacked script from a cache path with spaces", async () => {
        const dir = resolveShellIntegrationScriptsDir(realBundle(), cacheRoot);
        expect(dir).toContain(" ");
        const pty = loadNodePty().spawn("/bin/bash", ["--init-file", path.join(dir, "shellIntegration-bash.sh")], {
            cols: 80,
            rows: 10,
            cwd: cacheRoot,
            env: { PATH: process.env.PATH ?? "", HOME: cacheRoot, TERM: "xterm-256color", VSCODE_INJECTION: "1" },
        });
        let output = "";
        pty.onData((data) => {
            output += data;
        });
        try {
            await vi.waitFor(
                () => {
                    expect(output).toContain("\x1b]633;A\x07");
                },
                { timeout: 10_000, interval: 50 },
            );
        } finally {
            pty.kill();
        }
    }, 20_000);
});
