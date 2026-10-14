import { randomBytes } from "node:crypto";
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
 * Общая обвязка сьютов extensionHost.bufLsp*: НАСТОЯЩИЙ сторонний vsix
 * bufbuild.vscode-buf из магазина, установленный штатным `installVsix`, —
 * ни строчки нашего кода расширения. Языковой сервер — `buf lsp serve`
 * настоящего бинаря `buf`.
 *
 * Бинарь расширение без PATH качает само, но перед этим КАЖДЫЙ старт спрашивает
 * у GitHub API последний релиз — без токена это 60 запросов в час на IP. Сьют
 * поэтому кладёт `buf` в свой кэш один раз и отдаёт его настройкой
 * `buf.commandLine.path` (её расширение проверяет первой). Путь пользователя с
 * автоскачиванием закрывает сценарий `buf-lsp` и смоук-чек магазина.
 */

/** id записи в реестре; e2e и сценарии ставят его напрямую через `--install-extension`. */
export const BUF_ID = "bufbuild.vscode-buf";

export const PROTO_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".proto") ? "proto" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * Канонический файл: сообщение с doc-комментарием (hover), его использование
 * в rpc (hover и F12), импорт well-known типа (резолвится без настройки) и
 * опечатка `Usr` (диагностика «cannot find `Usr`» — сигнал готовности
 * сервера). Строки 0-based: `message User` — 6, `Usr broken` — 10, пустая
 * строка в теле `User` — 11, `rpc Get(User…` — 15 (`User` с колонки 10).
 */
export const MAIN_PROTO = [
    'syntax = "proto3";',
    "package demo.v1;",
    "",
    'import "google/protobuf/timestamp.proto";',
    "",
    "// A user of the demo service.",
    "message User {",
    "  string name = 1;",
    "  int32 age = 2;",
    "  google.protobuf.Timestamp created = 3;",
    "  Usr broken = 4;",
    "  ",
    "}",
    "",
    "service Users {",
    "  rpc Get(User) returns (User);",
    "}",
    "",
].join("\n");

/** Неформатированный, но валидный файл — Format Document должен выровнять отступы. */
export const UNFORMATTED_PROTO = [
    'syntax = "proto3";',
    "package demo.v1;",
    "",
    "message   Point {",
    "int32 x=1;",
    "}",
    "",
].join("\n");

export interface IInstalledBuf {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же функцией, что приложение.
 */
export async function installBuf(): Promise<IInstalledBuf> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(BUF_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Кэш бинаря buf; в node_modules — вне рабочего дерева и переживает прогоны. */
const BUF_CLI_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-buf-cli");

/** Имя ассета релиза buf — та же таблица, что у расширения (`github.js`, `findAsset`). */
function bufAssetName(): string {
    const system = process.platform === "darwin" ? "Darwin" : "Linux";
    const arch = process.arch === "arm64" ? (process.platform === "darwin" ? "arm64" : "aarch64") : "x86_64";
    return `buf-${system}-${arch}`;
}

/**
 * Путь к бинарю `buf` последнего релиза. Тег узнаём редиректом
 * `releases/latest/download/…` (это не API, под его лимит не попадает),
 * скачиваем в кэш один раз на тег; гонку параллельных воркеров разруливает
 * атомарный rename, как в `stockVsix.ts`.
 */
export async function ensureBufCli(): Promise<string> {
    const asset = bufAssetName();
    // Первый редирект `latest` → `releases/download/<тег>/<ассет>`; дальше
    // GitHub шлёт в хранилище ассетов, где тега в адресе уже нет.
    const head = await fetch(`https://github.com/bufbuild/buf/releases/latest/download/${asset}`, {
        method: "HEAD",
        redirect: "manual",
    });
    const location = head.headers.get("location") ?? "";
    const tag = /\/releases\/download\/(v[^/]+)\//.exec(location)?.[1];
    if (tag === undefined) {
        throw new Error(`cannot resolve the latest buf release: HTTP ${String(head.status)}, location "${location}"`);
    }
    const cached = path.join(BUF_CLI_CACHE_DIR, tag, "buf");
    if (fs.existsSync(cached)) return cached;

    const response = await fetch(location);
    if (!response.ok) throw new Error(`cannot download ${location}: HTTP ${String(response.status)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    const temp = `${cached}.${randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o755 });
    fs.renameSync(temp, cached);
    return cached;
}
