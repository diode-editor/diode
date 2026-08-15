import { describe, expect, it } from "vitest";

import { type OptionSpec, type ProjectConfig } from "./config.ts";
import { UserError } from "./gh.ts";
import { type ExistingField, isEmptyFieldPlan, planFields } from "./projectFields.ts";

function makeConfig(fields: ProjectConfig["fields"]): ProjectConfig {
    return {
        repo: "diode-editor/diode",
        project: { owner: "tihonove", number: 2 },
        fields,
    };
}

const backlog: OptionSpec = { name: "Backlog", color: "GRAY", description: "Не разобрано" };
const done: OptionSpec = { name: "Done", color: "PURPLE", description: "Смёржено" };

function statusField(options: { id: string; name: string; color: string; description: string }[]): ExistingField {
    return { id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options };
}

describe("planFields", () => {
    it("не предлагает ничего, когда всё совпадает", () => {
        const existing = [statusField([{ id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" }])];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog] } }), {
            prune: false,
        });
        expect(isEmptyFieldPlan(plan)).toBe(true);
    });

    it("создаёт отсутствующее поле со всеми опциями сразу", () => {
        const plan = planFields([], makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog, done] } }), {
            prune: false,
        });
        expect(plan.actions).toEqual([
            {
                kind: "create",
                field: "Status",
                dataType: "SINGLE_SELECT",
                options: [
                    { name: "Backlog", color: "GRAY", description: "Не разобрано" },
                    { name: "Done", color: "PURPLE", description: "Смёржено" },
                ],
            },
        ]);
    });

    it("сохраняет id совпавшей по имени опции — назначения у карточек не теряются", () => {
        const existing = [statusField([{ id: "o1", name: "Backlog", color: "RED", description: "старое" }])];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog] } }), {
            prune: false,
        });
        expect(plan.actions[0]).toMatchObject({ kind: "update-options", fieldId: "F_status", changed: ["Backlog"] });
        expect(plan.actions[0]).toHaveProperty("options", [
            { id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" },
        ]);
    });

    it("без --prune сохраняет незнакомую опцию, дописывая её в хвост payload", () => {
        const existing = [
            statusField([
                { id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" },
                { id: "o9", name: "Temp", color: "PINK", description: "руками из веб-морды" },
            ]),
        ];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog, done] } }), {
            prune: false,
        });
        const action = plan.actions[0];
        expect(action).toMatchObject({ kind: "update-options", added: ["Done"], removed: [] });
        expect(action.kind === "update-options" && action.options.map(o => o.name)).toEqual(["Backlog", "Done", "Temp"]);
        expect(action.kind === "update-options" && action.options.at(-1)?.id).toBe("o9");
    });

    it("под --prune удаляет незнакомую опцию", () => {
        const existing = [
            statusField([
                { id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" },
                { id: "o9", name: "Temp", color: "PINK", description: "" },
            ]),
        ];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog] } }), {
            prune: true,
        });
        const action = plan.actions[0];
        expect(action).toMatchObject({ kind: "update-options", removed: ["Temp"] });
        expect(action.kind === "update-options" && action.options.map(o => o.name)).toEqual(["Backlog"]);
    });

    it("замечает изменение порядка колонок", () => {
        const existing = [
            statusField([
                { id: "o2", name: "Done", color: "PURPLE", description: "Смёржено" },
                { id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" },
            ]),
        ];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog, done] } }), {
            prune: false,
        });
        expect(plan.actions[0]).toMatchObject({ reordered: true, added: [], removed: [], changed: [] });
    });

    it("падает на конфликте dataType, а не пересоздаёт поле", () => {
        const existing: ExistingField[] = [{ id: "F_est", name: "Estimate", dataType: "NUMBER" }];
        expect(() =>
            planFields(existing, makeConfig({ Estimate: { dataType: "SINGLE_SELECT", options: [backlog] } }), { prune: false }),
        ).toThrow(UserError);
    });

    it("не удаляет поля, которых нет в конфиге, даже под --prune", () => {
        const existing: ExistingField[] = [
            { id: "F_title", name: "Title", dataType: "TITLE" },
            statusField([{ id: "o1", name: "Backlog", color: "GRAY", description: "Не разобрано" }]),
        ];
        const plan = planFields(existing, makeConfig({ Status: { dataType: "SINGLE_SELECT", options: [backlog] } }), {
            prune: true,
        });
        expect(isEmptyFieldPlan(plan)).toBe(true);
    });
});
