# Магазин расширений в UI

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

План и сценарии —
[../../TODO/ExtensionsView.md](../../TODO/ExtensionsView.md).

- `contrib/extensions/common/extensionsWorkbench.ts` — контракт
  `IExtensionsWorkbenchService` + DI-токен + карточка `IExtensionListEntry`.
  Контракт в `common/`, реализация в `node/` — так вьюлет из `browser/` не
  импортирует `node/` (иначе понадобилась бы запись в списке исключений
  `scripts/check-layers.mjs`).
- `contrib/extensions/node/extensionsWorkbenchService.ts` — каталог реестра
  (через `createRegistrySource`, кэш в памяти на сессию) ∪ установленное на
  диске (`listInstalledExtensions`); состояние карточки считается по
  `latest.engines` и версиям. Сетевой сбой не бросается: `getCatalogError()`.
- `contrib/extensions/browser/extensionsComponent.ts` — вьюлет `EXTENSIONS`
  (`view.id = "extensionsView"`): `InputElement` + `ListViewElement` с двумя
  группами (MARKETPLACE / INSTALLED), фильтр локальный; активация строки
  открывает страницу через шов `IExtensionsEditorTarget` (`EditorService`
  структурно, биндинг — в `diode/modules/extensionsModule.ts`).
- `contrib/extensions/browser/extensionEditorPane.ts` — вкладка расширения:
  `IEditorPane` с ресурсом `extension:<id>` (идентичность вкладки —
  `EditorService.openPane`), тело — `ExtensionPageElement` поверх строк
  `buildExtensionPageLines`. Перенос по словам свой (`wrapText`) и считается в
  раскладке: wrap-элемента в tuidom нет, а откладывать пересборку в микротаск
  значило бы показать пустую страницу первым кадром.
