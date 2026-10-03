package seating

import (
	"fmt"
	"os"
	"sync"
	"testing"
)

// BenchmarkProposeTight times Propose per capacity on tightFixture(4), plus the four
// capacities in parallel goroutines as Service.Calculate runs them ("generate4").
// With STOLIKI_TUNE_INPUT set it uses that real-shaped file instead (never committed).
func BenchmarkProposeTight(b *testing.B) {
	g := tightFixture(4)
	if p := os.Getenv("STOLIKI_TUNE_INPUT"); p != "" {
		g = loadIDsGraph(b, p)
	}
	for _, capacity := range []int{9, 10, 11, 12} {
		b.Run(fmt.Sprintf("cap%d", capacity), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				Propose(g, emptyPlan(capacity))
			}
		})
	}
	b.Run("generate4", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var wg sync.WaitGroup
			for _, capacity := range []int{9, 10, 11, 12} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					Propose(g, emptyPlan(capacity))
				}()
			}
			wg.Wait()
		}
	})
}
