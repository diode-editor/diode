# debug-inline-values

Воркспейс e2e-сценария `debug-inline-values` и ручной проверки inline values с расширением Debug Demo
(`e2e/fixtures/user-data-with-debug-demo`). `.diode/launch.json` — одна конфигурация типа `demo` с программой
`./hello`: F5 останавливается на входе в `main` файла `hello.c`, F10 шагает на строку вниз. В этой папке (и только
в ней) у расширения есть `InlineValuesProvider` для C: он просит `argc` и `sum` там, где их называет строка до
остановки, — при `debug.inlineValues: auto` значения идут от него. `sum` у адаптера — `argc`, умноженный на число
выполненных строк `sum += argc` выше остановки.
