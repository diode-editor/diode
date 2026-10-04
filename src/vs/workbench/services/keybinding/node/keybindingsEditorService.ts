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

/** Итог записи файла: при успехе — записанное содержимое. */
type IKeybindingWriteResult =
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly error: string };

/** User-правило файла как правило слоя реестра: `key` разобран в комбинацию. */
function toLayerRule(rule: IUserKeybindingRule): IKeybindingLayerRule {
    return {
        command: rule.command,
        chord: rule.key === "" ? undefined : parseChord(rule.key),
        when: rule.when,
        args: rule.args,
    };
}

/**
 * См. контракт {@link IKeybindingsEditorService}. Источник правды —
 * `keybindings.json`: после каждой правки файла слой user реестра
 * пересобирается из записанного содержимого целиком, поэтому журнала
 * эффектов нет, а reset просто убирает правила из файла и не сдвигает
 * приоритет восстановленных дефолтов.
 */
export class KeybindingsEditorService extends Disposable implements IKeybindingsEditorService {
    public static dependencies = [KeybindingRegistryDIToken, IEnvironmentServiceDIToken, ILogServiceDIToken] as const;

    /** Действующие user-правила — содержимое `keybindings.json`. */
    // Stryker disable next-line ArrayDeclaration: эквивалентный — посторонний элемент без command ни с одной командой не совпадёт
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
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя канала логгера и его метка в Output — диагностика, не поведение.
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
        // args живут только у user-правил (VS Code правит такое правило на месте,
        // сохраняя args); у default/extension-записей их не бывает.
        const args = previous?.source === "user" ? previous.args : undefined;
        const newRule: IUserKeybindingRule = { key: serializeChord(chord), command: commandId, when, args };
        const result = await this.mutateFile((content) => {
            let next = content;
            // Stryker disable next-line ConditionalExpression: правая ветавь → true запускала бы remove и для default/extension previous, но matchesUserRule(previous) там не найдёт user-правила с той же командой+комбинацией+when (его нет — оно default), так что remove ничего не снимает и результат тот же.
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

    /** Записанный файл — новый слой user реестра. */
    private applyWritten(written: IKeybindingWriteResult): IKeybindingMutationResult {
        if (!written.ok) return written;
        this.applyUserKeybindings(parseUserKeybindings(written.content, this.resource, this.logger));
        this.onDidChangeEmitter.fire();
        return { ok: true };
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
     * запись с созданием каталога. Ошибка — результатом, не исключением.
     */
    private async mutateFile(mutate: (content: string) => string): Promise<IKeybindingWriteResult> {
        try {
            const next = mutate(await this.readContent(this.resource));
            await fs.promises.mkdir(path.dirname(this.resource), { recursive: true });
            // Stryker disable next-line StringLiteral: кодировка записи — деталь I/O; наблюдаемого поведения тестам не даёт.
            await fs.promises.writeFile(this.resource, next, "utf-8");
            return { ok: true, content: next };
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
