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

// Plan is the seating of one scenario: at most Capacity guests per table (9, 10, 11 or 12).
// Mixed marks the mixed plan (Capacity 12, tables of 9-12 seats whose size follows their fill);
// it only changes how Propose picks the table count, Evaluate ignores it. Tables are ordered 1..k.
type Plan struct {
	Capacity int
	Mixed    bool
	Tables   []Table
}
