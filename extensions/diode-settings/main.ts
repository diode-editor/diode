import * as vscode from "vscode";

import { type ILaunchCompletion, type LaunchRoot, provideLaunchCompletions } from "./lib/launchCompletion.ts";
import { getSettingsCompletionContext, offsetToPosition, positionToOffset } from "./lib/settingsContext.ts";
import { completionValuesFor } from "./lib/settingValues.ts";
import type { ISettingSchemaEntry } from "./settings-schema.generated.ts";
import { SETTINGS_SCHEMA } from "./settings-schema.generated.ts";

/**
 * The key catalog is embedded at build time: `scripts/generate-settings-schema.mjs`
 * generates `settings-schema.generated.ts` from app defaults and `contributes.configuration`
 * of builtin extensions; there is no runtime API behind the schema.
 */
export function activate(context: { readonly subscriptions: { dispose(): unknown }[] }): void {
    // Activate on any JSON, but suggest only in settings files.
    const selector = [
        { language: "json", pattern: "**/settings.json" },
        { language: "jsonc", pattern: "**/settings.json" },
        { language: "jsonc", pattern: "**/*.code-workspace" },
    ];

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            selector,
            {
                provideCompletionItems(
                    document: vscode.TextDocument,
                    position: vscode.Position,
                ): vscode.CompletionItem[] {
                    const text = document.getText();
                    const offset = positionToOffset(text, position.line, position.character);
                    const section = document.fileName.endsWith(".code-workspace") ? "settings" : undefined;
                    const where = getSettingsCompletionContext(text, offset, section);
                    if (where === null) return [];

                    const range = toRange(text, where.replaceRange);
                    if (where.kind === "key") {
                        return SETTINGS_SCHEMA.map((entry) => keyItem(entry, range));
                    }

                    const entry = SETTINGS_SCHEMA.find((e) => e.key === where.key);
                    if (entry === undefined) return [];
                    return completionValuesFor(entry).map((value) => valueItem(value, entry, range));
                },
            },
            '"',
        ),
        vscode.languages.registerCompletionItemProvider(
            [
                ...LAUNCH_FILES.flatMap((pattern) => ["json", "jsonc"].map((language) => ({ language, pattern }))),
                ...selector,
            ],
            {
                provideCompletionItems(
                    document: vscode.TextDocument,
                    position: vscode.Position,
                ): vscode.CompletionItem[] {
                    const text = document.getText();
                    const offset = positionToOffset(text, position.line, position.character);
                    const packageJSONs = vscode.extensions.all.map((extension) => extension.packageJSON as unknown);
                    return provideLaunchCompletions(
                        text,
                        offset,
                        launchRoots(document.fileName),
                        packageJSONs,
                        indentUnit(document),
                    ).map((completion) => launchItem(completion, text));
                },
            },
            '"',
        ),
    );
}

/** Upstream `.vscode/launch.json`; Diode keeps it in `.diode/`. */
const LAUNCH_FILES = ["**/.diode/launch.json", "**/.vscode/launch.json"];

function launchRoots(fileName: string): LaunchRoot[] {
    if (fileName.endsWith(".code-workspace")) return [["launch"], ["settings", "launch"]];
    if (fileName.endsWith("launch.json")) return [[]];
    return [["launch"]];
}

/** For `adjustWhitespace` until completions get a snippet session (#1035): the indentation of the document's editor. */
function indentUnit(document: vscode.TextDocument): string {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document) return "\t";
    const { insertSpaces, tabSize } = editor.options;
    return insertSpaces === true && typeof tabSize === "number" ? " ".repeat(tabSize) : "\t";
}

const LAUNCH_ITEM_KINDS = {
    property: vscode.CompletionItemKind.Property,
    value: vscode.CompletionItemKind.Value,
    snippet: vscode.CompletionItemKind.Snippet,
} as const;

function launchItem(completion: ILaunchCompletion, text: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(completion.label, LAUNCH_ITEM_KINDS[completion.kind]);
    item.insertText =
        completion.kind === "snippet" ? new vscode.SnippetString(completion.insertText) : completion.insertText;
    // Typed with the opening quote, shown without it (see `keyItem`).
    if (completion.kind === "property") item.filterText = completion.insertText;
    item.range = toRange(text, completion.replaceRange);
    item.detail = completion.detail;
    item.documentation = completion.documentation;
    return item;
}

function keyItem(entry: ISettingSchemaEntry, range: vscode.Range): vscode.CompletionItem {
    const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Property);
    item.insertText = JSON.stringify(entry.key);
    // The filter prefix comes with the opening quote and the label without it: without
    // filterText typing `"edi` would not narrow the list.
    item.filterText = item.insertText;
    item.range = range;
    const def = entry.default === undefined ? "" : ` (default: ${JSON.stringify(entry.default)})`;
    item.detail = `${entry.type ?? "setting"}${def}`;
    if (typeof entry.description === "string" && entry.description.length > 0) {
        item.documentation = entry.description;
    }
    return item;
}

/** `value` is a ready JSON literal (strings in quotes). */
function valueItem(value: string, entry: ISettingSchemaEntry, range: vscode.Range): vscode.CompletionItem {
    const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
    item.insertText = value;
    item.range = range;
    if (entry.default !== undefined && value === JSON.stringify(entry.default)) {
        item.detail = "default";
    }
    if (typeof entry.description === "string" && entry.description.length > 0) {
        item.documentation = entry.description;
    }
    return item;
}

function toRange(text: string, offsets: { start: number; end: number }): vscode.Range {
    const start = offsetToPosition(text, offsets.start);
    const end = offsetToPosition(text, offsets.end);
    return new vscode.Range(start.line, start.character, end.line, end.character);
}
