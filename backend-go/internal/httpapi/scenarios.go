package httpapi

import (
	"context"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// ListScenarios implements listScenarios: the three plans, evaluated on every read.
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

// CalculateProposals implements calculateProposals: three proposals, nothing stored.
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

// AcceptProposal implements acceptProposal: replace the plan with the given layout.
func (s *Server) AcceptProposal(ctx context.Context, req oapi.AcceptProposalRequestObject) (oapi.AcceptProposalResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	if req.Body.BasedOnVersion < 1 {
		return nil, badRequest("basedOnVersion", "basedOnVersion is required and must be at least 1.")
	}
	ev, err := s.plans.Accept(ctx, int(req.Capacity), int64(req.Body.BasedOnVersion), fromAcceptPlan(*req.Body))
	if err != nil {
		return nil, err
	}
	return oapi.AcceptProposal200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// SetAssignment implements setAssignment: move the guest's whole cluster, set its pin.
func (s *Server) SetAssignment(ctx context.Context, req oapi.SetAssignmentRequestObject) (oapi.SetAssignmentResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	ev, err := s.plans.Seat(ctx, int(req.Capacity), req.GuestId, req.Body.TableNumber, req.Body.Pinned)
	if err != nil {
		return nil, err
	}
	return oapi.SetAssignment200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// DeleteAssignment implements deleteAssignment: the whole cluster back to the tray.
func (s *Server) DeleteAssignment(ctx context.Context, req oapi.DeleteAssignmentRequestObject) (oapi.DeleteAssignmentResponseObject, error) {
	ev, err := s.plans.Unseat(ctx, int(req.Capacity), req.GuestId)
	if err != nil {
		return nil, err
	}
	return oapi.DeleteAssignment200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// AddTable implements addTable: an empty table at the end of the plan.
func (s *Server) AddTable(ctx context.Context, req oapi.AddTableRequestObject) (oapi.AddTableResponseObject, error) {
	ev, err := s.plans.AddTable(ctx, int(req.Capacity))
	if err != nil {
		return nil, err
	}
	return oapi.AddTable201JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}

// DeleteTable implements deleteTable: its guests become unseated, later tables renumber down.
func (s *Server) DeleteTable(ctx context.Context, req oapi.DeleteTableRequestObject) (oapi.DeleteTableResponseObject, error) {
	ev, err := s.plans.RemoveTable(ctx, int(req.Capacity), req.TableNumber)
	if err != nil {
		return nil, err
	}
	return oapi.DeleteTable200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}, nil
}
