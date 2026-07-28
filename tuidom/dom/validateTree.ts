import type { TUIElement } from "./tuiElement.ts";

/**
 * Проверка структурных инвариантов дерева элементов. Обходит дерево от корня
 * через `getChildren()` и находит состояния, которые «работают наполовину»:
 * элемент рисуется, но не кликается; получает кадры, но не получает стили.
 * Такие состояния — источник целого класса багов «элемент есть, но не
 * показывается/не реагирует» (#204 и родня), и простыми тестами они не
 * ловятся, потому что каждый отдельный механизм (render, hit-test, стили,
 * фокус) отказывает молча.
 *
 * Инварианты:
 * - **Симметрия parent**: каждый ребёнок из `getChildren()` указывает
 *   `getParent()` ровно на свой контейнер. Нарушение = забытый `setParent`
 *   (markDirty не доходит до корня, события не всплывают) или устаревшая
 *   ссылка после перецепления.
 * - **Достижимость root**: `getRoot()` каждого узла равен корню обхода.
 *   Нарушение = элемент прикрепили до укоренения контейнера и нисходящая
 *   пропагация его не увидела — `focus()`/`open()` будут молча no-op.
 * - **Единственность прикрепления**: узел встречается в дереве один раз
 *   (нет циклов, нет двух родителей, отдающих один элемент).
 * - **Layout-контракт**: размер узла удовлетворяет constraints его последнего
 *   `layout()` (Н1, см. LAYOUT.md «Контракт performLayout»). Ловит мутации
 *   размера после layout без markDirty — сам layout() ассертит в моменте.
 *   Пропускаются узлы с `isLayoutDirty` (офскрин-строки виртуализирующего
 *   ListViewElement легитимно несут устаревший layout), скрытые (`hidden`)
 *   поддеревья целиком (их никто не раскладывал) и ни разу не разложенные.
 *
 * Координаты (`globalPosition` = сумма `localPosition` предков) намеренно не
 * проверяются: у виртуализирующих контейнеров (ListViewElement) офскрин-дети
 * легитимно несут устаревшие позиции до следующего layout.
 *
 * Использование: в тестах — автоматически после каждого кадра
 * (`TuiApplication.validateTreeAfterRender`, включает TestApp); в приложении —
 * опционально через тот же флаг (env `VEXX_VALIDATE_TREE=1` в main).
 */
export function validateTree(root: TUIElement): string[] {
    const violations: string[] = [];
    const expectedRoot = root.getRoot();
    if (expectedRoot !== root) {
        violations.push(`корень обхода ${describe(root)} не считает себя корнем: getRoot() → ${describeOrNull(expectedRoot)}`);
    }
    checkLayoutContract(root, violations);

    const visited = new Set<TUIElement>();
    // hiddenAncestor: внутри скрытого поддерева геометрия не проверяется — дети
    // скрытого могут быть «чистыми» со stale-layout прошлых кадров.
    const stack: { node: TUIElement; hiddenAncestor: boolean }[] = [{ node: root, hiddenAncestor: root.hidden }];
    visited.add(root);

    while (stack.length > 0) {
        const { node, hiddenAncestor } = stack.pop() as { node: TUIElement; hiddenAncestor: boolean };
        for (const child of node.getChildren()) {
            if (visited.has(child)) {
                violations.push(`${describe(child)} встречается в дереве дважды (второй раз — как ребёнок ${describe(node)})`);
                continue; // не обходим поддерево второй раз
            }
            visited.add(child);

            const parent = child.getParent();
            if (parent !== node) {
                violations.push(
                    `${describe(child)} — ребёнок ${describe(node)} (по getChildren), но getParent() → ${describeOrNull(parent)}`,
                );
            }

            const childRoot = child.getRoot();
            if (childRoot !== root) {
                violations.push(`${describe(child)} не укоренён: getRoot() → ${describeOrNull(childRoot)} (ожидался ${describe(root)})`);
            }

            const childHidden = hiddenAncestor || child.hidden;
            if (!childHidden) {
                checkLayoutContract(child, violations);
            }

            stack.push({ node: child, hiddenAncestor: childHidden });
        }
    }

    return violations;
}

/** Проверка layout-контракта одного узла (пропуски описаны в docstring выше). */
function checkLayoutContract(node: TUIElement, violations: string[]): void {
    if (node.isLayoutDirty) return;
    const constraints = node.lastLayoutConstraints;
    if (constraints === null) return;
    const size = node.layoutSize; // isLayoutDirty=false → lazy-layout не сработает
    if (!constraints.isSatisfiedBy(size)) {
        violations.push(
            `${describe(node)} нарушает layout-контракт: размер ${size.width}×${size.height} ` +
                `не удовлетворяет constraints [${constraints.minWidth}..${constraints.maxWidth}]×` +
                `[${constraints.minHeight}..${constraints.maxHeight}] последнего layout()`,
        );
    }
}

/**
 * Бросает с перечнем нарушений, если дерево невалидно. Вызывается после кадра
 * при включённом `TuiApplication.validateTreeAfterRender`.
 */
export function assertValidTree(root: TUIElement): void {
    const violations = validateTree(root);
    if (violations.length > 0) {
        throw new Error(`Дерево TUIDom нарушает инварианты (${violations.length}):\n- ${violations.join("\n- ")}`);
    }
}

function describe(element: TUIElement): string {
    const name = element.constructor.name;
    const id = element.id !== undefined ? `#${element.id}` : "";
    const role = element.role !== undefined ? `[role=${element.role}]` : "";
    return `${name}${id}${role}`;
}

function describeOrNull(element: TUIElement | null): string {
    return element === null ? "null" : describe(element);
}
