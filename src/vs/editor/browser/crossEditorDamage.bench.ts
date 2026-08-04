import { bench, describe } from "vitest";

import { BoxConstraints, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIElement } from "../../../../tuidom/dom/tuiElement.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// Межвиджетная развязка кадра damage-tracking'ом (docs/TODO/LongLinePerformance.md,
// «Глубже»; docs/TODO/SearchPerformance.md, случай 4). Запуск: `npm run test:perf`.
//
// Одна итерация = печать символа + Backspace через настоящий парсер ввода
// (~2 полных синхронных кадра). Сравнение пары фикстур отвечает на вопрос
// «сколько стоит СОСЕДНИЙ виджет»: до damage-tracking каждый кадр рендерил
// оба редактора (устоявшийся Output с 10k-строкой добавлял пересегментацию
// DisplayLine на каждый его видимый ряд), после — поддерево Output вообще
// не рендерится, и обе фикстуры должны стоить одинаково.
//
// NB: фикстуры на верхнем уровне модуля — в режиме `vitest bench` тяжёлый
// beforeAll отрабатывает некорректно (бенч не набирает сэмплов).

/** Два редактора бок о бок: активный слева, «Output» справа. */
class SplitElement extends TUIElement {
    public constructor(
        private readonly left: TUIElement,
        private readonly right: TUIElement,
    ) {
        super();
        this.appendChild(left);
        this.appendChild(right);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const half = Math.floor(size.width / 2);
        this.layoutChild(this.left, 0, 0, BoxConstraints.tight(new Size(half, size.height)));
        this.layoutChild(this.right, half, 0, BoxConstraints.tight(new Size(size.width - half, size.height)));
        return size;
    }
}

function makeEditor(text: string): EditorElement {
    return new EditorElement(new EditorViewState(new TextDocument(text)));
}

const EDITOR_TEXT = Array.from({ length: 200 }, (_, i) => `const line${String(i)} = ${String(i)};`).join("\n");

function makeSoloApp(): { app: TestApp } {
    const editor = makeEditor(EDITOR_TEXT);
    const app = TestApp.createWithContent(editor, new Size(120, 40));
    app.app.validateTreeAfterRender = false;
    editor.focus();
    app.render();
    return { app };
}

function makeSplitApp(outputLineLength: number): { app: TestApp } {
    const editor = makeEditor(EDITOR_TEXT);
    const outputLines = Array.from({ length: 40 }, (_, i) => `log line ${String(i)}`);
    outputLines[20] = "x".repeat(outputLineLength);
    const output = makeEditor(outputLines.join("\n"));
    const app = TestApp.createWithContent(new SplitElement(editor, output), new Size(120, 40));
    app.app.validateTreeAfterRender = false;
    editor.focus();
    app.render();
    return { app };
}

const solo = makeSoloApp();
const splitShort = makeSplitApp(20);
const splitLong = makeSplitApp(10_000);

describe("Editor — печать при соседнем устоявшемся Output (2 кадра за итерацию)", () => {
    bench("один редактор — контроль: абсолютная стоимость клавиши", () => {
        solo.app.sendKey("x");
        solo.app.sendKey("Backspace");
    });

    bench("сплит: Output с короткими строками", () => {
        splitShort.app.sendKey("x");
        splitShort.app.sendKey("Backspace");
    });

    bench("сплит: Output с устоявшейся 10k-строкой — не должен стоить дороже короткого", () => {
        splitLong.app.sendKey("x");
        splitLong.app.sendKey("Backspace");
    });
});
