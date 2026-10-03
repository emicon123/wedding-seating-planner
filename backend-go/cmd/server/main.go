// Command server is the Stoliki binary: the REST API and the built SPA under BASE_PATH.
//
//	server                serve (default)
//	server healthcheck    GET http://127.0.0.1:$PORT$BASE_PATH/api/health; exit 0 only on 200
//	server backup <dest>  consistent copy of the database (VACUUM INTO)
//
// This file is the composition root: explicit wiring, no DI container.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/accessgate"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

// config comes from the environment; defaults per docs/architecture/02-system-context.md.
// The only secret is the shared PIN (STOLIKI_PIN); never log or print a config value.
type config struct {
	BasePath string // BASE_PATH, URL prefix kept end-to-end ("/wesele")
	Port     string // PORT, listen port
	DBPath   string // DB_PATH, SQLite file
	WebRoot  string // WEB_ROOT, built SPA directory
	PIN      string // STOLIKI_PIN, shared PIN of the access gate; empty = gate off
}

func loadConfig(getenv func(string) string) config {
	get := func(key, def string) string {
		if v := getenv(key); v != "" {
			return v
		}
		return def
	}
	return config{
		BasePath: httpapi.NormaliseBasePath(get("BASE_PATH", "/wesele")),
		Port:     get("PORT", "8080"),
		DBPath:   get("DB_PATH", "/data/stoliki.db"),
		WebRoot:  get("WEB_ROOT", "/app/web"),
		PIN:      get("STOLIKI_PIN", ""),
	}
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// run dispatches the subcommand. serve blocks until ctx is cancelled and then shuts down gracefully.
func run(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer) error {
	cmd, rest := "serve", args
	if len(args) > 0 {
		cmd, rest = args[0], args[1:]
	}
	cfg := loadConfig(getenv)

	switch {
	case cmd == "serve" && len(rest) == 0:
		return serve(ctx, cfg)
	case cmd == "healthcheck" && len(rest) == 0:
		return healthcheck(ctx, cfg)
	case cmd == "backup" && len(rest) == 1:
		return backup(ctx, cfg, rest[0], stdout)
	default:
		return fmt.Errorf("usage: server [serve | healthcheck | backup <dest>] (got %q)", args)
	}
}

func serve(ctx context.Context, cfg config) error {
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := store.Migrate(ctx, db); err != nil {
		return err
	}

	gate, err := newGate(cfg)
	if err != nil {
		return err
	}

	// Explicit wiring: DB -> store -> services -> HTTP adapter -> router.
	guestStore := store.NewGuests(db)
	guestSvc := guests.NewService(guestStore)
	planSvc := scenarios.NewService(store.NewScenarios(db), guestStore)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewRouter(cfg.BasePath, cfg.WebRoot, httpapi.NewServer(db, guestSvc, planSvc, gate), gate),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	failed := make(chan error, 1)
	go func() { failed <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", srv.Addr, "basePath", cfg.BasePath)

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shutdown: %w", err)
	}
	slog.Info("stopped")
	return nil
}

// newGate builds the PIN gate, or returns nil (gate off, today's open behaviour) when STOLIKI_PIN
// is unset or empty. The session secret lives next to the database file (0600, created once).
func newGate(cfg config) (*accessgate.Gate, error) {
	if cfg.PIN == "" {
		slog.Warn("access gate off (STOLIKI_PIN not set)")
		return nil, nil
	}
	secret, err := accessgate.LoadOrCreateSecret(filepath.Join(filepath.Dir(cfg.DBPath), "session.key"))
	if err != nil {
		return nil, err
	}
	slog.Info("access gate on")
	return accessgate.New(cfg.PIN, secret, cfg.BasePath, time.Now), nil
}

// healthcheck is the container probe (distroless has no shell or wget).
func healthcheck(ctx context.Context, cfg config) error {
	url := "http://127.0.0.1:" + cfg.Port + cfg.BasePath + "/api/health"
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: %s answered %s", url, resp.Status)
	}
	return nil
}

func backup(ctx context.Context, cfg config, dest string, stdout io.Writer) error {
	if _, err := os.Stat(cfg.DBPath); err != nil {
		return fmt.Errorf("backup: database %q: %w", cfg.DBPath, err)
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := store.Backup(ctx, db, dest); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "backup written to %s\n", dest)
	return nil
}
