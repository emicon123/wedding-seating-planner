// Package db embeds the goose migrations so the server binary can apply them at startup.
// The SQL files in migrations/ are Architect-owned; sqlc reads the same directory.
package db

import "embed"

// Migrations holds db/migrations/*.sql (goose format).
//
//go:embed migrations/*.sql
var Migrations embed.FS
