/**
 * Укладка и отрисовка графа коммитов — **дословный порт** pipe-модели lazygit
 * (`pkg/gui/presentation/graph/{graph,cell}.go`). Порядок шагов в
 * {@link getNextPipes} и порядок трёх проходов в {@link renderPipeSet}
 * существенны: от них зависит, какая линия куда сдвинется и чей цвет победит —
 * менять их «для красоты» нельзя, фикстуры из `graph_test.go` перестанут
 * сходиться (см. `commitGraph.fixtures.test.ts`).
 *
 * Единственное отличие от оригинала: вместо строки с ANSI-escape мы возвращаем
 * {@link IGraphLine} — текст плюс имя токена темы на каждый символ. Раскраску
 * делает `TextLabelElement.setCharStyle`, RGB-литералов в коде нет (AGENTS.md).
 *
 * Модуль чистый: ни tuidom, ни DI, ни темы — только строки и числа.
 */

/** Что линия делает на этой строке. Порядок значений — ключ сортировки пайпов. */
export enum PipeKind {
    /** Линия обрывается на этом коммите (коммит — её родитель). */
    Terminates,
    /** Линия начинается от этого коммита. */
    Starts,
    /** Линия проходит мимо. */
    Continues,
}

/**
 * Отрезок линии внутри одной строки: из колонки `fromPos` (позиция в строке
 * предыдущего коммита) в колонку `toPos` (позиция в текущей).
 */
export interface IPipe {
    readonly fromHash: string;
    readonly toHash: string;
    readonly fromPos: number;
    readonly toPos: number;
    readonly kind: PipeKind;
    /** Имя токена темы — цвет линии. */
    readonly style: string;
}

/** Всё, что алгоритму нужно знать о коммите. */
export interface IGraphCommit {
    readonly sha: string;
    /** Родители в порядке git; пусто — корневой коммит. */
    readonly parents: readonly string[];
}

/** Одна отрисованная строка графа: символы и токен темы на каждый из них. */
export interface IGraphLine {
    readonly text: string;
    /** Длина совпадает с числом символов `text`; `undefined` — символ без окраски. */
    readonly styles: readonly (string | undefined)[];
}

/**
 * Цвет линии (инжектится вызывающим). `sha` — коммит, в который линия идёт;
 * `inherited` — цвет линии, которую она продолжает, либо `null` для новой
 * дорожки (первый коммит списка, второй родитель merge, несвязанный корень).
 *
 * Наследование — отклонение от lazygit: там цвет линии берётся у автора
 * коммита, который её начал, а у нас он живёт на дорожке (модель vscode) — иначе
 * каждый коммит линейной истории красился бы в свой цвет вместо цвета ветки.
 */
export type GraphStyleProvider = (sha: string, inherited: string | null) => string;

/** Пустое дерево git — родитель корневого коммита (`git hash-object -t tree /dev/null`). */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Псевдо-хеш затравочного пайпа, ведущего в самый первый коммит списка. */
export const START_HASH = "START";

/** Токен цвета линий выделенного коммита (аналог `FgLightWhite.SetBold()` lazygit). */
export const GRAPH_HIGHLIGHT_STYLE = "list.highlightForeground";

/**
 * Цвет затравочного пайпа и клеток, которых не коснулась ни одна линия. До
 * кадра практически не доживает: терминатор затравки вырожденный (в колонке
 * коммита) и в рендере гасится, а нетронутые клетки — пробелы без окраски.
 */
export const GRAPH_DEFAULT_STYLE = "foreground";

const MERGE_SYMBOL = "◎";
const COMMIT_SYMBOL = "○";

/**
 * Хеши сравниваем как строки (в Go это сравнение указателей — там все хеши
 * интернированы через StringPool). `null` не равен ничему: так «нет выделенного
 * коммита» не совпадает случайно с пайпом без источника.
 */
function equalHashes(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return false;
    return a === b;
}

const pipeLeft = (pipe: IPipe): number => Math.min(pipe.fromPos, pipe.toPos);
const pipeRight = (pipe: IPipe): number => Math.max(pipe.fromPos, pipe.toPos);

/**
 * Граф целиком: на каждый коммит — своя строка. `selectedHash` подсвечивает
 * линии, исходящие из выбранного коммита (`null` — подсветки нет).
 */
