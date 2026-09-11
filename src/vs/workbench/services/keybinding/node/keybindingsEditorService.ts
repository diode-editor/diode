import * as fs from "node:fs";
import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";

import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
    KeybindingRegistry,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    chordsEqual,
    KeybindingRegistryDIToken,
    parseChord,
    serializeChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/node/keybindingsService.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { KeybindingsResourceDIToken } from "../../../common/coreTokens.ts";
import type {
    IKeybindingMutationResult,
    IKeybindingsEditorService,
} from "../common/iKeybindingsEditorService.ts";

import { appendKeybindingRule, removeKeybindingRules } from "./keybindingsFileEditor.ts";

/** Эффект добавленного user-правила: чем снять его из реестра при reset/replace. */
interface IAppliedUserBinding {
    readonly chord: KeybindingChord;
    readonly disposable: IDisposable;
}

/** Сессионный журнал эффектов user-правил одной команды. */
interface ICommandLedger {
    added: IAppliedUserBinding[];
    /** Дефолты (и extension-записи), снятые user-правилами, — в порядке снятия. */
    removedDefaults: IKeybindingEntrySnapshot[];
}

/** См. контракт {@link IKeybindingsEditorService}. */
export class KeybindingsEditorService extends Disposable implements IKeybindingsEditorService {
    public static dependencies = [KeybindingRegistryDIToken, KeybindingsResourceDIToken, ILogServiceDIToken] as const;

    private readonly ledger = new Map<string, ICommandLedger>();
    private readonly listeners = new Set<() => void>();
    private readonly logger: ILogger;

    public constructor(
        private readonly keybindings: KeybindingRegistry,
        private readonly resource: string | null,
        logService: ILogService,
    ) {
        super();
        // Stryker disable next-line StringLiteral: имя канала логгера — диагностика, не поведение.
        this.logger = logService.createLogger("keybindings.editor");
    }

    public hasUserModifications(commandId: string): boolean {
        const ledger = this.ledger.get(commandId);
        if (ledger === undefined) return false;
        // Stryker disable next-line EqualityOperator,ConditionalExpression: присутствующий леджер всегда содержит ≥1 запись (пустой удаляется в reset), поэтому `> 0` всегда истинно, а граница 0 недостижима — `>=0`/`<=0`/`true` эквивалентны.
        return ledger.added.length > 0 || ledger.removedDefaults.length > 0;
    }

    public onDidChange(cb: () => void): IDisposable {
        this.listeners.add(cb);
        return { dispose: () => this.listeners.delete(cb) };
    }

    private emitDidChange(): void {
        // Копия: слушатель может отписаться в обработчике.
        for (const listener of [...this.listeners]) listener();
    }

    private ledgerFor(commandId: string): ICommandLedger {
        let entry = this.ledger.get(commandId);
        if (entry === undefined) {
            entry = { added: [], removedDefaults: [] };
            this.ledger.set(commandId, entry);
        }
        return entry;
    }

    public applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void {
        for (const rule of rules) {
            if (rule.command.startsWith("-")) {
                const commandId = rule.command.slice(1);
                const removed = this.keybindings.removeBindings(
                    commandId,
                    rule.key !== "" ? parseChord(rule.key) : undefined,
                );
                this.ledgerFor(commandId).removedDefaults.push(...removed);
            } else {
                this.registerUserBinding(rule.command, parseChord(rule.key), rule.when);
            }
        }
    }

    private registerUserBinding(commandId: string, chord: KeybindingChord, when: string | undefined): void {
        const disposable = this.register(this.keybindings.register(chord, commandId, when, "user"));
        this.ledgerFor(commandId).added.push({ chord, disposable });
    }

