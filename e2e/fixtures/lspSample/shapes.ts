export interface Shape {
    area(): number;
}

export class Circle implements Shape {
    area(): number {
        return 3;
    }
}

export class Square implements Shape {
    area(): number {
        return 4;
    }
}

export const s: Shape = new Circle();
