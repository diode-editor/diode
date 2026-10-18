import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsixOrOpenVsx } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов на стоковый golang.go (extensionHost.goLsp*, e2e
 * goLsp, сценарий go-lsp): НАСТОЯЩИЙ vsix, установленный штатным
 * `installVsix`, — ни строчки нашего кода расширения. Клиент расширения
 * (стоковый vscode-languageclient) поднимает gopls по stdio.
 *
 * Чего нет в vsix — Go toolchain и gopls:
 * - **Go** — с машины (`go` в PATH; в CI его ставит `actions/setup-go`). Нет
 *   Go — сьюты честно пропускаются с причиной ({@link goToolchainMissing}):
 *   без него и в VS Code расширение отказывает в активации.
 * - **gopls** фикстура ставит заранее (`go install` в кэшируемый GOBIN, как
 *   `npm install eslint` у eslintFixture.ts) — иначе каждый прогон собирал бы
 *   его по сети. Путь авто-установки самим расширением закрывает один e2e.
 *
 * Vsix — из магазина, последней версией; пока записи `golang.go` в реестре нет
 * (A7 в docs/TODO/GoLSP.md) — последней universal-версией с Open VSX.
 */

/** id записи в реестре (и на Open VSX). */
export const GO_ID = "golang.go";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Канонический Go-модуль сьютов и сценария: тот же, что видит человек в демо. */
export const GO_SAMPLE_DIR = path.join(REPO_ROOT, "e2e", "fixtures", "goSample");

/** Кэш `go install gopls` — вне рабочего дерева, переживает прогоны (в CI — actions/cache). */
export const GO_TOOLS_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-go-fixture");
/** GOBIN с gopls: сюда же смотрит расширение (`getBinPath` проверяет `GOBIN`). */
export const GO_TOOLS_BIN = path.join(GO_TOOLS_DIR, "bin");

const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Окружение Go для сессий редактора в изолированном корне (e2e, сценарий).
 * Module cache Go по умолчанию read-only, и кэш, скачанный в изолированный HOME,
 * ронял уборку временного корня прогона (`EACCES` на `rmSync`) — `-modcacherw`
 * делает его удаляемым.
 */
export const GO_SESSION_ENV: Readonly<Record<string, string>> = { GOFLAGS: "-modcacherw", GOTOOLCHAIN: "local" };

/** Мини-сервис языков: `.go` → go, иначе — undefined. */
export const GO_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".go") ? "go" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * Файлы {@link GO_SAMPLE_DIR} (относительный путь → текст) — сид воркспейса для
 * харнесса и e2e. `main.go`: лишний импорт `"os"` и ошибка типов (диагностики),
 * вызов `greet.Hello` (hover с doc-комментарием и F12 в `greet/greet.go`),
 * неотформатированный `fmt.Println( msg,broken )` (format on save).
 */
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

/** Путь к `go` из PATH или `undefined`. */
export function findGoBinary(): string | undefined {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir === "") continue;
        const candidate = path.join(dir, `go${EXE}`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

/** Причина пропуска Go-сьютов или `undefined`, если Go есть. */
export function goToolchainMissing(): string | undefined {
    return findGoBinary() === undefined
        ? "Go toolchain не найден в PATH — сьюты golang.go пропущены (в CI его ставит actions/setup-go)"
        : undefined;
}

/**
 * Гарантирует кэшированный gopls (последняя версия на момент первого прогона;
 * версию не пиним — как у стоковых vsix) и возвращает путь к нему.
 */
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

/** Путь к vsix golang.go (кэш стоковых vsix; e2e и сценарий ставят его по пути). */
export async function fetchGoVsix(): Promise<string> {
    return (await fetchStockVsixOrOpenVsx(GO_ID)).vsixPath;
}

/**
 * Неизменный путь vsix для сценария: `installVsix` сценария — статическое поле,
 * а версия (и имя файла в кэше) становится известна только после резолва.
 * {@link prepareGoScenario} кладёт сюда свежий vsix перед запуском.
 */
export const GO_SCENARIO_VSIX = path.join(GO_TOOLS_DIR, "..", "diode-go-scenario", `${GO_ID}.vsix`);

/** Подготовка сценария go-lsp: gopls в кэше и vsix по {@link GO_SCENARIO_VSIX}. */
export async function prepareGoScenario(): Promise<void> {
    ensureGopls();
    const vsix = await fetchGoVsix();
    fs.mkdirSync(path.dirname(GO_SCENARIO_VSIX), { recursive: true });
    fs.copyFileSync(vsix, GO_SCENARIO_VSIX);
}

export interface IInstalledGo {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же функцией, что приложение. Курируемых
 * дефолтов нет: `go.testExplorer.enable` и прочие манифестные дефолты работают
 * как есть (Test API — инертный null-объект).
 */
export async function installGo(): Promise<IInstalledGo> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix(await fetchGoVsix(), extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
