package seating

// Seat is one guest's assignment to a table.
type Seat struct {
	Guest  GuestID
	Pinned bool
}

// Table is one table of a plan; Number is its 1-based number.
type Table struct {
	Number int
	Seats  []Seat
}

// Plan is the seating of one scenario: every table has the same Capacity
// (8, 10 or 12). Tables are ordered 1..k.
type Plan struct {
	Capacity int
	Tables   []Table
}
