# debug-provider

Воркспейс e2e-сценария `debug-provider`: `.diode/launch.json` с двумя конфигурациями типа `demo` расширения
Debug Demo (`e2e/fixtures/user-data-with-debug-demo`). `Debug a picked program` — `${command:pickProgram}` через
quick pick расширения, обе резолюции провайдера, затем сессия с inline-адаптером расширения: приветствие в Debug
Console, остановка на входе в `main` файла `hello.c` с локальными `argc` и `program` (программа `./tests` ещё печатает вывод тест-раннера: ANSI-цвета, ссылку, группу, длинную строку — сценарий `debug-console-output`); `Without a program` —
провайдер отвечает `null`, открывается launch.json. Программа `./workers` — как Node-программа с воркерами у
js-debug: адаптер обратным запросом `startDebugging` поднимает дочерние сессии `worker 1` и `worker 2` (сценарий
`debug-child-sessions`).

Он же — воркспейс сценария `debug-breakpoints-gutter`: расширение объявляет `contributes.breakpoints` для C,
подтверждает брейкпоинты в `hello.c` и останавливается на первом из них вместо входа в `main`.
