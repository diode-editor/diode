# test-fixtures/diode-home

Изолированный каталог user data для ручного запуска diode без влияния на
систему. Передаётся через `--user-data-dir`:

```bash
# Default-профиль (editor.tabSize=2)
npm start -- --user-data-dir ./test-fixtures/diode-home test-fixtures/diode-home/sample.ts

# Профиль "compact" (editor.tabSize=8, табы вместо пробелов)
npm start -- --user-data-dir ./test-fixtures/diode-home --profile compact \
    test-fixtures/diode-home/sample.ts
```

Раскладка повторяет реальный `~/.diode/`:

```
test-fixtures/diode-home/
  .editorconfig                       # читается demo-расширением
  extensions/                         # внешние расширения
    diode-demo.editorconfig-1.0.0/     # demo: применяет .editorconfig
      package.json
      extension.cjs
  user-data/
    User/
      settings.json                   # default-профиль
      keybindings.json                # заглушка (парсинг не реализован)
      profiles/
        compact/
          settings.json               # альтернативный профиль
  sample.ts                           # файл для открытия
```

## Demo-расширение `diode-demo.editorconfig`

Лежит в `extensions/diode-demo.editorconfig-1.0.0/`. При активации ищет
ближайший `.editorconfig` вверх от `process.cwd()`, парсит секцию `[*]`
и применяет к активному редактору:

- `indent_style = tab|space` → `editor.options.insertSpaces`
- `indent_size` / `tab_width` → `editor.options.tabSize`

Поскольку расширение ищет `.editorconfig` от cwd, **запускать удобнее из
самого `test-fixtures/diode-home/`**:

```bash
cd test-fixtures/diode-home
npx tsx ../../src/vs/diode/main.ts --user-data-dir . sample.ts
```

После открытия `sample.ts` отступы переключатся на табы шириной 8
(значения из `.editorconfig`), переопределив `editor.tabSize: 2` из
`settings.json`. Сообщения расширения пишутся в stderr — их видно после
выхода из редактора.

Чтобы добавить ещё одно тестовое расширение — положи его в
`extensions/<publisher>.<name>-<version>/package.json` (формат VS Code).
Если в манифесте указан `main`, Diode динамически импортирует ESM-модуль
и вызовет `activate(context, vscode)` после открытия файлов.
