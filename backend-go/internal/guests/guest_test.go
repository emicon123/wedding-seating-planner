package guests

import (
	"errors"
	"testing"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

func ptr[T any](v T) *T { return &v }

func TestNameKey(t *testing.T) {
	tests := []struct {
		name  string
		first string
		last  *string
		want  string
	}{
		{"polish letters lower-cased in Go", "Łukasz ", ptr("Żak"), "łukasz żak"},
		{"no surname", "  Maciek", nil, "maciek"},
		{"upper case", "ANIA", ptr("KOWALSKA"), "ania kowalska"},
		{"inner and outer whitespace of parts is trimmed", " Ania ", ptr(" Nowak "), "ania nowak"},
		{"polish capital letters", "ŚWIĘTOSŁAW", nil, "świętosław"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := NameKey(tc.first, tc.last); got != tc.want {
				t.Errorf("NameKey = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDisplayName(t *testing.T) {
	if got := (Guest{FirstName: "Maciek"}).DisplayName(); got != "Maciek" {
		t.Errorf("without surname = %q", got)
	}
	if got := (Guest{FirstName: "Ania", LastName: ptr("Nowak")}).DisplayName(); got != "Ania Nowak" {
		t.Errorf("with surname = %q", got)
	}
}

func TestNewLink(t *testing.T) {
	tests := []struct {
		name      string
		a, b      int64
		level     seating.LinkLevel
		want      Link
		wantField string // non-empty: expect a Validation error on this field
	}{
		{name: "normalises A < B", a: 6, b: 4, level: 1, want: Link{A: 4, B: 6, Level: 1}},
		{name: "already ordered", a: 4, b: 6, level: 0, want: Link{A: 4, B: 6, Level: 0}},
		{name: "level 2", a: 1, b: 2, level: 2, want: Link{A: 1, B: 2, Level: 2}},
		{name: "self link", a: 4, b: 4, level: 1, wantField: "linkKey"},
		{name: "level too high", a: 1, b: 2, level: 3, wantField: "level"},
		{name: "level negative", a: 1, b: 2, level: -1, wantField: "level"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NewLink(tc.a, tc.b, tc.level)
			if tc.wantField != "" {
				var v apperr.Validation
				if !errors.As(err, &v) || v.Field != tc.wantField {
					t.Fatalf("err = %v, want Validation on %q", err, tc.wantField)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if got != tc.want {
				t.Errorf("link = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestLinkKey(t *testing.T) {
	if got := (Link{A: 4, B: 6}).Key(); got != "4-6" {
		t.Errorf("Key = %q", got)
	}
}

func TestParseLinkKey(t *testing.T) {
	tests := []struct {
		in      string
		a, b    int64
		wantErr bool
	}{
		{"4-6", 4, 6, false},
		{"6-4", 6, 4, false}, // not normalised here: NewLink does that
		{"4-4", 4, 4, false}, // equality is NewLink's business (422, not 400)
		{"12-345", 12, 345, false},
		{"", 0, 0, true},
		{"4", 0, 0, true},
		{"4-", 0, 0, true},
		{"-4", 0, 0, true},
		{"a-b", 0, 0, true},
		{"4-6-8", 0, 0, true},
		{"0-4", 0, 0, true},
		{"4- 6", 0, 0, true},
		{"+4-6", 0, 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			a, b, err := ParseLinkKey(tc.in)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidLinkKey) {
					t.Fatalf("err = %v, want ErrInvalidLinkKey", err)
				}
				return
			}
			if err != nil || a != tc.a || b != tc.b {
				t.Errorf("ParseLinkKey = %d, %d, %v; want %d, %d", a, b, err, tc.a, tc.b)
			}
		})
	}
}

func TestToSeating(t *testing.T) {
	gs := []Guest{
		{ID: 2, Enabled: true, CreatedAt: time.Time{}},
		{ID: 1, Enabled: false},
		{ID: 3, Enabled: true, IsChild: true},
	}
	ls := []Link{{A: 1, B: 2, Level: 0}, {A: 2, B: 3, Level: 2}}
	sg, sl := ToSeating(gs, ls)
	wantG := []seating.Guest{{ID: 2, Enabled: true}, {ID: 1, Enabled: false}, {ID: 3, Enabled: true, Child: true}}
	wantL := []seating.Link{{A: 1, B: 2, Level: seating.Must}, {A: 2, B: 3, Level: seating.Acceptable}}
	if len(sg) != 3 || sg[0] != wantG[0] || sg[1] != wantG[1] || sg[2] != wantG[2] {
		t.Errorf("guests = %+v, want %+v", sg, wantG)
	}
	if len(sl) != 2 || sl[0] != wantL[0] || sl[1] != wantL[1] {
		t.Errorf("links = %+v, want %+v", sl, wantL)
	}
}
