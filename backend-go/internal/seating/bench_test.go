package seating

import (
	"fmt"
	"os"
	"sync"
	"testing"
)

// benchPlans are the five plans Service.Calculate proposes, in its order.
var benchPlans = []Plan{{Capacity: 9}, {Capacity: 10}, {Capacity: 11}, {Capacity: 12}, {Capacity: 12, Mixed: true}}

func benchName(p Plan) string {
	if p.Mixed {
		return "mixed"
	}
	return fmt.Sprintf("cap%d", p.Capacity)
}

// BenchmarkProposeTight times Propose per plan on tightFixture(4), plus the five plans in
// parallel goroutines as Service.Calculate runs them ("generate5").
// With STOLIKI_TUNE_INPUT set it uses that real-shaped file instead (never committed).
func BenchmarkProposeTight(b *testing.B) {
	g := tightFixture(4)
	if p := os.Getenv("STOLIKI_TUNE_INPUT"); p != "" {
		g = loadIDsGraph(b, p)
	}
	for _, plan := range benchPlans {
		b.Run(benchName(plan), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				Propose(g, plan)
			}
		})
	}
	b.Run("generate5", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var wg sync.WaitGroup
			for _, plan := range benchPlans {
				wg.Add(1)
				go func() {
					defer wg.Done()
					Propose(g, plan)
				}()
			}
			wg.Wait()
		}
	})
}
