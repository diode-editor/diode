import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogService, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { logLevelName } from "../../../../platform/log/common/logLevel.ts";

import type { ILogHistory, IOutputChannelDescriptor, IOutputChannelRegistry } from "./output.ts";
import { LogHistoryDIToken, OutputChannelRegistryDIToken } from "./output.ts";

export const OutputServiceDIToken = token<OutputService>("OutputService");

/** `HH:MM:SS.mmm` локального времени — префикс строки, как в логах VS Code. */
function formatTimestamp(timestamp: number): string {
    const d = new Date(timestamp);
    const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Аргументы записи хвостом строки. Несериализуемое (циклы, BigInt) — через String(). */
function formatArgs(args: readonly unknown[]): string {
    if (args.length === 0) return "";
    const parts = args.map((arg) => {
        try {
            // JSON.stringify(undefined) отдаёт undefined, хотя тип обещает string, —
            // тогда печатаем сырой вид.
            const json = JSON.stringify(arg) as string | undefined;
            return json ?? String(arg);
        } catch {
            return String(arg);
        }
    });
    return ` ${parts.join(" ")}`;
}

/**
 * Одна строка Output. Формат `HH:MM:SS.mmm [level] message` выбран не случайно:
 * стоковая грамматика `log` (`extensions/log`) подсвечивает уровень именно в
 * квадратных скобках, так что раскраска достаётся без единого своего цвета.
 */
export function formatOutputLine(entry: LogEntry): string {
    return `${formatTimestamp(entry.timestamp)} [${logLevelName(entry.level)}] ${entry.message}${formatArgs(entry.args)}`;
}

/**
 * Модель Output-панели (аналог `IOutputService`): какой канал активен, что в нём
 * лежит и что в него прилетает live. Про UI не знает — вкладку и редактор
 * держит `OutputComponent`.
 *
 * Каналы берутся из {@link IOutputChannelRegistry}; каналы, которым создатель
 * логгера дал метку (`createLogger(id, { label })`), сервис переносит в реестр из
 * `ILogService` (как `logs.contribution` vscode — из `getRegisteredLoggers`). А
 * ещё сервис **добирает** каналы: канал, о котором никто не объявил, а записи от
 * него идут, регистрируется с `label = id`. Иначе подсистема просто не появилась бы в селекторе — а
 * незаявленные каналы у нас норма, `LogService.createLogger` заводится ad hoc.
 */
export class OutputService extends Disposable {
    public static dependencies = [
        LogHistoryDIToken,
        ILogServiceDIToken,
        OutputChannelRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    private activeChannelId: string | null = null;
    private readonly onDidChangeActiveChannelEmitter = this.register(new Emitter<string>());
    private readonly onDidAppendToActiveChannelEmitter = this.register(new Emitter<LogEntry>());

    public constructor(
        private readonly history: ILogHistory,
        logService: ILogService,
        private readonly registry: IOutputChannelRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        // Каналы с метками от их создателей — заведённые до подъёма UI и позже.
        for (const descriptor of logService.getRegisteredChannels()) this.registry.registerChannel(descriptor);
        this.register(
            logService.onDidRegisterChannel((descriptor) => {
                this.registry.registerChannel(descriptor);
            }),
        );
        // Каналы, уже успевшие написать до подъёма UI, но без метки.
        for (const channel of this.history.getChannels()) this.ensureChannel(channel);
        this.setActiveChannel(this.registry.getChannels()[0]?.id ?? null);
        this.register(
            logService.onDidAppend((entry) => {
                this.ensureChannel(entry.channel);
                if (entry.channel !== this.activeChannelId) return;
                this.onDidAppendToActiveChannelEmitter.fire(entry);
            }),
        );
        // Канал мог быть объявлен позже, чем поднялся сервис (расширения) — тогда
        // он становится активным, если активного ещё не было.
        this.register(
            this.registry.onDidRegisterChannel((descriptor) => {
                if (this.activeChannelId === null) this.setActiveChannel(descriptor.id);
            }),
        );
    }

    private ensureChannel(id: string): void {
        if (this.registry.getChannel(id) !== undefined) return;
        this.registry.registerChannel({ id, label: id });
    }

    public getChannels(): readonly IOutputChannelDescriptor[] {
        return this.registry.getChannels();
    }

    /** Появился новый канал (объявленный или добранный автоматически). */
    public onDidRegisterChannel(listener: (descriptor: IOutputChannelDescriptor) => void): IDisposable {
        return this.registry.onDidRegisterChannel(listener);
    }

    public getActiveChannelId(): string | null {
        return this.activeChannelId;
    }

    /** Делает канал активным (VS Code `showChannel`). Неизвестный id — no-op. */
    public showChannel(id: string): void {
        if (this.registry.getChannel(id) === undefined || this.activeChannelId === id) return;
        this.setActiveChannel(id);
        this.onDidChangeActiveChannelEmitter.fire(id);
    }

    /**
     * Активный канал + парный контекст-ключ (VS Code `ACTIVE_OUTPUT_CHANNEL_CONTEXT`).
     * Ключ ставится ЗДЕСЬ, а не в подписчике: на нём висит `toggled` пунктов
     * селектора, и подписчик, обновляющий его, мог бы отработать позже того, кто
     * пункты перечитывает — селектор показывал бы прошлый канал.
     */
    private setActiveChannel(id: string | null): void {
        this.activeChannelId = id;
        this.contextKeys.set("activeOutputChannel", id ?? "");
    }

    /** Всё содержимое канала одной строкой — контент редактора при его показе. */
    public renderChannel(id: string): string {
        const entries = this.history.getEntries(id);
        if (entries.length === 0) return "";
        return `${entries.map(formatOutputLine).join("\n")}\n`;
    }

    public readonly onDidChangeActiveChannel = this.onDidChangeActiveChannelEmitter.event;

    /** Живой хвост: запись, прилетевшая в АКТИВНЫЙ канал. */
    public readonly onDidAppendToActiveChannel = this.onDidAppendToActiveChannelEmitter.event;
}