export function renderCommitGraph(
    commits: readonly IGraphCommit[],
    selectedHash: string | null,
    getStyle: GraphStyleProvider,
): IGraphLine[] {
    const pipeSets = getPipeSets(commits, getStyle);
    return pipeSets.map((pipeSet, index) =>
        renderPipeSet(pipeSet, selectedHash, index > 0 ? commits[index - 1].sha : null),
    );
}

/**
 * Набор пайпов на каждую строку. Затравка — фиктивный STARTS-пайп из
 * {@link START_HASH} в первый коммит: без него первый коммит не нашёл бы
 * потомка и уехал бы в колонку 1.
 */
export function getPipeSets(commits: readonly IGraphCommit[], getStyle: GraphStyleProvider): IPipe[][] {
    if (commits.length === 0) return [];

    let pipes: IPipe[] = [
        {
            fromPos: 0,
            toPos: 0,
            fromHash: START_HASH,
            toHash: commits[0].sha,
            kind: PipeKind.Starts,
            style: GRAPH_DEFAULT_STYLE,
        },
    ];

    return commits.map((commit) => {
        pipes = getNextPipes(pipes, commit, getStyle);
        return pipes;
    });
}

/**
 * Пайпы строки коммита из пайпов предыдущей строки. Шаги идут строго в порядке
 * оригинала: `maxPos` считается по **всем** предыдущим пайпам (включая
 * терминировавшие), и только потом терминировавшие отбрасываются.
 */
export function getNextPipes(prevPipes: readonly IPipe[], commit: IGraphCommit, getStyle: GraphStyleProvider): IPipe[] {
    let maxPos = 0;
    for (const pipe of prevPipes) {
        if (pipe.toPos > maxPos) maxPos = pipe.toPos;
    }

    // Пайп, оборвавшийся на предыдущей строке, к текущей отношения не имеет.
    const currentPipes = prevPipes.filter((pipe) => pipe.kind !== PipeKind.Terminates);

    const newPipes: IPipe[] = [];
    // Исходное предположение — коммит ни с чем не связан (бывает только при
    // `git log --all`): такие приклеиваются в дальний конец.
    let pos = maxPos + 1;
    // Цвет дорожки, которую коммит продолжает: линия, оканчивающаяся на его
    // колонке, отдаёт свой цвет линии, уходящей к первому родителю.
    let inherited: string | null = null;
    for (const pipe of currentPipes) {
        if (equalHashes(pipe.toHash, commit.sha)) {
            // Потомок нашёлся — встаём ровно под первым его вхождением.
            pos = pipe.toPos;
            // Затравочный пайп цвета не несёт: первый коммит списка начинает
            // дорожку с нуля, а не наследует служебный дефолт.
            inherited = pipe.fromHash === START_HASH ? null : pipe.style;
            break;
        }
    }

    // Занятая колонка — та, на которой оканчивается пайп; пройденная — та,
    // которую пайп начинает, оканчивает или пересекает.
    const takenSpots = new Set<number>();
    const traversedSpots = new Set<number>();

    const toHash = commit.parents.length === 0 ? EMPTY_TREE_HASH : commit.parents[0];
    newPipes.push({
        fromPos: pos,
        toPos: pos,
        fromHash: commit.sha,
        toHash,
        kind: PipeKind.Starts,
        style: getStyle(commit.sha, inherited),
    });

    const traversedSpotsForContinuingPipes = new Set<number>();
    for (const pipe of currentPipes) {
        if (!equalHashes(pipe.toHash, commit.sha)) traversedSpotsForContinuingPipes.add(pipe.toPos);
    }

    const getNextAvailablePosForContinuingPipe = (): number => {
        let i = 0;
        while (traversedSpots.has(i)) i++;
        return i;
    };

    const getNextAvailablePosForNewPipe = (): number => {
        let i = 0;
        // Новая линия не может закончиться ни на занятой колонке, ни на той,
        // которую пересекает продолжающаяся.
        while (takenSpots.has(i) || traversedSpotsForContinuingPipes.has(i)) i++;
        return i;
    };

    const traverse = (from: number, to: number): void => {
        const left = Math.min(from, to);
        const right = Math.max(from, to);
        for (let i = left; i <= right; i++) traversedSpots.add(i);
        takenSpots.add(to);
    };

    for (const pipe of currentPipes) {
        if (equalHashes(pipe.toHash, commit.sha)) {
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: pos,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Terminates,
                style: pipe.style,
            });
            traverse(pipe.toPos, pos);
        } else if (pipe.toPos < pos) {
            const availablePos = getNextAvailablePosForContinuingPipe();
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: availablePos,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Continues,
                style: pipe.style,
            });
            traverse(pipe.toPos, availablePos);
        }
    }

    if (commit.parents.length > 1) {
        for (const parent of commit.parents.slice(1)) {
            const availablePos = getNextAvailablePosForNewPipe();
            // Считаем, что продолжающиеся линии останутся на своих колонках.
            newPipes.push({
                fromPos: pos,
                toPos: availablePos,
                fromHash: commit.sha,
                toHash: parent,
                kind: PipeKind.Starts,
                // Влитая ветка — новая дорожка со своим цветом: наследовать ей
                // не у кого, цвет мержа здесь означал бы «это та же ветка».
                style: getStyle(parent, null),
            });
            takenSpots.add(availablePos);
        }
    }

    for (const pipe of currentPipes) {
        if (!equalHashes(pipe.toHash, commit.sha) && pipe.toPos > pos) {
            // Продолжается — и по дороге может подвинуться влево, заполняя дырку.
            let last = pipe.toPos;
            for (let i = pipe.toPos; i > pos; i--) {
                if (takenSpots.has(i) || traversedSpots.has(i)) break;
                last = i;
            }
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: last,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Continues,
                style: pipe.style,
            });
            traverse(pipe.toPos, last);
        }
    }

    newPipes.sort((a, b) => (a.toPos === b.toPos ? a.kind - b.kind : a.toPos - b.toPos));

    return newPipes;
}

