package httpapi

import (
	"context"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
)

// ListScenarios implements listScenarios: the five plans, evaluated on every read.
func (s *Server) ListScenarios(ctx context.Context, _ oapi.ListScenariosRequestObject) (oapi.ListScenariosResponseObject, error) {
	all, err := s.plans.List(ctx)
	if err != nil {
		return nil, err
	}
	data := make([]oapi.Scenario, len(all))
	for i, ev := range all {
		data[i] = toScenario(ev)
	}
	total := len(data)
	return oapi.ListScenarios200JSONResponse{Data: data, Meta: metaOf(ctx), Page: oapi.Page{Total: &total}}, nil
}

// CalculateProposals implements calculateProposals: five proposals, nothing stored.
func (s *Server) CalculateProposals(ctx context.Context, _ oapi.CalculateProposalsRequestObject) (oapi.CalculateProposalsResponseObject, error) {
	props, err := s.plans.Calculate(ctx)
	if err != nil {
		return nil, err
	}
	data := make([]oapi.Proposal, len(props))
	for i, p := range props {
		data[i] = toProposal(p)
	}
	total := len(data)
	return oapi.CalculateProposals200JSONResponse{Data: data, Meta: metaOf(ctx), Page: oapi.Page{Total: &total}}, nil
}

// ReplaceScenarios implements replaceScenarios: all five plans replaced atomically (Generate
// and its undo), or nothing changes.
func (s *Server) ReplaceScenarios(ctx context.Context, req oapi.ReplaceScenariosRequestObject) (oapi.ReplaceScenariosResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	for _, p := range req.Body.Plans {
		if p.BasedOnVersion < 1 {
			return nil, badRequest("basedOnVersion", "basedOnVersion is required and must be at least 1.")
		}
	}
	in, err := fromScenariosReplace(*req.Body)
	if err != nil {
		return nil, err
	}
	all, err := s.plans.Replace(ctx, in)
	if err != nil {
		return nil, err
	}
	data := make([]oapi.Scenario, len(all))
	for i, ev := range all {
		data[i] = toScenario(ev)
	}
	total := len(data)
	return oapi.ReplaceScenarios200JSONResponse{Data: data, Meta: metaOf(ctx), Page: oapi.Page{Total: &total}}, nil
}

// SetAssignment implements setAssignment: move the guest's whole cluster, set its pin.
func (s *Server) SetAssignment(ctx context.Context, req oapi.SetAssignmentRequestObject) (oapi.SetAssignmentResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	key, err := parseKey(req.PlanKey)
	if err != nil {
		return nil, err
	}
	ev, err := s.plans.Seat(ctx, key, req.GuestId, req.Body.TableNumber, req.Body.Pinned)
	if err != nil {
		return nil, err
	}
	return oapi.SetAssignment200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// DeleteAssignment implements deleteAssignment: the whole cluster back to the tray.
func (s *Server) DeleteAssignment(ctx context.Context, req oapi.DeleteAssignmentRequestObject) (oapi.DeleteAssignmentResponseObject, error) {
	key, err := parseKey(req.PlanKey)
	if err != nil {
		return nil, err
	}
	ev, err := s.plans.Unseat(ctx, key, req.GuestId)
	if err != nil {
		return nil, err
	}
	return oapi.DeleteAssignment200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// AddTable implements addTable: an empty table at the end of the plan.
func (s *Server) AddTable(ctx context.Context, req oapi.AddTableRequestObject) (oapi.AddTableResponseObject, error) {
	key, err := parseKey(req.PlanKey)
	if err != nil {
		return nil, err
	}
	ev, err := s.plans.AddTable(ctx, key)
	if err != nil {
		return nil, err
	}
	return oapi.AddTable201JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// DeleteTable implements deleteTable: its guests become unseated, later tables renumber down.
func (s *Server) DeleteTable(ctx context.Context, req oapi.DeleteTableRequestObject) (oapi.DeleteTableResponseObject, error) {
	key, err := parseKey(req.PlanKey)
	if err != nil {
		return nil, err
	}
	ev, err := s.plans.RemoveTable(ctx, key, req.TableNumber)
	if err != nil {
		return nil, err
	}
	return oapi.DeleteTable200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// ResetPlan implements resetPlan ("delete the plan"): the scenario becomes an empty plan, its
// version moves on, no body and no version check.
func (s *Server) ResetPlan(ctx context.Context, req oapi.ResetPlanRequestObject) (oapi.ResetPlanResponseObject, error) {
	key, err := parseKey(req.PlanKey)
	if err != nil {
		return nil, err
	}
	ev, err := s.plans.Reset(ctx, key)
	if err != nil {
		return nil, err
	}
	return oapi.ResetPlan200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// parseKey maps the planKey path parameter to a plan identity. chi does not validate the enum,
// so an unknown key is the same 404 an unknown plan always gave.
func parseKey(k oapi.PlanKey) (scenarios.Key, error) {
	key, ok := scenarios.ParseKey(string(k))
	if !ok {
		return scenarios.Key{}, apperr.ErrNotFound
	}
	return key, nil
}
