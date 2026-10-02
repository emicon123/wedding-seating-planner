package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

func envMap(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

// portOf returns the port of an httptest server.
func portOf(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Port()
}

func freePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	return port
}

func TestLoadConfigDefaults(t *testing.T) {
	got := loadConfig(envMap(nil))
	want := config{BasePath: "/wesele", Port: "8080", DBPath: "/data/stoliki.db", WebRoot: "/app/web"}
	if got != want {
		t.Errorf("defaults = %+v, want %+v", got, want)
	}
	got = loadConfig(envMap(map[string]string{"BASE_PATH": "/x", "PORT": "9", "DB_PATH": "d", "WEB_ROOT": "w"}))
	if want := (config{BasePath: "/x", Port: "9", DBPath: "d", WebRoot: "w"}); got != want {
		t.Errorf("from env = %+v, want %+v", got, want)
	}
}

func TestHealthcheck(t *testing.T) {
	ctx := context.Background()

	t.Run("nil when the health endpoint answers 200", func(t *testing.T) {
		var path string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path = r.URL.Path
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()
		env := envMap(map[string]string{"PORT": portOf(t, srv), "BASE_PATH": "/wesele"})
		if err := run(ctx, []string{"healthcheck"}, env, io.Discard); err != nil {
			t.Fatalf("healthcheck: %v", err)
		}
		if path != "/wesele/api/health" {
			t.Errorf("probed %q, want /wesele/api/health", path)
		}
	})

	t.Run("error on a non-200 answer", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		env := envMap(map[string]string{"PORT": portOf(t, srv)})
		if err := run(ctx, []string{"healthcheck"}, env, io.Discard); err == nil {
			t.Fatal("healthcheck succeeded against a 500")
		}
	})

	t.Run("error when nothing listens", func(t *testing.T) {
		env := envMap(map[string]string{"PORT": freePort(t)})
		if err := run(ctx, []string{"healthcheck"}, env, io.Discard); err == nil {
			t.Fatal("healthcheck succeeded with the server down")
		}
	})
}

func TestRunRejectsBadArguments(t *testing.T) {
	for _, args := range [][]string{{"bogus"}, {"backup"}, {"backup", "a", "b"}, {"healthcheck", "extra"}} {
		if err := run(context.Background(), args, envMap(nil), io.Discard); err == nil {
			t.Errorf("run(%v) = nil, want an error", args)
		}
	}
}

// The binary serves the API and an (empty) SPA dir under BASE_PATH, migrates at startup,
// reports healthy through its own healthcheck subcommand, and shuts down cleanly.
func TestServeEndToEnd(t *testing.T) {
	dir := t.TempDir()
	webRoot := filepath.Join(dir, "web")
	if err := os.Mkdir(webRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webRoot, "index.html"), []byte("<title>spa</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	port := freePort(t)
	env := envMap(map[string]string{
		"PORT": port, "BASE_PATH": "/wesele", "WEB_ROOT": webRoot, "DB_PATH": filepath.Join(dir, "stoliki.db"),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(ctx, nil, env, io.Discard) }() // no args = serve

	deadline := time.Now().Add(10 * time.Second)
	for run(context.Background(), []string{"healthcheck"}, env, io.Discard) != nil {
		select {
		case err := <-done:
			t.Fatalf("server exited early: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("server never became healthy")
		}
		time.Sleep(50 * time.Millisecond)
	}

	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%s/wesele/plany/10", port))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "spa") {
		t.Errorf("SPA fallback = %d %q", resp.StatusCode, body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve returned %v after shutdown, want nil", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("server did not shut down")
	}
}

func TestBackupSubcommand(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "stoliki.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	db.Close()

	dest := filepath.Join(dir, "backups", "copy.db")
	var out strings.Builder
	if err := run(context.Background(), []string{"backup", dest}, envMap(map[string]string{"DB_PATH": dbPath}), &out); err != nil {
		t.Fatalf("backup: %v", err)
	}
	if !strings.Contains(out.String(), dest) {
		t.Errorf("stdout = %q, want it to mention the destination", out.String())
	}

	cp, err := store.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer cp.Close()
	rows, err := cp.Query(`SELECT capacity FROM scenario ORDER BY capacity`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []int
	for rows.Next() {
		var c int
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		got = append(got, c)
	}
	if !slices.Equal(got, []int{8, 10, 12}) {
		t.Errorf("backup scenarios = %v, want [8 10 12]", got)
	}
}
