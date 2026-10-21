import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Go с машины (`go` в PATH): без него и в VS Code расширение не активируется, и
 * сьюты пропускаются ({@link goToolchainMissing}). gopls ставится заранее в
 * кэшируемый GOBIN, иначе каждый прогон собирал бы его по сети.
 */

/** Как в манифесте vsix: Open VSX пишет `golang/Go`, а клиент сверяет id с манифестом побайтно. */
export const GO_ID = "golang.go";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const GO_SAMPLE_DIR = path.join(REPO_ROOT, "e2e", "fixtures", "goSample");

export const GO_TOOLS_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-go-fixture");
/** Сюда же смотрит расширение: `getBinPath` проверяет `GOBIN`. */
export const GO_TOOLS_BIN = path.join(GO_TOOLS_DIR, "bin");

const EXE = process.platform === "win32" ? ".exe" : "";

export const GO_MODCACHE = path.join(REPO_ROOT, "node_modules", ".cache", "diode-go-modcache");

/**
 * Module cache Go read-only: скачанный в изолированный HOME (расширение само ставит
 * `vscgo`), он ронял уборку корня `EACCES`; `-modcacherw` расширение не пробрасывает.
 */
export const GO_SESSION_ENV: Readonly<Record<string, string>> = { GOMODCACHE: GO_MODCACHE, GOTOOLCHAIN: "local" };

export const GO_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".go") ? "go" : undefined),
    getLanguageDisplayName: () => undefined,
};

export function goSampleFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else files[path.relative(GO_SAMPLE_DIR, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf-8");
        }
    };
    walk(GO_SAMPLE_DIR);
    return files;
}

export function findGoBinary(): string | undefined {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir === "") continue;
        const candidate = path.join(dir, `go${EXE}`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

export function goToolchainMissing(): string | undefined {
    return findGoBinary() === undefined
        ? "Go toolchain не найден в PATH — сьюты golang.go пропущены (в CI его ставит actions/setup-go)"
        : undefined;
}

/** Версию gopls не пиним — как у стоковых vsix. */
export function ensureGopls(): string {
    const gopls = path.join(GO_TOOLS_BIN, `gopls${EXE}`);
    if (fs.existsSync(gopls)) return gopls;
    const go = findGoBinary();
    if (go === undefined) throw new Error(goToolchainMissing());
    fs.mkdirSync(path.dirname(GO_TOOLS_DIR), { recursive: true });
    const staging = fs.mkdtempSync(`${GO_TOOLS_DIR}.`);
    execFileSync(go, ["install", "golang.org/x/tools/gopls@latest"], {
        env: { ...process.env, GOBIN: path.join(staging, "bin"), GOFLAGS: "-mod=mod" },
        stdio: "pipe",
        timeout: 600_000,
    });
    try {
        fs.renameSync(staging, GO_TOOLS_DIR);
    } catch {
        // Параллельный воркер успел первым — его сборка ничем не хуже.
        fs.rmSync(staging, { recursive: true, force: true });
    }
    return gopls;
}

export interface IInstalledGo {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installGo(): Promise<IInstalledGo> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(GO_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
