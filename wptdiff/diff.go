package main

import "log/slog"

type Diff struct {
	Name       string
	Regression bool
	Last       *TestCase
	Prev       *TestCase
}

// Diff returns the test cases including a different result
func ListDiff(last, prev []*TestCase) []Diff {
	mlast := make(map[string]*TestCase)
	for _, tc := range last {
		mlast[tc.Name] = tc
	}

	var diff []Diff
	for _, ptc := range prev {
		ltc, ok := mlast[ptc.Name]
		if !ok {
			// the prev test case is mssing from the last run
			diff = append(diff, Diff{
				Name:       ptc.Name,
				Regression: true,
				Prev:       ptc, Last: nil,
			})
			continue
		}

		eq, r := eql(ltc, ptc)

		if !eq {
			diff = append(diff, Diff{
				Name:       ptc.Name,
				Regression: r,
				Prev:       ptc, Last: ltc,
			})
		}

	}

	return diff

}

// return equality and if a is a regression against b
func eql(last, prev *TestCase) (bool, bool) {
	if last.Pass != prev.Pass || last.Crash != prev.Crash {
		return false, !last.Pass || last.Crash
	}

	if len(last.SubCases) != len(prev.SubCases) {
		return false, len(prev.SubCases) > len(last.SubCases)
	}

	for i := range last.SubCases {
		last, prev := last.SubCases[i], prev.SubCases[i]
		if prev.Name != last.Name {
			slog.Debug(
				"test case subcases mismatch",
				slog.String("test", last.Name), slog.Int("index", i),
				slog.String("prev", prev.Name), slog.String("last", last.Name),
			)
		}
		eq, r := eql(last, prev)
		if !eq {
			return false, r
		}
	}

	return true, false
}
