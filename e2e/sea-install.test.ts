import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";

/**
 * E2E против собранного SEA-бинаря для CLI-команд управления расширениями
 * (`--install-extension`/`--list-extensions`/`--uninstall-extension`).
 *
 * Это не TUI, а обычные команды «выполнил и вышел», поэтому спавним бинарь
 * напрямую и читаем stdout/exit code — без PTY (и без ConPTY-флака). Главная
 * ценность на Windows: только здесь реально исполняется путь установки —
 * ленивый `import("yauzl")` + require-шим `createRequire("file:///")` в SEA.
 */

interface CliResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runCli(binary: string, args: readonly string[]): Promise<CliResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

function buildVsix(vsixPath: string, entries: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) {
            zip.addBuffer(Buffer.from(content), name);
        }
        const out = fs.createWriteStream(vsixPath);
        out.on("close", () => resolve());
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

describe("SEA binary — extension install CLI", () => {
    let binary: string;
    let tempRoot: string;
    let userDataDir: string;
    let vsixPath: string;

    beforeAll(async () => {
        binary = await getBinaryPath();
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-sea-install-"));
        userDataDir = path.join(tempRoot, "user-data-root");
        vsixPath = path.join(tempRoot, "demo.vsix");
        await buildVsix(vsixPath, {
            "extension/package.json": JSON.stringify({
                name: "demo",
                publisher: "acme",
                version: "1.2.3",
                engines: { vscode: "^1.100.0" },
            }),
            "extension/node_modules/dep/index.js": "module.exports = 42;",
            "extension.vsixmanifest": "<PackageManifest/>",
            "[Content_Types].xml": "<Types/>",
        });
    }, 180_000);

    afterAll(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    it("installs a .vsix, lists it, then uninstalls it — through the SEA binary", async () => {
        const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", vsixPath]);
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.demo@1.2.3");

        // Расширение распаковано в ожидаемый scanner'ом layout, node_modules на месте.
        const extDir = path.join(userDataDir, "extensions", "acme.demo-1.2.3");
        expect(fs.existsSync(path.join(extDir, "package.json"))).toBe(true);
        expect(fs.existsSync(path.join(extDir, "node_modules", "dep", "index.js"))).toBe(true);

        const list = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(list.code).toBe(0);
        expect(list.stdout.trim()).toBe("acme.demo@1.2.3");

        const uninstall = await runCli(binary, ["--user-data-dir", userDataDir, "--uninstall-extension", "acme.demo"]);
        expect(uninstall.code).toBe(0);
        expect(uninstall.stdout).toContain("Uninstalled acme.demo");
        expect(fs.existsSync(extDir)).toBe(false);

        const listAfter = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(listAfter.code).toBe(0);
        expect(listAfter.stdout.trim()).toBe("");
    });

    it("reports a clear error and exits non-zero for a broken .vsix", async () => {
        const badVsix = path.join(tempRoot, "broken.vsix");
        await fs.promises.writeFile(badVsix, "this is not a zip");
        const badUserData = path.join(tempRoot, "user-data-broken");

        const res = await runCli(binary, ["--user-data-dir", badUserData, "--install-extension", badVsix]);
        expect(res.code).toBe(1);
        expect(res.stderr).toMatch(/valid \.vsix/);
    });
});
