# Folding — сворачивание кода (#86, #87)

Статус: `[~]` — indentation folding (end-to-end), провайдерный путь расширений
(`languages.registerFoldingRangeProvider`, #194; слияние — union provider ∪
indentation) и кейс стокового `maptz.regionfolder` сделаны, см.
[docs/arch/Editor.md](../arch/Editor.md) → Folding. Остальное ниже.

## Осталось

### [ ] Таймаут провайдера не должен перекладывать области
У `languages.provideFoldingRanges` срок ответа 1,5 с (`requestPolicy.ts`), истёкший
срок — «областей нет», и применяются фолды по отступам. Медленный language server
(jdtls на большом файле, холодный старт) на каждой такой правке меняет раскладку:
свёрнутый Java-метод с многострочной сигнатурой показывает строку `) {`. В VS Code
срока нет, а сбой провайдера уходит в запасной indentation-провайдер. Нужно
отличать «провайдер ответил пусто» от «не ответил» и во втором случае держать
текущие области.

### [ ] Region-маркеры и language-configuration
`//#region`/`//#endregion` (и `folding.markers` из `language-configuration.json`),
плюс `offSide` (пустые строки завершают блок — Python/YAML). Сейчас `offSide`
игнорируется; провайдер чисто по отступам.

### [ ] `editor.showFoldingControls` + hover
VS Code по умолчанию `"mouseover"` — chevron'ы видны только при наведении мыши на
гуттер. Сейчас всегда `"always"` (проще и заметнее в TUI). Нужна hover-модель строки
гуттера и настройка `editor.showFoldingControls: always | mouseover | never`.

### [~] Рекурсивные и уровневые команды
Осталось: `editor.foldAllBlockComments`, `editor.foldAllMarkerRegions` /
`unfoldAllMarkerRegions` — требуют `FoldingRangeKind` на `IFoldingRegion` (модель
хранит только `startLine/endLine/isCollapsed`; kind провайдерских областей сейчас
игнорируется).

### [ ] `editor.foldBackground`
Подсветка фона свёрнутой строки-заголовка (в VS Code — полупрозрачный selection).
Требует альфа-композитинга поверх токен-фона; отложено.

### [ ] Персистентность свёрток
Сохранять состояние свёрток при переключении вкладок / переоткрытии файла
(в VS Code — по модели редактора). Сейчас область пересчитывается, `isCollapsed`
переносится по `startLine` только в пределах жизни редактора.
