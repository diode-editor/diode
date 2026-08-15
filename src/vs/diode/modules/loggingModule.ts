import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { ILogService } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { NULL_LOG_SERVICE } from "../../platform/log/common/nullLogService.ts";
import { RingBufferSink } from "../../platform/log/common/ringBufferSink.ts";
import type { ILogHistory } from "../../workbench/services/output/common/output.ts";
import { LogHistoryDIToken } from "../../workbench/services/output/common/output.ts";

export interface LoggingModuleContext {
    logService: ILogService;
    /**
     * Кольцевой буфер записей — источник содержимого Output-панели. Приходит
     * готовым из `main.ts`: он подключён к `LogService` ещё до подъёма UI, иначе
     * ранние каналы (bootstrap, configuration) были бы потеряны.
     */
    logHistory: ILogHistory;
}

/**
 * Биндит `ILogServiceDIToken` на готовый экземпляр `ILogService` и `LogHistoryDIToken`
 * на его `RingBufferSink`. В production-сборке оба приходят из `main.ts`,
 * в тестах — null-сервис и пустой буфер (см. `loggingModuleDefault`).
 */
export const loggingModule: ContainerModule<LoggingModuleContext> = (container, { logService, logHistory }) => {
    container.bind(ILogServiceDIToken, () => logService);
    container.bind(LogHistoryDIToken, () => logHistory);
};

/** Shortcut с null-сервисом для тестов и demo. */
export const loggingModuleDefault: ContainerModule = (container) => {
    container.bind(ILogServiceDIToken, () => NULL_LOG_SERVICE);
    // Пустой буфер, а не null-объект: у `RingBufferSink` ровно та форма, которую
    // ждёт порт, и Output-вкладка в тестах честно оказывается пустой.
    const history = new RingBufferSink();
    container.bind(LogHistoryDIToken, () => history);
};
