# Folding — сворачивание кода (#86, #87)

Статус: `[~]` — indentation folding (end-to-end), провайдерный путь расширений
(`languages.registerFoldingRangeProvider`, #194; слияние — union provider ∪
indentation) и кейс стокового `maptz.regionfolder` сделаны, см.
[docs/arch/Editor.md](../arch/Editor.md) → Folding. Остальное ниже.

## Осталось

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
