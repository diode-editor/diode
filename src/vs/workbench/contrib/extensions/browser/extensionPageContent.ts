import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";

import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

// Перенос по словам считаем сами: в tuidom нет wrap-элемента (`TextBlockElement` — блок фиксированных строк).

export type ExtensionPageTone = "normal" | "dim" | "warning";

export interface IExtensionPageLine {
    readonly text: string;
    readonly tone: ExtensionPageTone;
}

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
    readonly operationError: string | null;
}

const MIN_WRAP_WIDTH = 8;

/** Пустые строки сохраняются (разделитель абзацев), слово длиннее ширины режется жёстко. */
export function wrapText(text: string, width: number): string[] {
    const limit = Math.max(MIN_WRAP_WIDTH, width);
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(" ")) {
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
        // Хвост выталкиваем всегда: у абзаца из одних пробелов он пустой — это и есть пустая строка абзаца.
        out.push(line);
    }
    return out;
}

/** Число кусков считаем заранее, а не циклом «пока длинно»: такой цикл мутанты зацикливали, вешая раннер. */
function splitLongWord(word: string, limit: number): string[] {
    const chunks = Math.ceil(word.length / limit);
    return Array.from({ length: chunks }, (_, i) => word.slice(i * limit, (i + 1) * limit));
}

/** По версиям, а не по `availability`: так у каждой ветки есть достижимое состояние. */
export function statusLine(entry: IExtensionListEntry): string {
    if (entry.availability === "incompatible") return "Incompatible with this build of Diode";
    if (entry.installedVersion === null) return "Not installed";
    if (entry.latestVersion !== null && entry.latestVersion !== entry.installedVersion) {
        return `Installed ${entry.installedVersion} · update available: ${entry.latestVersion}`;
    }
    return `Installed ${entry.installedVersion}`;
}

/** Текст ищет демо-сценарий — он часть контракта страницы. */
export const PARTIAL_SUPPORT_HEADLINE = "Partial support: some features do not work in Diode";

const WORKS_TITLE = "Works in Diode:";
const LIMITS_TITLE = "Does not work:";

/** Из карточки, а не из меты: пометка приезжает уже в индексе, и блок виден, даже когда меты нет. */
export function buildSupportLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const support = content.entry.support;
    const { lines, push, wrapped } = lineWriter(width);
    if (support?.level !== "partial") return lines;

    // Заголовок не повторяем: он уже стоит в закреплённой шапке, а тело под ней
    // прокручивается — дубль читался бы как вторая, другая новость.
    for (const [title, items, tone] of [
        [WORKS_TITLE, support.works, "dim"],
        [LIMITS_TITLE, support.limits, "warning"],
    ] as const) {
        if (items === undefined || items.length === 0) continue;
        push(title, "dim");
        // Маркер без ведущих пробелов: `wrapText` режет по пробелам, и отступ всё равно бы потерялся.
        for (const item of items) wrapped(`- ${item}`, tone);
    }
    push("");
    return lines;
}

function requirementsOf(meta: IRegistryExtensionMeta | undefined, version: string | null): string {
    const engines = meta?.versions.find((v) => v.version === version)?.engines;
    const parts: string[] = [];
    if (engines?.diode !== undefined) parts.push(`diode ${engines.diode}`);
    if (engines?.vscode !== undefined) parts.push(`vscode ${engines.vscode}`);
    return parts.join(", ");
}

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

/** Закреплена над readme, поэтому кончается пустой строкой-зазором перед рядом кнопок. */
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
    if (entry.support?.level === "partial") push(PARTIAL_SUPPORT_HEADLINE, "warning");
    if (meta?.license !== undefined) push(`License: ${meta.license}`, "dim");
    if (meta?.repository !== undefined) wrapped(`Repository: ${meta.repository}`, "dim");
    if (meta?.homepage !== undefined) wrapped(`Homepage: ${meta.homepage}`, "dim");
    if (operationError !== null) wrapped(operationError, "warning");
    push("");
    return lines;
}

/** Readme как есть: рендерера markdown в проекте нет. */
export function buildExtensionBodyLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { meta, metaError } = content;
    const { lines, wrapped } = lineWriter(width);
    // Что урезано — раньше readme и раньше веток «меты нет»: пометка приходит уже с индексом.
    lines.push(...buildSupportLines(content, width));

    if (metaError !== null) {
        wrapped(`Cannot read this extension from the registry: ${metaError}`, "warning");
        return lines;
    }
    if (meta === undefined) {
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
