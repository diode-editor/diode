# Read-only редактор

Режим «только чтение» у редактора — аналог `EditorOption.readOnly` в VS Code.
Задача выросла из Output-панели ([Logging.md](Logging.md)): VS Code
рендерит Output не своим виджетом, а read-only редактором над моделью с языком
`log` (`outputView.ts`, `OutputEditor extends AbstractTextResourceEditor`).

Сделано: флаг read-only с тремя уровнями защиты и detached pane для Output — устройство в
[arch/Editor.md](../arch/Editor.md#read-only-редактор).

## Открытые фазы

- [ ] **Конфигурационный слой** — `files.readonlyInclude`/`readonlyExclude`/
  `readonlyFromPermissions` и команды `setActiveEditorReadonlyInSession`/
  `setActiveEditorWriteableInSession`/`resetActiveEditorReadonlyInSession`.
  Сейчас есть только session-toggle.

- [ ] **Обратная связь при попытке правки** — VS Code показывает
  `readOnlyMessage` во всплывашке. У нас правка просто не происходит, молча.
