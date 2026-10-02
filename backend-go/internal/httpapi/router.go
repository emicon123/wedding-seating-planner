package httpapi

import (
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// maxBodyBytes is the request body limit of the API (docs/architecture/02-system-context.md).
// The CSV import endpoint (B-12, 2 MB) will need its own limit.
const maxBodyBytes = 1 << 20

// NewRouter builds the whole HTTP surface under basePath (config BASE_PATH, "/wesele" in prod;
// the prefix is kept end-to-end, so nothing here hardcodes it):
//
//	basePath + "/api/*"  the oapi-codegen strict server (error envelope for every failure)
//	basePath + "/*"      static SPA files from webRoot, index.html for unknown extensionless paths
//	basePath             301 -> basePath + "/"
func NewRouter(basePath, webRoot string, api oapi.StrictServerInterface) http.Handler {
	base := NormaliseBasePath(basePath)

	root := chi.NewRouter()
	root.Use(noIndex)
	root.Use(middleware.Compress(5, "text/html", "text/css", "text/javascript", "application/javascript", "application/json", "image/svg+xml"))
	root.Mount(base+"/api", apiRouter(api))
	if base != "" {
		root.Get(base, func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, base+"/", http.StatusMovedPermanently)
		})
	}
	if webRoot != "" {
		spa := spaHandler(os.DirFS(webRoot))
		root.Get(base+"/*", spa)
		root.Head(base+"/*", spa)
	}
	return root
}

// NormaliseBasePath turns "", "/", "wesele", "/wesele/" into "" or "/wesele".
func NormaliseBasePath(p string) string {
	p = strings.Trim(p, "/")
	if p == "" {
		return ""
	}
	return "/" + p
}

// apiRouter serves the generated routes (relative to the mount point) with the API middleware:
// request id, panic recovery into the error envelope, request log without bodies, body limit.
func apiRouter(api oapi.StrictServerInterface) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, recoverer, requestLog, bodyLimit)
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { writeError(w, r, apperr.ErrNotFound) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, errMethodNotAllowed)
	})

	strict := oapi.NewStrictHandlerWithOptions(api, nil, oapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  requestErrorHandler,
		ResponseErrorHandlerFunc: writeError,
	})
	return oapi.HandlerWithOptions(strict, oapi.ChiServerOptions{
		BaseRouter:       r,
		Middlewares:      []oapi.MiddlewareFunc{strictBody},
		ErrorHandlerFunc: paramErrorHandler,
	})
}

func noIndex(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex")
		next.ServeHTTP(w, r)
	})
}

func bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

// recoverer turns a handler panic into the 500 error envelope instead of chi's plain-text dump.
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				writeError(w, r, fmt.Errorf("panic: %v", rec))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// requestLog logs method, path, status and duration — never bodies, queries or guest data.
func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		level := slog.LevelInfo
		if strings.HasSuffix(r.URL.Path, "/health") {
			level = slog.LevelDebug // container healthchecks would flood the log
		}
		slog.Log(r.Context(), level, "request",
			"requestId", middleware.GetReqID(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"durationMs", time.Since(start).Milliseconds(),
		)
	})
}

// spaHandler serves files from fsys. An unknown path without a file extension is a client-side
// route and gets index.html; an unknown path WITH an extension (a missing asset) is a real 404,
// so a stale bundle never receives HTML where it expects JavaScript.
func spaHandler(fsys fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+chi.URLParam(r, "*")), "/")
		if name == "" {
			name = "index.html"
		}
		if serveFile(w, r, fsys, name) {
			return
		}
		if path.Ext(name) == "" && serveFile(w, r, fsys, "index.html") {
			return
		}
		http.NotFound(w, r)
	}
}

func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	f, err := fsys.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	switch {
	case name == "index.html":
		w.Header().Set("Cache-Control", "no-cache") // always pick up a new bundle
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable") // Vite hashes asset names
	}
	http.ServeContent(w, r, name, info.ModTime(), rs)
	return true
}
