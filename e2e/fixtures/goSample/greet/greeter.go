package greet

import "fmt"

// Greeter produces a greeting.
type Greeter interface {
	Greet() string
}

// English greets in English.
type English struct{ Name string }

// Greet implements Greeter.
func (e English) Greet() string { return Hello(e.Name) }

// Polite greets formally.
type Polite struct{ Name string }

// Greet implements Greeter.
func (p Polite) Greet() string { return "Good day, " + p.Name }

// Pair holds one greeter of each type.
type Pair struct {
	First  English
	Second Polite
}

// Speak prints the greeting of g and returns a count.
func Speak(g Greeter) int {
	x := 1
	x = 2
	fmt.Println(g.Greet(), x)
	return x
}

// SpeakPair lets both greeters speak.
func SpeakPair() int {
	pair := Pair{First: English{Name: "a"}, Second: Polite{Name: "b"}}
	return Speak(pair.First) + Speak(pair.Second)
}
