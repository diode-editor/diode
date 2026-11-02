#include "shape.h"

int main() {
    Square square(2.0);
    double a = square.area();
    int x = "s";
    return static_cast<int>(total(square, square) + a) + x;
}
