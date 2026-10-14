import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { fetchStockVsix } from "../src/TestUtils/stockVsix.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";

/**
 * E2E против собранного SEA-бинаря для CLI-команд управления расширениями
 * (`--install-extension`/`--list-extensions`/`--uninstall-extension`).
 *
 * Это не TUI, а обычные команды «выполнил и вышел», поэтому спавним бинарь
 * напрямую и читаем stdout/exit code — без PTY (и без ConPTY-флака). Главная
 * ценность на Windows: только здесь реально исполняется путь установки в SEA —
 * yauzl из ленивого куска `lazy/yauzl.cjs` (ассет бинаря, `loadLazyModule`).
 * В `main.js` yauzl нет вовсе, запасной `import("yauzl")` в SEA упал бы, так
 * что успешная установка и есть доказательство, что кусок загрузился.
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

    it("--profile: ставит, перечисляет и удаляет в составе профиля; общий каталог чистится, когда расширение не нужно никому", async () => {
        const root = path.join(tempRoot, "user-data-profiles");
        const cli = (...args: string[]) => runCli(binary, ["--user-data-dir", root, ...args]);
        // Профиль `work` из прошлой версии — каталог без состава; пустой состав
        // задаём явно (без файла миграция отдала бы ему все установленные).
        const workDir = path.join(root, "user-data", "User", "profiles", "work");
        await fs.promises.mkdir(workDir, { recursive: true });
        await fs.promises.writeFile(path.join(workDir, "extensions.json"), "[]");

        const unknown = await cli("--profile", "nope", "--list-extensions");
        expect(unknown.code).toBe(1);
        expect(unknown.stderr).toContain("Profile 'nope' not found.");

        expect((await cli("--install-extension", vsixPath)).code).toBe(0);
        const installWork = await cli("--profile", "work", "--install-extension", vsixPath);
        expect(installWork.code).toBe(0);
        expect((await cli("--profile", "work", "--list-extensions")).stdout.trim()).toBe("acme.demo@1.2.3");

        // Убрали из work — в Default осталось, каталог на диске нужен ему.
        const extDir = path.join(root, "extensions", "acme.demo-1.2.3");
        expect((await cli("--profile", "work", "--uninstall-extension", "acme.demo")).code).toBe(0);
        expect((await cli("--profile", "work", "--list-extensions")).stdout.trim()).toBe("");
        expect((await cli("--list-extensions")).stdout.trim()).toBe("acme.demo@1.2.3");
        expect(fs.existsSync(extDir)).toBe(true);

        // Убрали из последнего профиля — ушёл и с диска.
        expect((await cli("--uninstall-extension", "acme.demo")).code).toBe(0);
        expect(fs.existsSync(extDir)).toBe(false);
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

/**
 * Тот же путь установки, но на настоящем стоковом `.vsix` из магазина (версию не
 * пиним — docs/TESTING.md «Тесты на стоковые расширения»): реальный zip от vsce,
 * а не собранный yazl'ом в тесте, проходит через ленивый кусок yauzl в SEA, а
 * установка по id — ещё и через кусок semver (разбор реестра, совместимость).
 */
describe.skipIf(MARKETPLACE_OFFLINE)("SEA binary — stock extension through the lazy chunks (yauzl, semver)", () => {
    const STOCK_ID = "EditorConfig.EditorConfig";
    let binary: string;
    let tempRoot: string;
    let stock: { vsixPath: string; version: string };

    beforeAll(async () => {
        binary = await getBinaryPath();
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-sea-stock-"));
        stock = await fetchStockVsix(STOCK_ID);
    }, 180_000);

    afterAll(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    // Установка по id из публичного реестра: разбор его meta и выбор версии,
    // совместимой с этой сборкой, идут через ленивый кусок semver
    // (`lazy/semver.cjs`), распаковка — через кусок yauzl. Ожидаемую версию тест
    // считает тем же правилом (`fetchStockVsix` → resolveCompatibleVersion) в
    // своём процессе, где semver берётся из node_modules.
    it("installs the stock extension by id from the registry: the compatible version is picked inside the binary", async () => {
        const userDataDir = path.join(tempRoot, "user-data-by-id");

        const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", STOCK_ID]);
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain(`Installed ${STOCK_ID}@${stock.version}`);

        const list = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(list.code).toBe(0);
        expect(list.stdout.trim()).toBe(`${STOCK_ID}@${stock.version}`);
    });

    it("installs the stock .vsix file, unpacks its entry point and lists it", async () => {
        const userDataDir = path.join(tempRoot, "user-data");

        const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", stock.vsixPath]);
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain(`Installed ${STOCK_ID}@${stock.version}`);

        // Распаковано целиком: манифест той же версии и точка входа, на которую он указывает.
        const extDir = path.join(userDataDir, "extensions", `${STOCK_ID}-${stock.version}`);
        const manifest = JSON.parse(await fs.promises.readFile(path.join(extDir, "package.json"), "utf8")) as {
            version: string;
            main: string;
        };
        expect(manifest.version).toBe(stock.version);
        const main = path.resolve(extDir, manifest.main);
        expect(fs.existsSync(main) || fs.existsSync(`${main}.js`)).toBe(true);

        const list = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(list.code).toBe(0);
        expect(list.stdout.trim()).toBe(`${STOCK_ID}@${stock.version}`);
    });
});
