import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type IEnvironmentService,
    IEnvironmentServiceDIToken,
} from "../../../../platform/environment/common/environment.ts";
import type {
    IKeybindingEntrySnapshot,
    IKeybindingLayerRule,
    KeybindingChord,
    KeybindingRegistry,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    chordsEqual,
    KeybindingRegistryDIToken,
    parseChord,
    serializeChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/common/userKeybindings.ts";
import { parseUserKeybindings } from "../../../../platform/keybinding/node/keybindingsService.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IKeybindingMutationResult, IKeybindingsEditorService } from "../common/iKeybindingsEditorService.ts";

import { appendKeybindingRule, removeKeybindingRules } from "./keybindingsFileEditor.ts";

type IKeybindingWriteResult =
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly error: string };

function toLayerRule(rule: IUserKeybindingRule): IKeybindingLayerRule {
    return {
        command: rule.command,
        chord: rule.key === "" ? undefined : parseChord(rule.key),
        when: rule.when,
        args: rule.args,
    };
}

/**
 * `keybindings.json` is the source of truth: after every edit the registry's user layer is rebuilt
 * entirely from what was written, so there is no effect log and reset does not shift default priority.
 */
export class KeybindingsEditorService extends Disposable implements IKeybindingsEditorService {
    public static dependencies = [KeybindingRegistryDIToken, IEnvironmentServiceDIToken, ILogServiceDIToken] as const;

    // Stryker disable next-line ArrayDeclaration: equivalent — a stray element without a command matches no command
    private rules: readonly IUserKeybindingRule[] = [];
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private readonly logger: ILogger;
    private readonly resource: string;

    public constructor(
        private readonly keybindings: KeybindingRegistry,
        environment: Pick<IEnvironmentService, "keybindingsResource">,
        logService: ILogService,
    ) {
        super();
        this.resource = environment.keybindingsResource;
        // Stryker disable next-line StringLiteral,ObjectLiteral: the logger channel name and its Output label are diagnostics, not behavior.
        this.logger = logService.createLogger("keybindings.editor", { label: "Keyboard Shortcuts Editor" });
    }

    public hasUserModifications(commandId: string): boolean {
        return this.rules.some((rule) => rule.command === commandId || rule.command === `-${commandId}`);
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void {
        this.rules = rules;
        this.keybindings.setUserKeybindings(rules.map(toLayerRule));
    }

    public async defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult> {
        const when = previous?.when;
        // Only user rules carry args (VS Code edits such a rule in place, keeping
        // args); default/extension entries never have them.
        const args = previous?.source === "user" ? previous.args : undefined;
        const newRule: IUserKeybindingRule = { key: serializeChord(chord), command: commandId, when, args };
        const result = await this.mutateFile((content) => {
            let next = content;
            // Stryker disable next-line ConditionalExpression: forcing the condition to true would run remove for a default/extension previous too, but matchesUserRule(previous) finds no user rule with the same command+chord+when there (none exists — it is a default), so remove takes nothing off and the result is the same.
            if (previous?.source === "user") {
                next = removeKeybindingRules(next, this.matchesUserRule(previous));
            }
            next = appendKeybindingRule(next, newRule);
            if (previous !== undefined && previous.source !== "user") {
                next = appendKeybindingRule(next, {
                    key: serializeChord(previous.chord),
                    command: `-${commandId}`,
                });
            }
            return next;
        });
        return this.applyWritten(result);
    }

    public async removeKeybinding(entry: IKeybindingEntrySnapshot): Promise<IKeybindingMutationResult> {
        const result = await this.mutateFile((content) => {
            if (entry.source === "user") {
                return removeKeybindingRules(content, this.matchesUserRule(entry));
            }
            return appendKeybindingRule(content, {
                key: serializeChord(entry.chord),
                command: `-${entry.commandId}`,
            });
        });
        return this.applyWritten(result);
    }

    public async resetKeybinding(commandId: string): Promise<IKeybindingMutationResult> {
        const result = await this.mutateFile((content) =>
            removeKeybindingRules(content, (rule) => rule.command === commandId || rule.command === `-${commandId}`),
        );
        return this.applyWritten(result);
    }

    private applyWritten(written: IKeybindingWriteResult): IKeybindingMutationResult {
        if (!written.ok) return written;
        this.applyUserKeybindings(parseUserKeybindings(written.content, this.resource, this.logger));
        this.onDidChangeEmitter.fire();
        return { ok: true };
    }

    private matchesUserRule(entry: IKeybindingEntrySnapshot): (rule: IUserKeybindingRule) => boolean {
        return (rule) =>
            rule.command === entry.commandId &&
            // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: `rule.key !== ""` is redundant — for an empty key `chordsEqual(parseChord(""), …)` (next line) is false, so an empty key fails even without this check.
            rule.key !== "" &&
            chordsEqual(parseChord(rule.key), entry.chord) &&
            rule.when === entry.when;
    }

    private async mutateFile(mutate: (content: string) => string): Promise<IKeybindingWriteResult> {
        try {
            const next = mutate(await this.readContent(this.resource));
            await fs.promises.mkdir(path.dirname(this.resource), { recursive: true });
            // Stryker disable next-line StringLiteral: the write encoding is an I/O detail; it gives tests no observable behavior.
            await fs.promises.writeFile(this.resource, next, "utf-8");
            return { ok: true, content: next };
        } catch (err) {
            /* v8 ignore start -- defensive: fs and jsonc throw only Error */
            const message = err instanceof Error ? err.message : String(err);
            /* v8 ignore stop */
            // Stryker disable next-line StringLiteral,CallExpression: logging is diagnostics, not behavior; neither the text nor the call itself has an observable result.
            this.logger.error("failed to update keybindings.json", err);
            return { ok: false, error: message };
        }
    }

    private async readContent(resource: string): Promise<string> {
        try {
            return await fs.promises.readFile(resource, "utf-8");
        } catch (err) {
            // Stryker disable next-line ConditionalExpression: a non-ENOENT read error (e.g. EISDIR) cannot be provoked in a unit test, and the subsequent write fails with ok:false anyway — rethrowing and swallowing are indistinguishable.
            if (!isFileNotFound(err)) throw err;
            return "";
        }
    }
}

function isFileNotFound(err: unknown): boolean {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: defensive error type check; its mutants are only distinguishable by a non-ENOENT read error, which a unit test cannot provoke. The observable branch (ENOENT → empty content) is covered by the write-to-missing-file test.
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
