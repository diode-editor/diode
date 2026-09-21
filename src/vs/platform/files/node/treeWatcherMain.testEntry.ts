// Тестовый вход treeWatcherMain.integration.test.ts: то же, что делает ветка
// DIODE_FILE_WATCHER в `main.ts`, но без остального бутстрапа редактора.
import { runTreeWatcherSubprocess } from "./treeWatcherMain.ts";

runTreeWatcherSubprocess();

// Дальше — только для теста: рапорт о собственном окружении ПОСЛЕ входа. Роль не
// должна протекать в потомков (`DIODE_FILE_WATCHER` снят, режим — node), а
// проверить это можно только изнутри процесса.
process.send?.({
    t: "log",
    level: "info",
    message: "test-entry env",
    args: [
        {
            fileWatcher: process.env.DIODE_FILE_WATCHER ?? null,
            runAsNode: process.env.DIODE_RUN_AS_NODE ?? null,
        },
    ],
});
