package main

import (
	"strings"
)

type Completion struct {
	Name  string
	Pass  int
	Total int
}

func ListCompletion(tests []*TestCase) []*Completion {
	var (
		completions []*Completion
		m           = make(map[string]*Completion)
	)

	for _, tc := range tests {
		// get the level fom name
		name, _, _ := strings.Cut(tc.Name[1:], "/")

		c, ok := m[name]
		if !ok {
			c = &Completion{Name: name}
			m[name] = c
			completions = append(completions, c)
		}

		if ln := len(tc.SubCases); ln > 0 {
			c.Total += ln
			for _, s := range tc.SubCases {
				if s.Pass {
					c.Pass += 1
				}
			}
		} else {
			// no subcases
			c.Total += 1
		}
	}

	return completions
}
