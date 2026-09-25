import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "./codicons.generated.ts";
import { renderCodicons } from "./codicons.ts";

const CHECK = CODICON_GLYPHS.check;
const SYNC = CODICON_GLYPHS.sync;

describe("renderCodicons", () => {
    it("оставляет текст без разметки как есть", () => {
        expect(renderCodicons("Ln 1, Col 1")).toBe("Ln 1, Col 1");
    });

    it("подменяет известный значок символом шрифта", () => {
        expect(CHECK).toBeDefined();
        expect(renderCodicons("$(check) Ready")).toBe(`${CHECK ?? ""} Ready`);
    });

    it("подменяет несколько значков в одной строке", () => {
        expect(renderCodicons("$(check)a$(sync)b")).toBe(`${CHECK ?? ""}a${SYNC ?? ""}b`);
    });

    it("игнорирует модификатор анимации", () => {
        expect(renderCodicons("$(sync~spin)")).toBe(SYNC);
    });

    it("игнорирует модификатор с пустым именем", () => {
        expect(renderCodicons("$(sync~)")).toBe(SYNC);
    });

    it("выбрасывает неизвестное имя", () => {
        expect(renderCodicons("x$(definitely-not-a-codicon)y")).toBe("xy");
    });

    it("не трогает то, что не разметка значка", () => {
        expect(renderCodicons("$notAnIcon ($5) $()")).toBe("$notAnIcon ($5) $()");
    });

    it("снимает экранирование, оставляя литерал", () => {
        expect(renderCodicons("\\$(check)")).toBe("$(check)");
    });

    it("сопоставляет имя без учёта регистра (как upstream)", () => {
        expect(renderCodicons("$(CHECK)")).toBe(CHECK);
    });

    it("таблица кодпоинтов приехала целиком", () => {
        // Нижняя граница — защита от «генератор отдал пустышку, а тесты зелёные».
        expect(Object.keys(CODICON_GLYPHS).length).toBeGreaterThan(700);
    });
});
