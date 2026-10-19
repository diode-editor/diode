package greet

import "testing"

func TestHello(t *testing.T) {
	if Hello("x") != "Hello, X" {
		t.Fatal("bad")
	}
}
