import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";

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

/**
 * Тон → цвет темы. Таблицей, а не switch: тон — это данные. Живёт рядом с
 * типом тона, потому что красят строки обе половины страницы (шапка и тело).
 */
export const TONE_COLORS: Record<ExtensionPageTone, StyleColor> = {
    normal: INHERITED_FG,
    dim: "descriptionForeground",
    warning: "editorWarning.foreground",
};

export interface IExtensionPageContent {
    readonly entry: IExtensionListEntry;
    /** Мета реестра; `undefined` — записи нет (расширение поставлено мимо магазина). */
    readonly meta: IRegistryExtensionMeta | undefined;
    /** Почему меты нет (сетевой сбой); `null` — реестр ответил. */
    readonly metaError: string | null;
    /** Чем кончилась последняя установка/удаление; `null` — ошибки не было. */
    readonly operationError: string | null;
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
        let line = "";
        for (const word of paragraph.split(" ")) {
            // Пустые куски (двойной пробел, пустой абзац) отдельной ветки не
            // требуют: у пустого слова нет ни одного куска, и цикл ниже его
            // молча пропускает.
            for (const piece of splitLongWord(word, limit)) {
                if (line.length === 0) {
                    line = piece;
                } else if (line.length + 1 + piece.length <= limit) {
                    line += ` ${piece}`;
                } else {
                    out.push(line);
                    line = piece;
                }
            }
        }
        // Хвост выталкиваем всегда: у абзаца из одних пробелов он пустой — и
        // пустая строка как раз и есть то, что абзац означает.
        out.push(line);
    }
    return out;
}

/**
 * Слово длиннее строки — на куски по лимиту; короткое отдаётся одним куском.
 * Число кусков считаем заранее, а не режем циклом «пока длинно»: у функции
 * переноса тогда не остаётся конструкции, способной зациклиться (мутационный
 * прогон именно так и вешал раннер, роняя соседние мутанты в «не проверено»).
 */
function splitLongWord(word: string, limit: number): string[] {
    const chunks = Math.ceil(word.length / limit);
    return Array.from({ length: chunks }, (_, i) => word.slice(i * limit, (i + 1) * limit));
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

/** Накопитель строк: сам переносит по ширине и помнит тон. */
function lineWriter(width: number): {
    lines: IExtensionPageLine[];
    push: (text: string, tone?: ExtensionPageTone) => void;
    wrapped: (text: string, tone?: ExtensionPageTone) => void;
} {
    const lines: IExtensionPageLine[] = [];
    const push = (text: string, tone: ExtensionPageTone = "normal"): void => {
        lines.push({ text, tone });
    };
    const wrapped = (text: string, tone: ExtensionPageTone = "normal"): void => {
        for (const line of wrapText(text, width)) push(line, tone);
    };
    return { lines, push, wrapped };
}

/**
 * Шапка страницы: идентичность, состояние, требования, ссылки и — если
 * установка/удаление сорвались — причина. Живёт закреплённой над readme,
 * поэтому кончается пустой строкой-зазором перед рядом кнопок.
 */
export function buildExtensionHeaderLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { entry, meta, operationError } = content;
    const { lines, push, wrapped } = lineWriter(width);

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
    if (operationError !== null) wrapped(operationError, "warning");
    push("");
    return lines;
}

/**
 * Тело страницы: readme реестра как есть — рендерера markdown в проекте нет, и
 * заводить его ради страницы магазина не стали. Вместо readme может стоять
 * причина, по которой его нет.
 */
export function buildExtensionBodyLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { meta, metaError } = content;
    const { lines, wrapped } = lineWriter(width);

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