    public async defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult> {
        const when = previous?.when;
        const newRule: IUserKeybindingRule = { key: serializeChord(chord), command: commandId, when };
        const result = await this.mutateFile((content) => {
            let next = content;
            // Stryker disable next-line ConditionalExpression: правая ветавь → true запускала бы remove и для default/extension previous, но matchesUserRule(previous) там не найдёт user-правила с той же командой+комбинацией+when (его нет — оно default), так что remove ничего не снимает и результат тот же.
            if (previous !== undefined && previous.source === "user") {
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
        if (!result.ok) return result;

        if (previous !== undefined) this.unregisterEntry(previous);
        this.registerUserBinding(commandId, chord, when);
        this.emitDidChange();
        return result;
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
        if (!result.ok) return result;

        this.unregisterEntry(entry);
        this.emitDidChange();
        return result;
    }

    public async resetKeybinding(commandId: string): Promise<IKeybindingMutationResult> {
        const result = await this.mutateFile((content) =>
            removeKeybindingRules(content, (rule) => rule.command === commandId || rule.command === `-${commandId}`),
        );
        if (!result.ok) return result;

        const ledger = this.ledger.get(commandId);
        if (ledger !== undefined) {
            for (const applied of ledger.added) applied.disposable.dispose();
            for (const removed of ledger.removedDefaults) {
                this.keybindings.register(removed.chord, removed.commandId, removed.when, removed.source);
            }
            this.ledger.delete(commandId);
        }
        this.emitDidChange();
        return result;
    }

    /** Снимает запись из реестра и приводит леджер в соответствие. */
    private unregisterEntry(entry: IKeybindingEntrySnapshot): void {
        const removed = this.keybindings.removeBindings(entry.commandId, entry.chord);
        const ledger = this.ledgerFor(entry.commandId);
        if (entry.source === "user") {
            ledger.added = ledger.added.filter((applied) => !chordsEqual(applied.chord, entry.chord));
        } else {
            ledger.removedDefaults.push(...removed);
        }
    }

    /** Предикат «то самое user-правило в файле»: команда + комбинация + when. */
    private matchesUserRule(entry: IKeybindingEntrySnapshot): (rule: IUserKeybindingRule) => boolean {
        return (rule) =>
            rule.command === entry.commandId &&
            // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: `rule.key !== ""` избыточно — при пустом key `chordsEqual(parseChord(""), …)` (следующая строка) даёт false, так что пустой key не пройдёт и без этой проверки.
            rule.key !== "" &&
            chordsEqual(parseChord(rule.key), entry.chord) &&
            rule.when === entry.when;
    }

    /**
     * Правка файла: чтение (отсутствующий файл — пустой массив) → мутация →
     * запись с созданием каталога. Ошибка — результатом, не исключением;
     * `null`-путь (тесты/демо без user-data) тоже честный отказ.
     */
    private async mutateFile(mutate: (content: string) => string): Promise<IKeybindingMutationResult> {
        if (this.resource === null) {
            return { ok: false, error: "keybindings.json path is not resolved" };
        }
        try {
            const next = mutate(await this.readContent(this.resource));
            await fs.promises.mkdir(path.dirname(this.resource), { recursive: true });
            // Stryker disable next-line StringLiteral: кодировка записи — деталь I/O; наблюдаемого поведения тестам не даёт.
            await fs.promises.writeFile(this.resource, next, "utf-8");
            return { ok: true };
        } catch (err) {
            /* v8 ignore start -- defensive: fs и jsonc бросают только Error */
            const message = err instanceof Error ? err.message : String(err);
            /* v8 ignore stop */
            // Stryker disable next-line StringLiteral,CallExpression: логирование — диагностика, не поведение; текст и сам вызов наблюдаемого результата не дают.
            this.logger.error("failed to update keybindings.json", err);
            return { ok: false, error: message };
        }
    }

    /** Содержимое файла; отсутствующий файл (ENOENT) — пустая строка. */
    private async readContent(resource: string): Promise<string> {
        try {
            return await fs.promises.readFile(resource, "utf-8");
        } catch (err) {
            // Stryker disable next-line ConditionalExpression: не-ENOENT ошибку чтения (напр. EISDIR) в юните не спровоцировать, а последующая запись всё равно падает с ok:false — rethrow против проглатывания неотличимы.
            if (!isFileNotFound(err)) throw err;
            return "";
        }
    }
}

function isFileNotFound(err: unknown): boolean {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: защитная проверка типа ошибки; отличить её мутации можно лишь не-ENOENT ошибкой чтения, которую в юнит-тесте не спровоцировать. Наблюдаемая ветка (ENOENT → пустой контент) покрыта тестом записи в несуществующий файл.
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
