#pragma once

struct Shape {
    virtual ~Shape() = default;
    virtual double area() const = 0;
};

struct Square : Shape {
    explicit Square(double side) : side(side) {}
    double area() const override;
    double side;
};

double total(const Shape &a, const Shape &b);
