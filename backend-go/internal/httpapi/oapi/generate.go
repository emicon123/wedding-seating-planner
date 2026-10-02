// Package oapi holds the oapi-codegen output for docs/openapi.yaml
// (chi strict-server + models). Regenerate with `go generate ./...`; never edit oapi.gen.go.
package oapi

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 -config cfg.yaml ../../../../docs/openapi.yaml
