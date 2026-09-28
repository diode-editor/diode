import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";

export const DefinitionServiceDIToken = token<DefinitionService>("DefinitionService");

/**
 * Логика Go to Definition. По команде (`editor.action.revealDefinition` / F12)
 * запрашивает цели у `EditorService.definitionSource` (провайдеры расширений
 * через host) для позиции каретки и раскрывает первую: в том же файле — прыжок
 * каретки, в другом — открытие ресурса и прыжок (паттерн
 * `ProblemsComponent.revealMarker`).
 */
export class DefinitionService {
    public static dependencies = [EditorServiceDIToken, JumpRecorderDIToken] as const;

    public constructor(
        private readonly group: EditorService,
        private readonly jumps: IJumpRecorder,
    ) {}

    /**
     * Раскрывает определение символа под кареткой активного редактора. No-op,
     * если нет активного редактора, источника или провайдеры ничего не вернули.
     */
    public async revealDefinition({ toSide = false }: { toSide?: boolean } = {}): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const source = this.group.definitionSource;
        if (source === undefined) return;

        const caret = editor.viewState.selections[0].active;
        const locations = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text: editor.getText(),
            line: caret.line,
            character: caret.character,
        });
        const target = locations.at(0);
        if (target === undefined) return;
        await this.revealLocation(target, toSide);
    }

    /**
     * Довозит каретку до цели: кросс-файлово — через открытие ресурса группой.
     * Весь переход обёрнут в {@link IJumpRecorder.jumpAsync}: история кладёт
     * точку вызова и точку определения, а промежуточное «открыли файл в начале» —
     * нет. Именно `jumpAsync`, а не `jump`: цель может оказаться недисковым
     * ресурсом (`jdt:` у Java, исходник из JDK), который открывается через
     * провайдера схемы, и снять точку назначения можно только после этого.
     */
    private revealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        return this.jumps.jumpAsync(() => this.doRevealLocation(location, toSide));
    }

    private async doRevealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        // Сравнивать с `location.uri` как со строкой нельзя: провайдер присылает
        // её в своём написании, а `Uri` нормализует процентное кодирование —
        // у `jdt:`-целей с их огромным query эти две строки НИКОГДА не совпадут.
        // Поднимаем ресурс один раз и дальше сравниваем нормализованное с
        // нормализованным.
        const uri = Uri.parse(location.uri);
        const key = uri.toString();
        // Открываем безусловно — даже если цель в том же файле: дедуп по ресурсу
        // живёт в `openUri` и работает в пределах группы, а второй такой же
        // проверки здесь ему не нужно. `group: "beside"` (Ctrl+K F12) оставляет
        // исходную группу на месте и раскрывает цель в соседней справа.
        await this.group.openUri(uri, toSide ? { group: "beside" } : {});
        const editor = this.group.getActiveEditor();
        // Ресурс мог не открыться: недисковую цель отдаёт провайдер схемы, а его
        // может не быть (человек уже увидел сообщение — см. `onOpenFailed`).
        // Stryker disable next-line OptionalChaining: без активного редактора сюда не попасть — `revealDefinition` выходит раньше, чем спросит провайдеров; `?.` держим страховкой для будущих вызывающих
        if (editor?.uri.toString() !== key) return;
        editor.goToPosition(location.range.start.line, location.range.start.character);
        editor.revealRange(location.range);
    }
}
