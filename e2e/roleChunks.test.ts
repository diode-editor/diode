import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import iconv from "iconv-lite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";

import { startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath, getSelfExtractPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * The extension host loads the lazy chunk `lazy/roles/extension-host.cjs`, and the chunk has its own
 * copies of shared modules, including `base/common/lazyModule.ts` — the role entry re-installs
 * the chunk loader. Without that, `openTextDocument` in a single-byte encoding would look for iconv
 * in node_modules, which the SEA doesn't have. Other e2e tests don't see the chunk-from-chunk seam.
 * Self-extract: chunks are files next to `main.cjs`, and `entryDir()` in a CJS chunk must
 * find the directory without `import.meta` (`define` in scripts/build-lazy-chunks.mjs).
 */

const TEXT = "\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n"; // "Privet, mir!"

/** Synthetic extension: opens cp1251.txt as windows-1251 and writes the result to result.txt. */
const PROBE_MAIN = `
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
exports.activate = async () => {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    try {
        const uri = vscode.Uri.file(path.join(root, "cp1251.txt"));
        const doc = await vscode.workspace.openTextDocument(uri, { encoding: "windows1251" });
        fs.writeFileSync(path.join(root, "result.txt"), "OK " + doc.getText());
    } catch (e) {
        fs.writeFileSync(path.join(root, "result.txt"), "ERR " + ((e && e.stack) || e));
    }
};
`;

function writeVsix(vsixPath: string, entries: Readonly<Record<string, string>>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
        const out = fs.createWriteStream(vsixPath);
        out.on("close", () => {
            resolve();
        });
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

describe("process roles on SEA — lazy chunks", () => {
    let dir: string;
    let vsix: string;

    beforeAll(async () => {
        await getBinaryPath();
        dir = fs.mkdtempSync(join(os.tmpdir(), "diode-role-chunks-"));
        vsix = join(dir, "enc-probe.vsix");
        await writeVsix(vsix, {
            "extension/package.json": JSON.stringify({
                name: "enc-probe",
                publisher: "diode-test",
                version: "0.0.1",
                engines: { vscode: "^1.80.0" },
                activationEvents: ["onStartupFinished"],
                main: "./extension.js",
            }),
            "extension/extension.js": PROBE_MAIN,
        });
    }, 300_000);

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("extension host from a chunk loads the iconv chunk: openTextDocument in windows-1251", async () => {
        const { session, env } = await useHeadlessApp({
            files: { "cp1251.txt": iconv.encode(TEXT, "windows1251") },
            installVsix: [vsix],
        });
        expect(await probeResult(env.workspaceDir)).toBe(`OK ${TEXT}`);
        expect(await session.getOutput("extensions.host.stderr")).not.toContain("unexpected error");
    }, 120_000);

    it.skipIf(process.platform === "win32")(
        "self-extract: chunks are files next to main.cjs, the extension host finds the iconv chunk",
        async () => {
            const app = await startHeadlessApp({
                files: { "cp1251.txt": iconv.encode(TEXT, "windows1251") },
                installVsix: [vsix],
                binary: await getSelfExtractPath(),
            });
            try {
                expect(await probeResult(app.env.workspaceDir)).toBe(`OK ${TEXT}`);
            } finally {
                await app.dispose();
            }
        },
        300_000,
    );
});

/** What the probe extension wrote to result.txt. */
function probeResult(workspaceDir: string): Promise<string | null> {
    const result = join(workspaceDir, "result.txt");
    return waitUntil(
        () => (fs.existsSync(result) ? fs.readFileSync(result, "utf8") : null),
        (content) => content !== null,
        { describe: "result.txt from the extension" },
    );
}
