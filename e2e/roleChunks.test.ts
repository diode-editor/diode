import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import iconv from "iconv-lite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Роли процесса — ленивые куски бандла (`roles/*` в scripts/build-lazy-chunks.mjs):
 * extension host грузит `lazy/roles/extension-host.cjs`, войдя в свою ветку
 * `main.ts`. Общие с редактором модули у куска свои, в том числе
 * `base/common/lazyModule.ts`, поэтому вход роли заново подставляет загрузчик
 * кусков. Без этого `openTextDocument` с однобайтной кодировкой искал бы iconv в
 * node_modules, которых у SEA нет. Остальное (активация, LSP, watcher) идёт через
 * куски в каждом e2e расширений; здесь — шов «кусок из куска», который они не видят.
 */

const TEXT = "Привет, мир!\n";

/** Синтетическое расширение: открывает cp1251.txt в windows-1251 и пишет результат в result.txt. */
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

describe("роли процесса на SEA — ленивые куски", () => {
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

    it("extension host из куска грузит кусок iconv: openTextDocument в windows-1251", async () => {
        const { session, env } = await useHeadlessApp({
            files: { "cp1251.txt": iconv.encode(TEXT, "windows1251") },
            installVsix: [vsix],
        });
        const result = join(env.workspaceDir, "result.txt");
        const text = await waitUntil(
            () => (fs.existsSync(result) ? fs.readFileSync(result, "utf8") : null),
            (content) => content !== null,
            { describe: "result.txt от расширения" },
        );
        expect(text).toBe(`OK ${TEXT}`);
        expect(await session.getOutput("extensions.host.stderr")).not.toContain("unexpected error");
    }, 120_000);
});
