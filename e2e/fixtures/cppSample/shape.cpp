#include "shape.h"

double Square::area() const { return side * side; }

double total(const Shape &a, const Shape &b) { return a.area() + b.area(); }
