import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IModelContentChange } from "../../../../../editor/common/model/iDocumentContentChange.ts";
import type { ITextMateTheme } from "../../../themes/common/textMateTheme.ts";
import type { IGrammarRecord } from "../textMateGrammarLoader.ts";

/**
 * Сообщения между главным потоком и воркером фоновой токенизации TextMate —
 * upstream `TextMateTokenizationWorker` ($-методы, которые зовёт главный поток)
 * и `TextMateWorkerHost` (то, что зовёт воркер). У эталона это прокси
 * `webWorker.ts`; у нас — явные сообщения: их немного, а прокси на `Proxy`
 * прятал бы, что и куда уходит (и `transfer` буфера токенов).
 *
 * Координаты строк в сообщениях — как у эталона, с 1 (их читает перенесённый
 * `model/textModelTokens.ts` по обе стороны); правки — наши, 0-based
 * ({@link IModelContentChange}).
 */
export type MainToWorkerMessage =
    /** Upstream `$init`: грамматики всех расширений и тема (она может прийти и позже). */
    | {
          readonly type: "init";
          readonly grammars: readonly IGrammarRecord[];
          readonly theme: ITextMateTheme | undefined;
      }
    /** Upstream `$acceptTheme`: правила и colorMap — в `Registry.setTheme` воркера. */
    | { readonly type: "acceptTheme"; readonly theme: ITextMateTheme }
    /**
     * Загрузить грамматику заранее, пока документа ещё нет (наше: эталон грузит
     * её при первом `$acceptNewModel`). Шлёт прогрев грамматик стартовых
     * файлов — чтение и разбор JSON уходят с критического пути.
     */
    | { readonly type: "preloadGrammar"; readonly scopeName: string }
    /**
     * Upstream `$acceptNewModel`: текст целиком одной строкой (LF), а не
     * массивом строк — структурное клонирование 200k строк стоит дороже одной.
     * Повторное сообщение с тем же `controllerId` заменяет модель (смена
     * содержимого целиком, `isFlush`).
     */
    | {
          readonly type: "acceptNewModel";
          readonly controllerId: number;
          readonly versionId: number;
          readonly text: string;
          readonly scopeName: string;
      }
    /** Upstream `$acceptModelChanged`: правки одного батча в порядке применения. */
    | {
          readonly type: "acceptModelChanged";
          readonly controllerId: number;
          readonly versionId: number;
          readonly changes: readonly IModelContentChange[];
      }
    /** Upstream `$retokenize`: строки `[start, endExclusive)` перекрасить заново. */
    | {
          readonly type: "retokenize";
          readonly controllerId: number;
          readonly startLineNumber: number;
          readonly endLineNumberExclusive: number;
      }
    /** Upstream `$acceptRemovedModel`. */
    | { readonly type: "acceptRemovedModel"; readonly controllerId: number }
    /** Ответ на {@link WorkerToMainMessage} `readFile`: текст, байты или ошибка. */
    | {
          readonly type: "readFileResult";
          readonly requestId: number;
          readonly text?: string;
          readonly bytes?: Uint8Array;
          readonly error?: string;
      };

/**
 * Upstream `StateDeltas`: состояния концов строк подряд с `startLineNumber`,
 * разностью к состоянию предыдущей строки (`diffStateStacksRefEq`), `null` —
 * состояние не изменилось. Тип разности — `StackDiff` vscode-textmate; здесь
 * `unknown`, чтобы протокол не тянул vscode-textmate в типы потребителей.
 */
export interface IStateDeltas {
    readonly startLineNumber: number;
    readonly stateDeltas: readonly unknown[];
}

export type WorkerToMainMessage =
    /**
     * Upstream `TextMateWorkerHost.$readFile`: грамматики и `onig.wasm` читает
     * главный поток — ему доступны ассеты (в SEA — вшитый `diode.bundle`).
     */
    | { readonly type: "readFile"; readonly requestId: number; readonly path: string; readonly binary: boolean }
    /**
     * Upstream `$setTokensAndStates`: токены строк (сериализованный
     * `ContiguousMultilineTokensBuilder`, буфер передаётся без копии) и
     * разности состояний — всё в координатах версии `versionId`.
     */
    | {
          readonly type: "setTokensAndStates";
          readonly controllerId: number;
          readonly versionId: number;
          readonly tokens: Uint8Array;
          readonly stateDeltas: readonly IStateDeltas[];
      }
    /**
     * Непредвиденная ошибка воркера (`onUnexpectedError`): её пишет в лог
     * главный поток — свой `console` у воркера ушёл бы в терминал поверх кадра.
     */
    | { readonly type: "unexpectedError"; readonly message: string };

/**
 * Канал сообщений одной стороны: `worker_threads` (`parentPort`/`Worker`) или
 * пара портов `MessageChannel` в тестах. `transfer` — буферы, которые уходят
 * без копии (после отправки у отправителя они пусты).
 */
export interface IMessagePort<TIn, TOut> {
    postMessage(message: TOut, transfer?: readonly ArrayBuffer[]): void;
    onMessage(listener: (message: TIn) => void): IDisposable;
}
