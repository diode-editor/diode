export class Point {
    public readonly x: number;
    public readonly y: number;

    public constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

export class Offset {
    public readonly dx: number;
    public readonly dy: number;

    public constructor(dx: number, dy: number) {
        this.dx = dx;
        this.dy = dy;
    }
}

export class Size {
    public readonly width: number;
    public readonly height: number;

    public constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }
}

export class BoxConstraints {
    public readonly minWidth: number;
    public readonly maxWidth: number;
    public readonly minHeight: number;
    public readonly maxHeight: number;

    public constructor(minWidth: number, maxWidth: number, minHeight: number, maxHeight: number) {
        this.minWidth = minWidth;
        this.maxWidth = maxWidth;
        this.minHeight = minHeight;
        this.maxHeight = maxHeight;
    }

    public static tight(size: Size): BoxConstraints {
        return new BoxConstraints(size.width, size.width, size.height, size.height);
    }

    public static loose(size: Size): BoxConstraints {
        return new BoxConstraints(0, size.width, 0, size.height);
    }

    public constrain(size: Size): Size {
        return new Size(
            Math.min(this.maxWidth, Math.max(this.minWidth, size.width)),
            Math.min(this.maxHeight, Math.max(this.minHeight, size.height)),
        );
    }

    /** Удовлетворяет ли размер этим constraints (контракт layout: см. docs/LAYOUT.md). */
    public isSatisfiedBy(size: Size): boolean {
        return (
            size.width >= this.minWidth &&
            size.width <= this.maxWidth &&
            size.height >= this.minHeight &&
            size.height <= this.maxHeight
        );
    }
}

export class Rect {
    public readonly origin: Point;
    public readonly size: Size;

    public constructor(origin: Point, size: Size) {
        this.origin = origin;
        this.size = size;
    }

    public get x(): number {
        return this.origin.x;
    }

    public get y(): number {
        return this.origin.y;
    }

    public get width(): number {
        return this.size.width;
    }

    public get height(): number {
        return this.size.height;
    }

    public get right(): number {
        return this.origin.x + this.size.width;
    }

    public get bottom(): number {
        return this.origin.y + this.size.height;
    }

    public containsPoint(point: Point): boolean {
        return point.x >= this.x && point.x < this.right && point.y >= this.y && point.y < this.bottom;
    }

    public intersect(other: Rect): Rect {
        const x = Math.max(this.x, other.x);
        const y = Math.max(this.y, other.y);
        const right = Math.min(this.right, other.right);
        const bottom = Math.min(this.bottom, other.bottom);
        const width = Math.max(0, right - x);
        const height = Math.max(0, bottom - y);
        return new Rect(new Point(x, y), new Size(width, height));
    }

    public get isEmpty(): boolean {
        return this.size.width <= 0 || this.size.height <= 0;
    }
}
