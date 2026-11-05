import { TEST_ID_DELIMITER } from "../vs/workbench/api/common/testingWireTypes.ts";
import type { TestService } from "../vs/workbench/contrib/testing/common/testService.ts";

/** A full test id from its path: the controller id first. */
export function testId(...path: string[]): string {
    return path.join(TEST_ID_DELIMITER);
}

/**
 * The service's tree as label lines, children indented by two spaces; with `expand` a node that is not
 * `NotExpandable` gets its state in brackets (`Fixture [3]`).
 */
export function testTree(service: Pick<TestService, "rootItems" | "getNodeById">, expand = true): string[] {
    const lines: string[] = [];
    const walk = (id: string, depth: number): void => {
        const node = service.getNodeById(id);
        if (node === undefined) return;
        const state = expand && node.expand !== 0 ? ` [${node.expand}]` : "";
        lines.push(`${"  ".repeat(depth)}${node.item.label}${state}`);
        for (const child of node.children) walk(child, depth + 1);
    };
    for (const root of service.rootItems) walk(root.item.extId, 0);
    return lines;
}
