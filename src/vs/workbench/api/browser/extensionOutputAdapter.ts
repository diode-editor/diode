import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../platform/log/common/iLogService.ts";
import type { IOutputChannelRegistry } from "../../services/output/common/output.ts";
import type { OutputService } from "../../services/output/common/outputService.ts";
import type { IOutputSink } from "../../services/extensions/node/extensionHost.ts";
import type { WireOutputLevel } from "../common/wireTypes.ts";

/**
 * Мост output-каналов расширений в панель Output (реализация
 * {@link IOutputSink}): канал регистрируется в {@link IOutputChannelRegistry}
 * лениво (label = имя из `createOutputChannel`; повторная регистрация — no-op
 * по контракту реестра), строки пишутся логгером канала — дальше их
 * подхватывает штатный конвейер Output (RingBufferSink → селектор → живой
 * хвост). `show` — семантика VS Code `OutputChannel.show()`: открыть панель
 * Output (порт `revealPanel`, в module — `PanelService.setActiveView` +
 * `LayoutService.setPanelVisible`) и переключить селектор на канал.
 * Проводка — `extensionHostModule`.
 */
export class ExtensionOutputAdapter implements IOutputSink {
    private readonly loggers = new Map<string, ILogger>();

    public constructor(
        private readonly registry: IOutputChannelRegistry,
        private readonly logService: ILogService,
        private readonly outputService: OutputService,
        private readonly revealPanel: () => void,
    ) {}

    public append(channel: string, label: string, level: WireOutputLevel, value: string): void {
        this.loggerFor(channel, label)[level](value);
    }

    public show(channel: string, label: string): void {
        // show мог прийти до первой строки — канал регистрируется и здесь.
        this.loggerFor(channel, label);
        this.revealPanel();
        this.outputService.showChannel(channel);
    }

    private loggerFor(channel: string, label: string): ILogger {
        let logger = this.loggers.get(channel);
        if (logger === undefined) {
            this.registry.registerChannel({ id: channel, label });
            logger = this.logService.createLogger(channel);
            this.loggers.set(channel, logger);
        }
        return logger;
    }
}
