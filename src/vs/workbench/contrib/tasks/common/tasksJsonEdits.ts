// Запись дописывается вставкой перед `]` массива `tasks`, а не `modify`: тот
// переформатировал бы соседнюю запись и унёс бы её хвостовой комментарий.

import {
    applyEdits,
    findNodeAtLocation,
    type FormattingOptions,
    modify,
    type Node,
    parse,
    type ParseError,
    parseTree,
    visit,
} from "jsonc-parser";

import type { ITask, ITaskGroup } from "./tasks.ts";

export interface ITasksJsonIndentation {
    readonly insertSpaces: boolean;
    readonly tabSize: number;
}

type Json = Record<string, unknown>;

export function expandTemplateTabs(content: string, indentation: ITasksJsonIndentation): string {
    if (!indentation.insertSpaces) return content;
    return content.replace(
        /(\n)(\t+)/g,
        (_, eol: string, tabs: string) => eol + " ".repeat(tabs.length * indentation.tabSize),
    );
}

function formattingOf(
    text: string,
    indentation: ITasksJsonIndentation,
): Required<Pick<FormattingOptions, "insertSpaces" | "tabSize" | "eol">> {
    return { ...indentation, eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

function parseObject(text: string): Json | undefined {
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || typeof root !== "object" || root === null || Array.isArray(root)) return undefined;
    return root as Json;
}

export function isWritableTasksJson(text: string): boolean {
    return text.trim() === "" || parseObject(text) !== undefined;
}

export function tasksJsonHasTasks(text: string): boolean {
    const tasks = parseObject(text)?.tasks;
    return Array.isArray(tasks) && tasks.length > 0;
}

/** Не группа по умолчанию — строкой (`GroupKind.to`). */
function groupToJson(group: ITaskGroup): string | Json {
    return group.isDefault === true ? { kind: group.id, isDefault: true } : group.id;
}

/** `_createCustomizableTask` эталона: матчеры — пустым списком, если у задачи их нет. */
export function customizationEntryOf(task: ITask): Json {
    const { _key: _ignored, ...identifier } = task.definition;
    return {
        ...identifier,
        problemMatcher: [...task.problemMatchers],
        ...(task.group !== undefined ? { group: groupToJson(task.group) } : {}),
        label: task._label,
        ...(task.detail !== undefined ? { detail: task.detail } : {}),
    };
}

export function newTasksJsonWith(entry: Json, indentation: ITasksJsonIndentation): string {
    const body = JSON.stringify({ version: "2.0.0", tasks: [entry] }, undefined, "\t").slice(1);
    const content = `{\n\t// See https://go.microsoft.com/fwlink/?LinkId=733558 \n\t// for the documentation about the tasks.json format${body}`;
    return expandTemplateTabs(content, indentation);
}

/** Нет `version` — ставится 2.0.0: без неё Diode файл не читает. Текст обязан пройти {@link isWritableTasksJson}. */
export function appendTaskEntry(
    text: string,
    entry: Json,
    indentation: ITasksJsonIndentation,
): { readonly text: string; readonly index: number } {
    if (text.trim() === "") return { text: newTasksJsonWith(entry, indentation), index: 0 };
    const options = { formattingOptions: formattingOf(text, indentation) };
    let next = text;
    // Stryker disable next-line OptionalChaining: эквивалентный — текст пригоден для записи (контракт), разбор даёт объект; `?.` — для типов
    if (parseObject(next)?.version === undefined) {
        next = applyEdits(next, modify(next, ["version"], "2.0.0", options));
    }
    const tasks = findTasksNode(next, []);
    if (tasks?.type !== "array") {
        return { text: applyEdits(next, modify(next, ["tasks"], [entry], options)), index: 0 };
    }
    // Stryker disable next-line ArrayDeclaration: эквивалентный — у узла-массива jsonc-parser `children` есть всегда (у пустого — []); фоллбэк — для типов
    const children = tasks.children ?? [];
    return { text: insertLastElement(next, tasks, children, entry, options.formattingOptions), index: children.length };
}

/** Пустой текст — `undefined`. */
function findTasksNode(text: string, rest: readonly number[]): Node | undefined {
    // Разбор терпимый сам: висячие запятые — ошибка в `errors`, дерево строится всё равно.
    const root = parseTree(text);
    // Stryker disable next-line ConditionalExpression: эквивалентный — findNodeAtLocation без корня сам отвечает undefined; проверка — для типов
    return root === undefined ? undefined : findNodeAtLocation(root, ["tasks", ...rest]);
}

function lineStartOf(text: string, offset: number): number {
    return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineIndentAt(text: string, offset: number): string {
    const lineStart = lineStartOf(text, offset);
    let end = lineStart;
    while (text.charAt(end) === " " || text.charAt(end) === "\t") end++;
    return text.slice(lineStart, end);
}

/** Отступ — как у последнего элемента на своей строке, иначе отступ строки массива плюс шаг. */
function insertLastElement(
    text: string,
    array: Node,
    children: readonly Node[],
    entry: Json,
    formatting: Required<Pick<FormattingOptions, "insertSpaces" | "tabSize" | "eol">>,
): string {
    const { eol } = formatting;
    const unit = formatting.insertSpaces ? " ".repeat(formatting.tabSize) : "\t";
    const close = array.offset + array.length - 1;
    // Пробелы и переводы строк перед `]` уходят: элемент встаёт за последним непробельным
    // (запятой, комментарием или `[`).
    let insertAt = close;
    while (/\s/u.test(text.charAt(insertAt - 1))) insertAt--;
    const elementAt = (indent: string): string => {
        const body = JSON.stringify(entry, undefined, unit)
            .split("\n")
            .join(eol + indent);
        return `${eol}${indent}${body}${eol}${lineIndentAt(text, close)}`;
    };
    const last = children.at(-1);
    const arrayStepIndent = lineIndentAt(text, array.offset) + unit;
    if (last === undefined) return text.slice(0, insertAt) + elementAt(arrayStepIndent) + text.slice(close);
    // Последний элемент один в начале своей строки — его отступ; иначе (делит строку с `[`) — от массива.
    const lastIndent = lineIndentAt(text, last.offset);
    const ownLine = lineStartOf(text, last.offset) + lastIndent.length === last.offset;
    const element = elementAt(ownLine ? lastIndent : arrayStepIndent);
    const lastEnd = last.offset + last.length;
    const comma = hasComma(text, lastEnd, close) ? "" : ",";
    return text.slice(0, lastEnd) + comma + text.slice(lastEnd, insertAt) + element + text.slice(close);
}

/** Двоеточия там не бывает — любой разделитель в этом промежутке запятая. */
function hasComma(text: string, from: number, to: number): boolean {
    let found = false;
    visit(text, {
        onSeparator: (_character, offset) => {
            // Stryker disable next-line EqualityOperator: эквивалентный — на `to` стоит `]`, разделителя там не бывает
            if (offset >= from && offset < to) found = true;
        },
    });
    return found;
}

/** Пустой файл получает шаблон целиком, иначе в файл переносятся ключи шаблона. */
export function applyTaskTemplate(text: string, template: string, indentation: ITasksJsonIndentation): string {
    const content = expandTemplateTabs(template, indentation);
    if (text.trim() === "") return content;
    const values = parseObject(content) ?? {};
    const options = { formattingOptions: formattingOf(text, indentation) };
    let next = text;
    for (const [key, value] of Object.entries(values)) next = applyEdits(next, modify(next, [key], value, options));
    return next;
}

export function taskEntryRange(
    text: string,
    index: number,
): { readonly start: number; readonly end: number } | undefined {
    const node = findTasksNode(text, [index]);
    return node === undefined ? undefined : { start: node.offset, end: node.offset + node.length };
}
