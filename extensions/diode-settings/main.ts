import * as vscode from "vscode";

import { getSettingsCompletionContext, offsetToPosition, positionToOffset } from "./lib/settingsContext.ts";
import { completionValuesFor } from "./lib/settingValues.ts";
import type { ISettingSchemaEntry } from "./settings-schema.generated.ts";
import { SETTINGS_SCHEMA } from "./settings-schema.generated.ts";

/**
 * Built-in Settings-editing extension (subprocess extension, plugin-API only).
 *
 * Демонстрирует ленивую активацию: активируется ТОЛЬКО при открытии JSON-документа
 * (`activationEvents: ["onLanguage:json", "onLanguage:jsonc"]`) — пока пользователь
 * не открыл JSON, subprocess под расширение не поднимается. Открыв `settings.json`
 * (Ctrl+,), пользователь получает автодополнение ключей настроек и их значений.
 *
 * Каталог ключей вшит на этапе сборки: `settings-schema.generated.ts` генерируется
 * `scripts/generate-settings-schema.mjs` из app-дефолтов + `contributes.configuration`
 * всех builtin-расширений и бандлится в `out/extension.cjs`. Никакого рантайм-API
 * за схемой расширение не ходит.
 *
 * Подсказки позиционно-зависимы (`lib/settingsContext.ts` поверх `jsonc-parser`):
 * в позиции ключа предлагаются ключи, в позиции значения — значения по схеме этого
 * ключа. Каждый элемент несёт явный `range`, накрывающий кавычки, поэтому вставка
 * их не удваивает и не оставляет висящую кавычку.
 */
export function activate(context: { readonly subscriptions: { dispose(): unknown }[] }): void {
    // Селектор с `pattern:"**/settings.json"`: активируемся на любом JSON
    // (onLanguage:json/jsonc), но подсказки отдаём только для файла настроек.
    const selector = [
        { language: "json", pattern: "**/settings.json" },
        { language: "jsonc", pattern: "**/settings.json" },
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
                    const where = getSettingsCompletionContext(text, offset);
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
    );
}

/** Ключ настройки: виден без кавычек, вставляется в кавычках — `range` их накрывает. */
function keyItem(entry: ISettingSchemaEntry, range: vscode.Range): vscode.CompletionItem {
    const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Property);
    item.insertText = JSON.stringify(entry.key);
    item.range = range;
    const def = entry.default === undefined ? "" : ` (default: ${JSON.stringify(entry.default)})`;
    item.detail = `${entry.type ?? "setting"}${def}`;
    if (typeof entry.description === "string" && entry.description.length > 0) {
        item.documentation = entry.description;
    }
    return item;
}

/** Значение настройки — уже готовый JSON-литерал (строки приходят в кавычках). */
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
