package httpapi

import (
	"context"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/wojtekrpi/stoliki/backend-go/internal/accessgate"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
)

// Pinger is the one thing the health check needs from the database; *sql.DB satisfies it.
type Pinger interface {
	PingContext(ctx context.Context) error
}

// Server is the adapter between the generated strict-server interface and the services:
// decode, call one service method, map. Operations whose ticket has not landed yet are
// answered by the embedded unimplemented value (501); a ticket replaces them by defining
// the method on Server.
type Server struct {
	unimplemented
	db     Pinger
	guests *guests.Service
	plans  *scenarios.Service
	gate   *accessgate.Gate // nil = access gate off (STOLIKI_PIN unset)
}

// NewServer wires the HTTP adapter: the guest list, the four plans and the access gate
// (nil = gate off, today's open behaviour).
func NewServer(db Pinger, g *guests.Service, p *scenarios.Service, gate *accessgate.Gate) *Server {
	return &Server{db: db, guests: g, plans: p, gate: gate}
}

var _ oapi.StrictServerInterface = (*Server)(nil)

// GetHealth implements getHealth: 200 when the database answers a ping, 500 otherwise.
func (s *Server) GetHealth(ctx context.Context, _ oapi.GetHealthRequestObject) (oapi.GetHealthResponseObject, error) {
	if err := s.db.PingContext(ctx); err != nil {
		return nil, err
	}
	id := middleware.GetReqID(ctx)
	return oapi.GetHealth200JSONResponse{
		Data: oapi.HealthStatus{Status: oapi.Ok},
		Meta: oapi.Meta{RequestId: &id},
	}, nil
}
