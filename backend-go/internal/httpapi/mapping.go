package httpapi

import (
	"context"
	"fmt"
	"sort"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/oapi-codegen/nullable"

	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// The DTO mappers: plain functions, one per type (docs/architecture/04-data-model.md).
// Domain types never carry OpenAPI types and OpenAPI types never enter the services.

// metaOf is the response meta carrying the request id.
func metaOf(ctx context.Context) oapi.Meta {
	id := middleware.GetReqID(ctx)
	return oapi.Meta{RequestId: &id}
}

// toGuest maps one guest; refs are the links touching it, seen from this guest.
func toGuest(g guests.Guest, refs []oapi.GuestLinkRef) oapi.Guest {
	if refs == nil {
		refs = []oapi.GuestLinkRef{} // JSON [] and not null
	}
	id, name, version := g.ID, g.DisplayName(), int(g.Version)
	created, updated := g.CreatedAt, g.UpdatedAt
	last := nullable.NewNullNullable[string]() // always set explicitly: an unset Nullable marshals as ""
	if g.LastName != nil {
		last = nullable.NewNullableWithValue(*g.LastName)
	}
	return oapi.Guest{
		Id:          &id,
		FirstName:   g.FirstName,
		LastName:    last,
		DisplayName: &name,
		Notes:       g.Notes,
		IsChild:     g.IsChild,
		Enabled:     g.Enabled,
		Version:     &version,
		Links:       &refs,
		CreatedAt:   &created,
		UpdatedAt:   &updated,
	}
}

// toGuestList maps guests in the given order and projects every link onto both of its
// guests (each link appears on both). Links whose guests are not in gs are ignored.
func toGuestList(gs []guests.Guest, ls []guests.Link) []oapi.Guest {
	refs := make(map[int64][]oapi.GuestLinkRef, len(gs))
	for _, l := range ls {
		refs[l.A] = append(refs[l.A], oapi.GuestLinkRef{GuestId: l.B, Level: oapi.LinkLevel(l.Level)})
		refs[l.B] = append(refs[l.B], oapi.GuestLinkRef{GuestId: l.A, Level: oapi.LinkLevel(l.Level)})
	}
	out := make([]oapi.Guest, len(gs))
	for i, g := range gs {
		r := refs[g.ID]
		sort.Slice(r, func(i, j int) bool { return r[i].GuestId < r[j].GuestId })
		out[i] = toGuest(g, r)
	}
	return out
}

func toLink(l guests.Link) oapi.GuestLink {
	key, ids := l.Key(), []int64{l.A, l.B}
	return oapi.GuestLink{Key: &key, GuestIds: &ids, Level: oapi.LinkLevel(l.Level)}
}

// toClusterOverview maps the derived graph. Affinities are listed per cluster and are
// symmetric because Graph.Affinity is. Warning messages are English; the UI maps `code`.
func toClusterOverview(g seating.Graph) oapi.ClusterOverview {
	clusters := g.Clusters()
	out := oapi.ClusterOverview{
		Clusters: make([]oapi.Cluster, 0, len(clusters)),
		Warnings: make([]oapi.DataWarning, 0, len(g.Warnings())),
	}
	for _, c := range clusters {
		key, size := c.Key, c.SeatedSize()
		members, enabled := nonNil(c.Members), nonNil(c.Enabled)
		affinities := []oapi.ClusterAffinity{}
		for _, other := range clusters { // ordered by key
			if other.Key == c.Key {
				continue
			}
			if level, ok := g.Affinity(c.Key, other.Key); ok {
				affinities = append(affinities, oapi.ClusterAffinity{ClusterKey: other.Key, Level: oapi.ClusterAffinityLevel(level)})
			}
		}
		out.Clusters = append(out.Clusters, oapi.Cluster{
			Key: &key, GuestIds: &members, EnabledGuestIds: &enabled, SeatedSize: &size, Affinities: &affinities,
		})
	}
	for _, w := range g.Warnings() {
		out.Warnings = append(out.Warnings, toDataWarning(w))
	}
	return out
}

func toDataWarning(w seating.DataWarning) oapi.DataWarning {
	var code oapi.DataWarningCode
	var msg string
	switch w.Code {
	case seating.WarnClusterExceeds9:
		code, msg = oapi.ClusterExceeds9, "A group-0 cluster of enabled guests does not fit the 9-seat plan."
	case seating.WarnClusterExceeds12:
		code, msg = oapi.ClusterExceeds12, "A group-0 cluster of enabled guests does not fit the 12-seat plan."
	case seating.WarnConflictingLinkLevels:
		code, msg = oapi.ConflictingLinkLevels, "Two clusters are linked with both group 1 and group 2; group 1 is used."
	default:
		code, msg = oapi.DataWarningCode(w.Code), fmt.Sprintf("Data warning %q.", w.Code)
	}
	return oapi.DataWarning{Code: code, Message: msg, GuestIds: nonNil(w.Guests)}
}

// nonNil returns a copy that is never nil, so it marshals as [] and not null.
func nonNil(ids []int64) []int64 {
	return append([]int64{}, ids...)
}

// toScenario maps a stored plan with its evaluation (listScenarios and every plan mutation).
func toScenario(ev scenarios.Evaluated) oapi.Scenario {
	version := int(ev.State.Version)
	return oapi.Scenario{
		Capacity: oapi.Capacity(ev.State.Plan.Capacity),
		Version:  &version,
		Plan:     toSeatingPlan(ev.State.Plan.Capacity, ev.Eval),
	}
}

// toProposal maps a transient auto-seating result (calculateProposals).
func toProposal(p scenarios.Proposal) oapi.Proposal {
	return oapi.Proposal{
		Capacity:       oapi.Capacity(p.Plan.Capacity),
		BasedOnVersion: int(p.BasedOnVersion),
		Plan:           toSeatingPlan(p.Plan.Capacity, p.Eval),
	}
}

// toSeatingPlan maps an evaluation. Every list is [] and never null; every table number that
// can be absent (unseated guest, violation not about one table) is an explicit JSON null.
func toSeatingPlan(capacity int, ev seating.Evaluation) oapi.SeatingPlan {
	out := oapi.SeatingPlan{
		Summary: oapi.PlanSummary{
			TableCount:         ev.Summary.TableCount,
			SeatedCount:        ev.Summary.Seated,
			UnseatedCount:      ev.Summary.Unseated,
			Score:              float32(ev.Summary.Score),
			ViolationCount:     ev.Summary.ViolationCount,
			NeedsRecalculation: ev.Summary.NeedsRecalculation,
		},
		Tables:      make([]oapi.PlanTable, len(ev.Tables)),
		Unseated:    toPlacements(ev.Unseated),
		GuestScores: make([]oapi.GuestScore, len(ev.GuestScores)),
		Violations:  make([]oapi.Violation, len(ev.Violations)),
	}
	fills := make(map[int]int, len(ev.Tables))
	for i, t := range ev.Tables {
		fills[t.Number] = t.Fill
		out.Tables[i] = oapi.PlanTable{Number: t.Number, Fill: t.Fill, Score: float32(t.Score), Clusters: toPlacements(t.Clusters)}
	}
	for i, s := range ev.GuestScores {
		out.GuestScores[i] = oapi.GuestScore{
			GuestId:          s.Guest,
			TableNumber:      nullableTable(s.Table),
			Satisfaction:     float32(s.Satisfaction),
			PreferredTotal:   s.PreferredTotal,
			PreferredAtTable: s.PreferredAtTable,
			FallbackAtTable:  s.FallbackAtTable,
			StrangersAtTable: s.StrangersAtTable,
		}
	}
	for i, v := range ev.Violations {
		out.Violations[i] = oapi.Violation{
			Code:        oapi.ViolationCode(v.Code),
			Message:     violationMessage(v, capacity, fills),
			TableNumber: nullableTable(v.Table),
			GuestIds:    nonNil(v.Guests),
		}
	}
	return out
}

func toPlacements(ps []seating.Placement) []oapi.ClusterPlacement {
	out := make([]oapi.ClusterPlacement, len(ps))
	for i, p := range ps {
		out[i] = oapi.ClusterPlacement{ClusterKey: p.ClusterKey, GuestIds: nonNil(p.Guests), Pinned: p.Pinned}
	}
	return out
}

// nullableTable is the table number, or an explicit null for 0 ("no table").
func nullableTable(n int) nullable.Nullable[int] {
	if n == 0 {
		return nullable.NewNullNullable[int]()
	}
	return nullable.NewNullableWithValue(n)
}

// violationMessage is an English summary built from counts only (never guest names); the UI
// maps `code` to Polish text.
func violationMessage(v seating.Violation, capacity int, fills map[int]int) string {
	switch v.Code {
	case seating.ViolOverCapacity:
		return fmt.Sprintf("Table %d has %d guests (capacity %d).", v.Table, fills[v.Table], capacity)
	case seating.ViolUnderFloor:
		return fmt.Sprintf("Table %d has %d guests (minimum %d).", v.Table, fills[v.Table], seating.Floor)
	case seating.ViolClusterSplit:
		return "A group-0 cluster is split across several tables."
	case seating.ViolUnseated:
		return fmt.Sprintf("%d enabled guests have no table.", len(v.Guests))
	case seating.ViolOversizedCluster:
		return fmt.Sprintf("A group-0 cluster of %d guests does not fit a table of %d.", len(v.Guests), capacity)
	default:
		return fmt.Sprintf("Plan violation %q.", v.Code)
	}
}

// fromAcceptPlan maps the accepted layout to core tables (seats unpinned: the service keeps the
// pins of previously pinned clusters).
func fromAcceptPlan(body oapi.AcceptPlan) []seating.Table {
	tables := make([]seating.Table, len(body.Tables))
	for i, t := range body.Tables {
		tables[i] = seating.Table{Number: t.Number, Seats: make([]seating.Seat, len(t.GuestIds))}
		for j, id := range t.GuestIds {
			tables[i].Seats[j] = seating.Seat{Guest: id}
		}
	}
	return tables
}
