package accessgate

import (
	"sync"
	"time"
)

// Login throttle parameters (docs/architecture/05-access-gate.md § 4), in one place.
const (
	freeFailures      = 3                // failures per client before the first lock
	baseLock          = 30 * time.Second // lock after failure freeFailures+1; doubles with each further failure
	maxLock           = time.Hour
	clientTTL         = 24 * time.Hour // a client is forgotten this long after its last failure
	maxClients        = 4096
	globalWindow      = 24 * time.Hour // rolling window of the global budget
	globalMaxFailures = 20
)

// throttle keeps the failed-login counters in memory (a restart clears them). Its methods are
// NOT synchronised: Gate.Login holds mu across check → compare → fail/succeed, so concurrent
// guesses cannot all pass the lock check before the first failure is recorded.
type throttle struct {
	mu      sync.Mutex
	clients map[string]*clientState // at most maxClients entries
	global  []time.Time             // failure times within the last globalWindow (at most globalMaxFailures)
}

type clientState struct {
	failures    int
	lockedUntil time.Time
	lastFailure time.Time
}

func newThrottle() *throttle {
	return &throttle{clients: make(map[string]*clientState)}
}

// check reports whether a login attempt of client key must be refused right now and, if so,
// for how long (the longer of the client lock and the global lock). Expired entries are dropped.
func (t *throttle) check(key string, now time.Time) (retryAfter time.Duration, locked bool) {
	t.pruneGlobal(now)
	if len(t.global) >= globalMaxFailures {
		retryAfter = t.global[0].Add(globalWindow).Sub(now)
	}
	if st, ok := t.clients[key]; ok {
		switch {
		case !now.Before(st.lastFailure.Add(clientTTL)):
			delete(t.clients, key) // forgotten
		case st.lockedUntil.After(now):
			retryAfter = max(retryAfter, st.lockedUntil.Sub(now))
		}
	} else if len(t.clients) >= maxClients {
		t.pruneClients(now)
		if len(t.clients) >= maxClients { // still full: fail closed for unknown clients
			retryAfter = max(retryAfter, baseLock)
		}
	}
	return retryAfter, retryAfter > 0
}

// failResult says what a recorded failure caused; Login turns it into log lines (counts only).
type failResult struct {
	failures     int           // this client's failures so far
	clientLock   time.Duration // lock just set for this client (0 = none)
	globalClosed bool          // the global budget is now exhausted
}

// fail records one wrong PIN of client key (also in the global window).
func (t *throttle) fail(key string, now time.Time) failResult {
	t.global = append(t.global, now)
	res := failResult{globalClosed: len(t.global) >= globalMaxFailures}
	st, ok := t.clients[key]
	if !ok {
		if len(t.clients) >= maxClients { // check refuses unknown clients when full; defensive
			return res
		}
		st = &clientState{}
		t.clients[key] = st
	}
	st.failures++
	st.lastFailure = now
	res.failures = st.failures
	if st.failures > freeFailures {
		exp := min(st.failures-freeFailures-1, 20) // 30 s · 2^n passes the 1 h cap long before 2^20
		res.clientLock = min(baseLock<<exp, maxLock)
		st.lockedUntil = now.Add(res.clientLock)
	}
	return res
}

// succeed forgets the client's failures; the global window is deliberately left alone.
func (t *throttle) succeed(key string) { delete(t.clients, key) }

func (t *throttle) pruneGlobal(now time.Time) {
	i := 0
	for i < len(t.global) && !now.Before(t.global[i].Add(globalWindow)) {
		i++
	}
	t.global = t.global[i:]
}

func (t *throttle) pruneClients(now time.Time) {
	for k, st := range t.clients {
		if !now.Before(st.lastFailure.Add(clientTTL)) {
			delete(t.clients, k)
		}
	}
}
