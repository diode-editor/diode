# debug-provider

Воркспейс e2e-сценария `debug-provider`: `.diode/launch.json` с двумя конфигурациями типа `demo` расширения
Debug Demo (`e2e/fixtures/user-data-with-debug-demo`). `Debug a picked program` — `${command:pickProgram}` через
quick pick расширения, обе резолюции провайдера, затем сессия с inline-адаптером расширения: приветствие в Debug
Console, остановка на входе в `main` файла `hello.c` с локальными `argc` и `program`; `Without a program` —
провайдер отвечает `null`, открывается launch.json.
