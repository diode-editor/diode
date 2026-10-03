import * as fs from "node:fs";

import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { ILogger } from "../../log/common/iLogger.ts";
import type { IUserKeybindingRule } from "../common/userKeybindings.ts";

/**
 * Loads and validates `keybindings.json` (JSONC). Tolerant like the settings
 * loader: a missing file → `[]`, parse errors are logged and best-effort parsed,
 * and individual invalid rules are dropped (a broken file must not crash bootstrap).
 */
export async function loadUserKeybindings(filePath: string, logger?: ILogger): Promise<IUserKeybindingRule[]> {
    let content: string;
    try {
        content = await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
        if (isFileNotFound(err)) return [];
        logger?.error(`Failed to read keybindings file ${filePath}`, err);
        return [];
    }

    return parseUserKeybindings(content, filePath, logger);
}

/** Разбирает содержимое `keybindings.json` (JSONC) теми же правилами, что и загрузка. */
export function parseUserKeybindings(content: string, filePath: string, logger?: ILogger): IUserKeybindingRule[] {
    const errors: ParseError[] = [];
    const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
    for (const err of errors) {
        logger?.error(
            `JSONC parse error in ${filePath} at offset ${String(err.offset)}: ${printParseErrorCode(err.error)}`,
        );
    }
    return validateRules(parsed, filePath, logger);
}

function validateRules(parsed: unknown, filePath: string, logger?: ILogger): IUserKeybindingRule[] {
    if (!Array.isArray(parsed)) {
        if (parsed !== undefined) logger?.error(`keybindings file ${filePath} must be a JSON array`);
        return [];
    }
    const rules: IUserKeybindingRule[] = [];
    for (const raw of parsed) {
        if (typeof raw !== "object" || raw === null) {
            logger?.error(`Skipping non-object keybinding rule in ${filePath}`);
            continue;
        }
        const rule = raw as Record<string, unknown>;
        const command = rule.command;
        const key = rule.key;
        if (typeof command !== "string" || command === "") {
            logger?.error(`Skipping keybinding rule with missing "command" in ${filePath}`);
            continue;
        }
        // An add rule needs a key; an unbind ("-command") may omit it (unbind all for the command).
        const isUnbind = command.startsWith("-");
        if ((typeof key !== "string" || key === "") && !isUnbind) {
            logger?.error(`Skipping keybinding rule with missing "key" for "${command}" in ${filePath}`);
            continue;
        }
        const when = rule.when;
        rules.push({
            key: typeof key === "string" ? key : "",
            command,
            when: typeof when === "string" && when !== "" ? when : undefined,
            args: rule.args,
        });
    }
    return rules;
}

function isFileNotFound(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
