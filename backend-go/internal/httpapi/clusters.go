package httpapi

import (
	"context"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// GetClusterOverview implements getClusterOverview: clusters, affinities and data warnings,
// derived from all guests on every call (nothing is stored).
func (s *Server) GetClusterOverview(ctx context.Context, _ oapi.GetClusterOverviewRequestObject) (oapi.GetClusterOverviewResponseObject, error) {
	g, err := s.guests.Graph(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.GetClusterOverview200JSONResponse{Data: toClusterOverview(g), Meta: metaOf(ctx)}, nil
}