/** Клетка строки: два символа — узел/угол и соединитель справа. */
class Cell {
    private up = false;
    private down = false;
    private left = false;
    private right = false;
    private type: "connection" | "commit" | "merge" = "connection";
    private rightStyle: string | null = null;
    private style: string = GRAPH_DEFAULT_STYLE;

    public reset(): void {
        this.up = false;
        this.down = false;
        this.left = false;
        this.right = false;
    }

    public setUp(style: string): this {
        this.up = true;
        this.style = style;
        return this;
    }

    public setDown(style: string): this {
        this.down = true;
        this.style = style;
        return this;
    }

    public setLeft(style: string): this {
        this.left = true;
        // Вертикаль важнее горизонтали: её цвет не перебиваем.
        if (!this.up && !this.down) this.style = style;
        return this;
    }

    public setRight(style: string, override: boolean): this {
        this.right = true;
        if (this.rightStyle === null || override) this.rightStyle = style;
        return this;
    }

    public setStyle(style: string): this {
        this.style = style;
        return this;
    }

    public setType(type: "commit" | "merge"): this {
        this.type = type;
        return this;
    }

    /**
     * Два символа клетки со своими стилями. Пробел не красим — цвета у него не
     * видно, а тесты сверяют стиль каждого символа (то же соглашение в lazygit).
     */
    public render(): { chars: [string, string]; styles: [string | undefined, string | undefined] } {
        const [box, connector] = getBoxDrawingChars(this.up, this.down, this.left, this.right);
        const first = this.type === "commit" ? COMMIT_SYMBOL : this.type === "merge" ? MERGE_SYMBOL : box;
        const rightStyle = this.rightStyle ?? this.style;
        return {
            chars: [first, connector],
            styles: [first === " " ? undefined : this.style, connector === " " ? undefined : rightStyle],
        };
    }
}

/**
 * Символы клетки по её четырём направлениям: узел/угол и соединитель справа.
 * Экспортируется ради теста: таблица исчерпывающая (16 комбинаций), а фикстуры
 * lazygit задевают не все — проверять её целиком проще и честнее, чем городить
 * pipe-набор под каждую редкую комбинацию.
 */
export function getBoxDrawingChars(up: boolean, down: boolean, left: boolean, right: boolean): [string, string] {
    if (up && down && left && right) return ["│", "─"];
    if (up && down && left && !right) return ["│", " "];
    if (up && down && !left && right) return ["│", "─"];
    if (up && down && !left && !right) return ["│", " "];
    if (up && !down && left && right) return ["┴", "─"];
    if (up && !down && left && !right) return ["╯", " "];
    if (up && !down && !left && right) return ["╰", "─"];
    if (up && !down && !left && !right) return ["╵", " "];
    if (!up && down && left && right) return ["┬", "─"];
    if (!up && down && left && !right) return ["╮", " "];
    if (!up && down && !left && right) return ["╭", "─"];
    if (!up && down && !left && !right) return ["╷", " "];
    if (!up && !down && left && right) return ["─", "─"];
    if (!up && !down && left && !right) return ["─", " "];
    if (!up && !down && !left && right) return ["╶", "─"];
    return [" ", " "];
}

