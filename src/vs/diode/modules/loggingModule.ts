import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { ILogService } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { NULL_LOG_SERVICE } from "../../platform/log/common/nullLogService.ts";
import { RingBufferSink } from "../../platform/log/common/ringBufferSink.ts";
import type { ILogHistory } from "../../workbench/services/output/common/output.ts";
import { LogHistoryDIToken } from "../../workbench/services/output/common/output.ts";

export interface LoggingModuleContext {
    logService: ILogService;
    /** Подключён к `LogService` ещё до подъёма UI, иначе ранние каналы пропали бы. */
    logHistory: ILogHistory;
}

export const loggingModule: ContainerModule<LoggingModuleContext> = (container, { logService, logHistory }) => {
    container.bind(ILogServiceDIToken, () => logService);
    container.bind(LogHistoryDIToken, () => logHistory);
};

export const loggingModuleDefault: ContainerModule = (container) => {
    container.bind(ILogServiceDIToken, () => NULL_LOG_SERVICE);
    const history = new RingBufferSink();
    container.bind(LogHistoryDIToken, () => history);
};
