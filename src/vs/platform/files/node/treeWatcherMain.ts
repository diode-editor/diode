import type { ILogger } from "../../log/common/iLogger.ts";

import { ChokidarTreeWatcher } from "./chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "./sharedTreeWatcher.ts";
import type { ITreeWatcherResponse, TreeWatcherLogLevel } from "./treeWatcherProtocol.ts";
import { serveTreeWatcher } from "./treeWatcherServer.ts";

/**
 * Точка входа watcher-процесса. Зовётся из `main.ts` по env-флагу
 * `DIODE_FILE_WATCHER=1` (его ставит `SubprocessTreeWatcher`); возвращается сразу, а процесс живёт на IPC-канале
 * до `disconnect` (то есть до смерти редактора) или до сигнала.
 *
 * Здесь собирается тот самый стек, который раньше стоял в процессе редактора:
 * `SharedTreeWatcher` поверх `ChokidarTreeWatcher`. Дедупликация запросов —
 * внутри watcher-процесса, как в VS Code: снаружи виден один интерфейс, а
 * сколько под ним живых обходов — дело того, кто их ведёт.
 */
export function runTreeWatcherSubprocess(): void {
    const send = process.send?.bind(process);
    if (send === undefined) {
        // Без IPC-канала watcher никому не нужен и слушать ему нечего.

        console.error("[file-watcher] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // Env-роль не должна протекать дальше по дереву процессов. Своих детей у
    // watcher'а нет, но флаг наследуется, и однажды заведённый отсюда процесс
    // ушёл бы в эту же ветку вместо своей работы. Дисциплина та же, что у
    // extension host'а: свой флаг снимаем (он уже прочитан — иначе нас бы тут
    // не было), а наследуемым режимом ставим node, который `main.ts` проверяет
    // ПЕРВЫМ.
    delete process.env.DIODE_FILE_WATCHER;
    process.env.DIODE_RUN_AS_NODE = "1";

    const post = (message: ITreeWatcherResponse): void => {
        // Канал закрывается вместе с редактором; отправка в закрытый — не повод
        // падать, `disconnect` ниже и так уводит нас в exit.
        try {
            send(message);
        } catch {
            /* no-op */
        }
    };

    const logger = createForwardingLogger(post);
    const server = serveTreeWatcher(
        {
            send: post,
            onMessage: (listener) => {
                process.on("message", listener);
            },
        },
        new SharedTreeWatcher(new ChokidarTreeWatcher(logger), logger),
    );

    // Редактор умер (в том числе аварийно) — сироте с тысячами inotify-подписок
    // жить незачем.
    process.on("disconnect", () => {
        server.dispose();
        process.exit(0);
    });

    logger.info("file watcher process started", { pid: process.pid });
}

/**
 * `ILogger`, который не пишет сам, а пересылает запись редактору: watcher —
 * субпроцесс без своего sink'а, а его отказы (в первую очередь ENOSPC от
 * исчерпанного лимита inotify) обязаны быть видны в том же канале
 * `files.watcher`, что и раньше.
 *
 * Фильтровать уровни здесь нечем — настройки логов живут у редактора, он же и
 * отфильтрует; поэтому `isEnabled` всегда `true`. Объём это не раздувает:
 * watcher пишет на подписку и на ошибку, а не на событие файла.
 */
function createForwardingLogger(post: (message: ITreeWatcherResponse) => void): ILogger {
    const at =
        (level: TreeWatcherLogLevel) =>
        (message: string, ...args: unknown[]): void => {
            post({ t: "log", level, message, args });
        };
    return {
        trace: at("trace"),
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
        isEnabled: () => true,
    };
}