/**
 * Одна строка графа из набора пайпов. Три прохода задают приоритет цвета:
 * сначала невыделенные STARTS (перекрывают соединитель справа), затем прочие
 * невыделенные, и последними — линии выделенного коммита, которые сбрасывают
 * задетые клетки и рисуются highlight-цветом поверх.
 */
export function renderPipeSet(
    pipes: readonly IPipe[],
    selectedHash: string | null,
    prevCommitHash: string | null,
): IGraphLine {
    let maxPos = 0;
    let commitPos = 0;
    let startCount = 0;
    for (const pipe of pipes) {
        if (pipe.kind === PipeKind.Starts) {
            startCount++;
            commitPos = pipe.fromPos;
        } else if (pipe.kind === PipeKind.Terminates) {
            commitPos = pipe.toPos;
        }
        if (pipeRight(pipe) > maxPos) maxPos = pipeRight(pipe);
    }
    const isMerge = startCount > 1;

    const cells: Cell[] = [];
    for (let i = 0; i <= maxPos; i++) cells.push(new Cell());

    const renderPipe = (pipe: IPipe, style: string, overrideRightStyle: boolean): void => {
        const left = pipeLeft(pipe);
        const right = pipeRight(pipe);

        if (left !== right) {
            for (let i = left + 1; i < right; i++) cells[i].setLeft(style).setRight(style, overrideRightStyle);
            cells[left].setRight(style, overrideRightStyle);
            cells[right].setLeft(style);
        }

        if (pipe.kind === PipeKind.Starts || pipe.kind === PipeKind.Continues) cells[pipe.toPos].setDown(style);
        if (pipe.kind === PipeKind.Terminates || pipe.kind === PipeKind.Continues) cells[pipe.fromPos].setUp(style);
    };

    // Два подряд идущих коммита не подсвечиваем: подсветка нужна, только если в
    // строке есть настоящая видимая линия выделенного коммита.
    let highlight = true;
    if (prevCommitHash !== null && equalHashes(prevCommitHash, selectedHash)) {
        highlight = false;
        for (const pipe of pipes) {
            if (
                equalHashes(pipe.fromHash, selectedHash) &&
                (pipe.kind !== PipeKind.Terminates || pipe.fromPos !== pipe.toPos)
            ) {
                highlight = true;
            }
        }
    }

    const selectedPipes: IPipe[] = [];
    const nonSelectedPipes: IPipe[] = [];
    for (const pipe of pipes) {
        (highlight && equalHashes(pipe.fromHash, selectedHash) ? selectedPipes : nonSelectedPipes).push(pipe);
    }

    for (const pipe of nonSelectedPipes) {
        if (pipe.kind === PipeKind.Starts) renderPipe(pipe, pipe.style, true);
    }

    for (const pipe of nonSelectedPipes) {
        // Вырожденный TERMINATES ровно в колонке коммита пропускаем — иначе он
        // перебил бы цвет стартующей отсюда линии.
        const degenerateTerminator =
            pipe.kind === PipeKind.Terminates && pipe.fromPos === commitPos && pipe.toPos === commitPos;
        if (pipe.kind !== PipeKind.Starts && !degenerateTerminator) renderPipe(pipe, pipe.style, false);
    }

    for (const pipe of selectedPipes) {
        for (let i = pipeLeft(pipe); i <= pipeRight(pipe); i++) cells[i].reset();
    }
    for (const pipe of selectedPipes) {
        renderPipe(pipe, GRAPH_HIGHLIGHT_STYLE, true);
        if (pipe.toPos === commitPos) cells[pipe.toPos].setStyle(GRAPH_HIGHLIGHT_STYLE);
    }

    cells[commitPos].setType(isMerge ? "merge" : "commit");

    let text = "";
    const styles: (string | undefined)[] = [];
    for (const cell of cells) {
        const rendered = cell.render();
        text += rendered.chars[0] + rendered.chars[1];
        styles.push(rendered.styles[0], rendered.styles[1]);
    }
    return { text, styles };
}
