import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath, getSelfExtractPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Out-of-the-box LSP: ts-server.bundle is unpacked into the XDG cache and run by OUR
 * node runtime. The environment is deliberately bare (PATH without node, no node_modules
 * and no LSP settings), like a user without a toolchain. Both formats: SEA and self-extract.
 */

/** PATH without node (nvm/user binaries): sh/tar/gzip for the self-extract stub are in /usr/bin. */
const BARE_PATH = "/usr/bin:/bin";

const WORKSPACE_FILES = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "defs.ts": 'export function greet(name: string): string {\n    return "hi " + name;\n}\n',
    // Type error, for the squiggle (readiness).
    "main.ts": 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n',
};

const UNDERCURL = 8;

function tsServerCacheEntries(home: string): string[] {
    const root = join(home, ".cache", "diode", "ts-server");
    if (!existsSync(root)) return [];
    return readdirSync(root).map((name) => join(root, name));
}

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "Вшитый language-сервер — из коробки, без node в PATH и node_modules",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("SEA: squiggle + F12 на голом окружении; кэш распакован атомарно и переиспользуется", { timeout: 300_000 }, async () => {
            // keepRoot: the second launch needs the first one's cache (warm start);
            // the root is removed manually at the end.
            const app = await useHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
                keepRoot: true,
            });
            const { session } = app;
            const home = join(app.env.root, "home");

            await session.waitForNode("EditorElement");
            // Cold start: background unpacking of ~13 MB + server spawn + indexing.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от вшитого tsserver", timeoutMs: 180_000, intervalMs: 500 },
            );

            // Cache: exactly one versioned directory, published atomically.
            const entries = tsServerCacheEntries(home);
            expect(entries).toHaveLength(1);
            expect(existsSync(join(entries[0], ".diode-ready"))).toBe(true);
            expect(existsSync(`${entries[0]}.lock`)).toBe(false);
            expect(existsSync(join(entries[0], "typescript-language-server", "lib", "run-cli.cjs"))).toBe(true);
            expect(existsSync(join(entries[0], "node_modules", "typescript", "lib", "tsserver.js"))).toBe(true);
            const readyMtime = statSync(join(entries[0], ".diode-ready")).mtimeMs;

            // F12: cursor on the greet call (2:23) → declaration in defs.ts.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("F12");
            await session.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 60_000, intervalMs: 500 });

            // The second launch with the same cache is warm: the directory isn't unpacked again.
            await app.dispose();
            const second = await startHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH, XDG_CACHE_HOME: join(home, ".cache") },
            });
            try {
                await waitUntil(
                    () => second.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "squiggle на тёплом кэше", timeoutMs: 120_000, intervalMs: 500 },
                );
                expect(tsServerCacheEntries(home)).toHaveLength(1);
                expect(statSync(join(entries[0], ".diode-ready")).mtimeMs).toBe(readyMtime);
            } finally {
                await second.dispose();
                removeTempDir(app.env.root);
            }
        });

        it("workspace-версия сервера на голом PATH: JS-энтрипоинт нашим рантаймом, не .bin-шим", { timeout: 300_000 }, async () => {
            // Regression of a real failure: the project has typescript-language-server in
            // devDeps → the workspace candidate wins over the bundled one. A `.bin` shim
            // executed directly as the candidate has the shebang `#!/usr/bin/env node`,
            // which on a machine without node gives exit 127 and a cascade of client
            // EPIPE restarts. The candidate must be cli.mjs itself, run by our runtime
            // (SEA: diode-as-node).
            const root = mkdtempSync(join(tmpdir(), "diode-e2e-"));
            const nodeModules = join(root, "workspace", "node_modules");
            const repoModules = resolve(import.meta.dirname, "..", "node_modules");
            mkdirSync(join(nodeModules, ".bin"), { recursive: true });
            for (const pkg of ["typescript-language-server", "typescript"]) {
                symlinkSync(join(repoModules, pkg), join(nodeModules, pkg));
            }
            // The shim as npm lays it out: a symlink to cli.mjs, executable via the shebang.
            symlinkSync(
                join("..", "typescript-language-server", "lib", "cli.mjs"),
                join(nodeModules, ".bin", "typescript-language-server"),
            );

            const app = await startHeadlessApp({
                root,
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
            });
            try {
                await app.session.waitForNode("EditorElement");
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "undercurl squiggle от workspace-сервера", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        });

        it("self-extract: squiggle на голом окружении (node из payload'а)", { timeout: 300_000 }, async () => {
            const selfExtractBinary = await getSelfExtractPath();
            const app = await startHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
                binary: selfExtractBinary,
            });
            try {
                await app.session.waitForNode("EditorElement");
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "undercurl squiggle (self-extract)", timeoutMs: 180_000, intervalMs: 500 },
                );
                const home = join(app.env.root, "home");
                const entries = tsServerCacheEntries(home);
                expect(entries).toHaveLength(1);
                expect(existsSync(join(entries[0], ".diode-ready"))).toBe(true);
                // Diagnostics in the text: the server processed the whole project.
                expect(frameToText(await app.session.captureFrame())).toContain("main.ts");
            } finally {
                await app.dispose();
            }
        }, 600_000);
    },
);
