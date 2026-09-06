import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/**
 * Содержимое страницы расширения как строки — чистая функция от карточки, меты
 * и ширины. Разметку читают тесты, а элемент лишь раскладывает готовые строки:
 * перенос по словам считаем сами, потому что в tuidom нет wrap-элемента
 * (`TextBlockElement` — блок фиксированных строк).
 */

/** Тон строки: цвет решает элемент, содержание — эта функция. */
export type ExtensionPageTone = "normal" | "dim" | "warning";

export interface IExtensionPageLine {
    readonly text: string;
    readonly tone: ExtensionPageTone;
}

export interface IExtensionPageContent {
    readonly entry: IExtensionListEntry;
    /** Мета реестра; `undefined` — записи нет (расширение поставлено мимо магазина). */
    readonly meta: IRegistryExtensionMeta | undefined;
    /** Почему меты нет (сетевой сбой); `null` — реестр ответил. */
    readonly metaError: string | null;
}

/** Ширина, уже недостаточная для осмысленного переноса: ниже неё не режем. */
const MIN_WRAP_WIDTH = 8;

/**
 * Перенос по словам. Пустые строки сохраняются (в markdown это разделитель
 * абзацев), слово длиннее ширины режется жёстко — иначе оно ушло бы за край.
 */
export function wrapText(text: string, width: number): string[] {
    const limit = Math.max(MIN_WRAP_WIDTH, width);
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
        // Пустые куски (лишние пробелы, пустой абзац) отдельных веток не требуют:
        // цикл их пропускает, а хвост выталкивается как есть — пустой строкой.
        let line = "";
        for (const word of paragraph.split(" ")) {
            if (word.length === 0) continue;
            if (line.length === 0) {
                line = word;
            } else if (line.length + 1 + word.length <= limit) {
                line += ` ${word}`;
            } else {
                out.push(line);
                line = word;
            }
            while (line.length > limit) {
                out.push(line.slice(0, limit));
                line = line.slice(limit);
            }
        }
        // Хвост выталкиваем всегда: у абзаца из одних пробелов он пустой — и
        // пустая строка как раз и есть то, что абзац означает.
        out.push(line);
    }
    return out;
}

/**
 * Человеческий статус карточки — та же информация, что бейдж строки списка.
 * Считается по версиям, а не по `availability`: тогда у каждой ветки есть
 * достижимое состояние, а «установлено, но версия неизвестна» просто не
 * выражается.
 */
export function statusLine(entry: IExtensionListEntry): string {
    if (entry.availability === "incompatible") return "Incompatible with this build of Diode";
    if (entry.installedVersion === null) return "Not installed";
    if (entry.latestVersion !== null && entry.latestVersion !== entry.installedVersion) {
        return `Installed ${entry.installedVersion} · update available: ${entry.latestVersion}`;
    }
    return `Installed ${entry.installedVersion}`;
}

/** `engines` последней версии одной строкой; пусто — требований нет. */
function requirementsOf(meta: IRegistryExtensionMeta | undefined, version: string | null): string {
    const engines = meta?.versions.find((v) => v.version === version)?.engines;
    const parts: string[] = [];
    if (engines?.diode !== undefined) parts.push(`diode ${engines.diode}`);
    if (engines?.vscode !== undefined) parts.push(`vscode ${engines.vscode}`);
    return parts.join(", ");
}

/**
 * Строки страницы: шапка (идентичность, состояние, требования, ссылки), пустая
 * строка и readme. Readme у нас markdown как есть — рендерера разметки в
 * проекте нет, и заводить его ради страницы магазина не стали.
 */
export function buildExtensionPageLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { entry, meta, metaError } = content;
    const lines: IExtensionPageLine[] = [];
    const push = (text: string, tone: ExtensionPageTone = "normal"): void => {
        lines.push({ text, tone });
    };
    const wrapped = (text: string, tone: ExtensionPageTone = "normal"): void => {
        for (const line of wrapText(text, width)) push(line, tone);
    };

    wrapped(entry.displayName);
    push(entry.id, "dim");
    if (entry.description.length > 0) wrapped(entry.description);
    push("");

    push(statusLine(entry), entry.availability === "incompatible" ? "warning" : "dim");
    const version = entry.latestVersion ?? entry.installedVersion;
    if (entry.latestVersion !== null) push(`Latest version: ${entry.latestVersion}`, "dim");
    const requirements = requirementsOf(meta, version);
    if (requirements.length > 0) push(`Requires: ${requirements}`, "dim");
    if (entry.kind !== undefined) push(`Kind: ${entry.kind}`, "dim");
    if (meta?.license !== undefined) push(`License: ${meta.license}`, "dim");
    if (meta?.repository !== undefined) wrapped(`Repository: ${meta.repository}`, "dim");
    if (meta?.homepage !== undefined) wrapped(`Homepage: ${meta.homepage}`, "dim");
    push("");

    if (metaError !== null) {
        wrapped(`Cannot read this extension from the registry: ${metaError}`, "warning");
        return lines;
    }
    if (meta === undefined) {
        // Установлено мимо магазина: реестр про него ничего не знает, и
        // выдумывать описание неоткуда.
        wrapped("This extension is not in the marketplace — it was installed from a file.", "dim");
        return lines;
    }
    if (meta.readme === undefined) {
        wrapped("No readme published for this extension.", "dim");
        return lines;
    }
    wrapped(meta.readme);
    return lines;
}
