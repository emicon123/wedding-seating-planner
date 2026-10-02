// Package store is the SQLite persistence layer: connection bootstrap, migrations, backup,
// and (in later tickets) the Guests and Scenarios stores over sqlc-generated queries.
// sqlc row types never leave this package.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/pressly/goose/v3"
	"modernc.org/sqlite" // registers the pure-Go "sqlite" driver and provides *sqlite.Error

	"github.com/wojtekrpi/stoliki/backend-go/db"
	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store/sqlcgen"
)

// Open opens (creating it if needed) the SQLite file at path with the pragmas from
// docs/architecture/02-system-context.md: WAL, foreign_keys=ON, busy_timeout=5000.
// The pool has a single connection: SQLite serialises writers anyway, and it keeps every
// pragma and every transaction on the same session. Never call db methods from inside a
// withTx callback — the only connection is held by the transaction.
func Open(path string) (*sql.DB, error) {
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	dsn := "file:" + (&url.URL{Path: path}).EscapedPath() + "?" + q.Encode()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("open sqlite %q: %w", path, err)
	}
	return conn, nil
}

// Migrate applies the embedded goose migrations that are not applied yet. Running it
// again is a no-op.
func Migrate(ctx context.Context, conn *sql.DB) error {
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return fmt.Errorf("embedded migrations: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, conn, migrations)
	if err != nil {
		return fmt.Errorf("goose provider: %w", err)
	}
	// provider.Close is deliberately not called: it would close conn, which the caller owns.
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// Backup writes a consistent copy of the database to dest with VACUUM INTO. It is safe while
// the server is running and refuses to overwrite an existing file.
func Backup(ctx context.Context, conn *sql.DB, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("backup: create destination directory: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "VACUUM INTO ?", dest); err != nil {
		return fmt.Errorf("backup to %q: %w", dest, err)
	}
	return nil
}

// withTx runs fn in one transaction: commit when it returns nil, rollback otherwise.
// Every store method is exactly one withTx call. The returned error goes through mapErr.
func withTx(ctx context.Context, conn *sql.DB, fn func(q *sqlcgen.Queries) error) (err error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return mapErr(err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if err = fn(sqlcgen.New(tx)); err != nil {
		return mapErr(err)
	}
	return mapErr(tx.Commit())
}

// mapErr translates driver errors into domain errors (docs/architecture/04-data-model.md):
// UNIQUE(guest.name_key) -> ErrDuplicateName; foreign-key violation and no rows -> ErrNotFound.
// Anything else is returned unchanged.
func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return apperr.ErrNotFound
	}
	var se *sqlite.Error
	if errors.As(err, &se) {
		msg := se.Error()
		switch {
		case strings.Contains(msg, "UNIQUE constraint failed: guest.name_key"):
			return apperr.ErrDuplicateName
		case strings.Contains(msg, "FOREIGN KEY constraint failed"):
			return apperr.ErrNotFound
		}
	}
	return err
}
