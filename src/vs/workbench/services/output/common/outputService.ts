import type { IDisposable } from "@tuidom/all/common/disposable";
import { Disposable } from "@tuidom/all/common/disposable";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogService, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { logLevelName } from "../../../../platform/log/common/logLevel.ts";

import type { IOutputChannelDescriptor, IOutputChannelRegistry, ILogHistory } from "./output.ts";
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
            return JSON.stringify(arg) ?? String(arg);
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
 * Каналы берутся из {@link IOutputChannelRegistry}, но сервис ещё и **добирает**
 * их: канал, о котором никто не объявил, а записи от него идут, регистрируется с
 * `label = id`. Иначе подсистема просто не появилась бы в селекторе — а
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
    private readonly activeChannelListeners = new Set<(id: string) => void>();
    private readonly appendListeners = new Set<(entry: LogEntry) => void>();

    public constructor(
        private readonly history: ILogHistory,
        logService: ILogService,
        private readonly registry: IOutputChannelRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        // Каналы, уже успевшие написать до подъёма UI (bootstrap, configuration).
        for (const channel of this.history.getChannels()) this.ensureChannel(channel);
        this.setActiveChannel(this.registry.getChannels()[0]?.id ?? null);
        this.register(
            logService.onDidAppend((entry) => {
                this.ensureChannel(entry.channel);
                if (entry.channel !== this.activeChannelId) return;
                for (const listener of [...this.appendListeners]) listener(entry);
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
        for (const listener of [...this.activeChannelListeners]) listener(id);
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

    public onDidChangeActiveChannel(listener: (id: string) => void): IDisposable {
        this.activeChannelListeners.add(listener);
        return { dispose: () => this.activeChannelListeners.delete(listener) };
    }

    /** Живой хвост: запись, прилетевшая в АКТИВНЫЙ канал. */
    public onDidAppendToActiveChannel(listener: (entry: LogEntry) => void): IDisposable {
        this.appendListeners.add(listener);
        return { dispose: () => this.appendListeners.delete(listener) };
    }
}
