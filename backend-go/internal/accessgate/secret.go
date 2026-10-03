package accessgate

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
)

const secretLen = 32

// LoadOrCreateSecret returns the per-install session secret stored at path: 32 random bytes,
// created with mode 0600 on first use. A file of any other size is an error (never silently
// replaced, which would log everyone out without a trace).
func LoadOrCreateSecret(path string) ([]byte, error) {
	secret, err := os.ReadFile(path)
	if err == nil {
		return checkSecret(path, secret)
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("session key: %w", err)
	}

	secret = make([]byte, secretLen)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("session key: %w", err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) { // lost a creation race: use the winner's file
		if secret, err = os.ReadFile(path); err != nil {
			return nil, fmt.Errorf("session key: %w", err)
		}
		return checkSecret(path, secret)
	}
	if err != nil {
		return nil, fmt.Errorf("session key: %w", err)
	}
	_, werr := f.Write(secret)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		_ = os.Remove(path) // never leave a truncated key behind
		return nil, fmt.Errorf("session key: %w", werr)
	}
	return secret, nil
}

func checkSecret(path string, secret []byte) ([]byte, error) {
	if len(secret) != secretLen {
		return nil, fmt.Errorf("session key: %s has %d bytes, want %d (delete it to create a new one)", path, len(secret), secretLen)
	}
	return secret, nil
}
