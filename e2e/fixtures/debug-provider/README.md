# debug-provider

Воркспейс e2e-сценария `debug-provider`: `.diode/launch.json` с двумя конфигурациями типа `demo` расширения
Debug Demo (`e2e/fixtures/user-data-with-debug-demo`). `Debug a picked program` — `${command:pickProgram}` через
quick pick расширения и обе резолюции провайдера; `Without a program` — провайдер отвечает `null`, открывается
launch.json.
