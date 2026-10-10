import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import type {
    ICoreSignatureHelp,
    SignatureHelpTriggerKind as TriggerKind,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";
import { stripMarkdown } from "../../hover/browser/hoverService.ts";

import type { ParameterHintsComponent } from "./parameterHintsComponent.ts";
import { ParameterHintsComponentDIToken } from "./parameterHintsComponent.ts";
import { provideSignatureHelp } from "./provideSignatureHelp.ts";
import { activeParameterSpan } from "./signatureLayout.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ParameterHintsServiceDIToken = token<ParameterHintsService>("ParameterHintsService");

/**
 * Логика подсказки параметров. Открывается сама при наборе триггер-символа
 * сервера (`(`, `,`, `<` у tsserver) и по команде
 * `editor.action.triggerParameterHints`; пока показана — перезапрашивается на
 * каждую правку и движение каретки (так активный параметр следует за набором),
 * а ответ `null` её закрывает — именно так закрывающая скобка гасит попап.
 *
 * Пара к {@link ParameterHintsComponent} по образцу suggest/hover: компонент
 * владеет попапом и его overlay-сессией, сервис — запросами и состоянием.
 */
export class ParameterHintsService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        ParameterHintsComponentDIToken,
        EditorServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    /** Задержка авто-запроса, мс (в тестах — 0). У suggest её роль играет настройка `editor.quickSuggestionsDelay`. */
    public triggerDelayMs = 120;

    /** Guard от устаревших ответов: пока ходили за подсказкой, запрос мог смениться. */
    private readonly latest = new LatestRequest();
    /** Отложенный авто-запрос: вид и символ берутся из {@link scheduledTrigger}. */
    private readonly triggerScheduler = this.register(
        new RunOnceScheduler(() => {
            void this.trigger(this.scheduledTrigger.kind, this.scheduledTrigger.character);
        }, this.triggerDelayMs),
    );
    // Без затравки: `scheduleTrigger` пишет поле до каждого `schedule()`, раньше него раннер не зовётся.
    private scheduledTrigger!: { kind: TriggerKind; character: string | undefined };
    /** Показанная сейчас подсказка (она же — эхо `activeSignatureHelp` серверу). */
    private currentHelp: ICoreSignatureHelp | null = null;
    private activeSignatureIndex = 0;

    public constructor(
        private readonly component: ParameterHintsComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        // Фокус ушёл с редактора (Ctrl+Tab, Quick Open) — попап без якоря не жилец.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement) && this.isOpen()) this.close();
            }),
        );
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                // Смена редактора при открытом попапе в приложении уже сопровождается
                // сменой фокуса (её ловит подписка на FocusTracker), поэтому в юните пропуск этого
                // закрытия не наблюдается — вызов держим для программной смены редактора
                // без участия фокуса (восстановление сессии, split).
                // Stryker disable next-line CallExpression: см. выше
                this.close();
                if (editor === null) return;
                store.add(
                    editor.onDidType((text) => {
                        this.onDidType(editor, text);
                    }),
                );
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        this.onCaretChanged();
                    }),
                );
            }),
        );
    }

    /**
     * Запрашивает подсказку для позиции каретки и показывает попап. No-op, если
     * нет активного редактора или провайдеров для документа; пустой ответ
     * закрывает попап.
     */
    public async trigger(
        triggerKind: TriggerKind = SignatureHelpTriggerKind.Invoke,
        character?: string,
    ): Promise<void> {
        this.cancelScheduledTrigger();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const providers = this.languageFeatures.signatureHelpProvider.ordered(editor);
        if (providers.length === 0) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const isRetrigger = this.isOpen();
        const help = await provideSignatureHelp(
            providers,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
                triggerKind,
                ...(character === undefined ? {} : { triggerCharacter: character }),
                isRetrigger,
                // Эхо показанной подсказки: по нему сервер удерживает перегрузку,
                // которую пользователь выбрал стрелками (tsserver ищет её по метке).
                // Stryker disable next-line ConditionalExpression: открытый попап без сохранённого результата недостижим — `close()` гасит и сессию, и результат вместе
                ...(isRetrigger && this.currentHelp !== null
                    ? { activeSignatureHelp: { ...this.currentHelp, activeSignature: this.activeSignatureIndex } }
                    : {}),
            },
            // Перезапрос и закрытие подсказки отменяют запрос и у провайдера.
            ticket.token,
        );
        // Пока ходили за ответом, попап могли закрыть или перезапросить — старый
        // ответ не имеет права перекрыть новое состояние.
        if (ticket.isStale()) return;
        if (help === null) {
            this.close();
            return;
        }
        // Каретка могла уйти за время await — без якоря показывать негде.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) {
            this.close();
            return;
        }

        this.currentHelp = help;
        this.activeSignatureIndex = clampIndex(help.activeSignature, help.signatures.length);
        this.renderHint();
        this.component.openAt(anchor);
    }

    /** Открыт ли попап (для `parameterHintsVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.component.isOpen();
    }

    /**
     * IContextKeyContributor: `parameterHintsVisible` и
     * `parameterHintsMultipleSignatures` — стрелки листают перегрузки, только
     * когда их больше одной.
     */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("parameterHintsVisible", this.isOpen());
        contextKeys.set("parameterHintsMultipleSignatures", (this.currentHelp?.signatures.length ?? 0) > 1);
    }

    /** Следующая перегрузка — локально, без запроса к серверу. */
    public nextSignature(): void {
        this.stepSignature(1);
    }

    public previousSignature(): void {
        this.stepSignature(-1);
    }

    public close(): void {
        this.cancelScheduledTrigger();
        this.component.close();
        this.component.setHint(null);
        this.currentHelp = null;
        this.activeSignatureIndex = 0;
        // Ответ «в полёте» больше не нужен: его билет устареет и ответ будет отброшен.
        this.latest.cancel();
    }

    private stepSignature(delta: 1 | -1): void {
        const count = this.currentHelp?.signatures.length ?? 0;
        // Stryker disable next-line ConditionalExpression: без выхода одна сигнатура просто пересобирает попап тем же содержимым, а ноль даёт NaN-индекс, который перетрёт следующий ответ, — поведение не меняется
        if (count <= 1) return;
        this.activeSignatureIndex = (((this.activeSignatureIndex + delta) % count) + count) % count;
        this.renderHint();
    }

    /** Перекладывает текущую подсказку в попап (после запроса и после листания). */
    private renderHint(): void {
        const help = this.currentHelp;
        /* v8 ignore start -- defensive: рендер зовут только при живой подсказке */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ветка недостижима — см. v8 ignore выше
        if (help === null) return;
        /* v8 ignore stop */
        const signature = help.signatures[this.activeSignatureIndex];
        // Сигнатура вправе задать свой активный параметр — он важнее общего.
        const activeParameter = signature.activeParameter ?? help.activeParameter;
        const documentation = [signature.parameters[activeParameter]?.documentation, signature.documentation]
            .map((doc) => (doc === undefined ? "" : stripMarkdown(doc)))
            .filter((doc) => doc !== "");
        this.component.setHint({
            label: signature.label,
            activeSpan: activeParameterSpan(signature, activeParameter),
            counter: help.signatures.length > 1 ? `${this.activeSignatureIndex + 1}/${help.signatures.length}` : null,
            documentation,
        });
    }

    /**
     * Набор символа (событие редактора, а не «строка выросла на символ»): триггер
     * сервера открывает подсказку, а пока она показана — ретриггер-символ (`)`)
     * уходит серверу в контексте, ответ на нём обычно пустой, и подсказка
     * закрывается сама. Приходит ПОСЛЕ события каретки той же правки и
     * перезаводит запланированный им `ContentChange` своим видом.
     */
    private onDidType(editor: TextEditorPane, text: string): void {
        // Триггеры — метаданные провайдеров, подошедших именно этому документу:
        // «(» сервера TypeScript не будит подсказку в markdown.
        const providers = this.languageFeatures.signatureHelpProvider.ordered(editor);
        const triggers = providers.some((provider) => provider.triggerCharacters.includes(text));
        const retriggers = this.isOpen() && providers.some((provider) => provider.retriggerCharacters.includes(text));
        if (triggers || retriggers) this.scheduleTrigger(SignatureHelpTriggerKind.TriggerCharacter, text);
    }

    /**
     * Правка или движение каретки: пока подсказка показана, она перезапрашивается
     * (иначе активный параметр застыл бы на первом). Выделение вместо каретки
     * подсказку закрывает.
     */
    private onCaretChanged(): void {
        const editor = this.group.getActiveEditor();
        /* v8 ignore start -- defensive: события приходят от привязанного редактора */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ветка недостижима — см. v8 ignore выше
        if (editor === null) return;
        /* v8 ignore stop */
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) {
            // Выделение, а не каретка: показывать подсказку вызова не для чего.
            // `close()` идемпотентен и заодно снимает отложенный запрос — иначе
            // набранная перед выделением «(» открыла бы попап уже поверх него.
            this.close();
            return;
        }
        if (this.isOpen()) this.scheduleTrigger(SignatureHelpTriggerKind.ContentChange, undefined);
    }

    private scheduleTrigger(kind: TriggerKind, character: string | undefined): void {
        this.scheduledTrigger = { kind, character };
        this.triggerScheduler.schedule(this.triggerDelayMs);
    }

    private cancelScheduledTrigger(): void {
        this.triggerScheduler.cancel();
    }
}

/** Индекс активной сигнатуры в границах списка (сервер вправе прислать любой). */
function clampIndex(index: number, length: number): number {
    // Stryker disable next-line EqualityOperator: на index === 0 обе границы дают ноль — тот же индекс, что и без клампа
    if (index < 0 || index >= length) return 0;
    return index;
}
