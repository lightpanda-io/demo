// Copyright 2023-2025 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
package main

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"image/color"

	"gonum.org/v1/plot"
	"gonum.org/v1/plot/plotter"
	"gonum.org/v1/plot/vg"
)

func parseSize(sizeStr string) float64 {
	if sizeStr == "" || sizeStr == "0" {
		return 0
	}

	re := regexp.MustCompile(`([\d.]+)([MG])`)
	matches := re.FindStringSubmatch(sizeStr)
	if len(matches) != 3 {
		return 0
	}

	value, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0
	}

	unit := matches[2]
	if unit == "G" {
		value *= 1024
	}

	return value
}

func parseCPU(cpuStr string) float64 {
	re := regexp.MustCompile(`([\d.]+)%`)
	matches := re.FindStringSubmatch(cpuStr)
	if len(matches) != 2 {
		return 0
	}

	value, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0
	}

	return value
}

type FileData struct {
	Name       string
	MemoryData plotter.XYs
	CPUData    plotter.XYs
}

func parseFile(filename string) (*FileData, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	memoryData := make(plotter.XYs, 0)
	cpuData := make(plotter.XYs, 0)
	timeIndex := 0

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.Contains(line, "\t") {
			continue
		}

		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}

		// Parse memory
		memStr := parts[0]
		if strings.Contains(memStr, "→") {
			memParts := strings.Split(memStr, "→")
			if len(memParts) == 2 {
				memStr = strings.TrimSpace(memParts[1])
			}
		}
		memVal := parseSize(memStr)

		// Parse CPU
		cpuStr := strings.TrimSpace(parts[1])
		cpuVal := parseCPU(cpuStr)

		// Add to data
		memoryData = append(memoryData, plotter.XY{X: float64(timeIndex), Y: memVal})
		cpuData = append(cpuData, plotter.XY{X: float64(timeIndex), Y: cpuVal})
		timeIndex++
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return &FileData{
		Name:       filename,
		MemoryData: memoryData,
		CPUData:    cpuData,
	}, nil
}

var colors = []color.RGBA{
	{R: 31, G: 119, B: 180, A: 255},  // Blue
	{R: 255, G: 127, B: 14, A: 255},  // Orange
	{R: 44, G: 160, B: 44, A: 255},   // Green
	{R: 214, G: 39, B: 40, A: 255},   // Red
	{R: 148, G: 103, B: 189, A: 255}, // Purple
	{R: 140, G: 86, B: 75, A: 255},   // Brown
	{R: 227, G: 119, B: 194, A: 255}, // Pink
	{R: 127, G: 127, B: 127, A: 255}, // Gray
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <file1> [file2] [file3] ...\n", os.Args[0])
		os.Exit(1)
	}

	filenames := os.Args[1:]
	filesData := make([]*FileData, 0)

	// Parse all files
	for _, filename := range filenames {
		data, err := parseFile(filename)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error parsing %s: %v\n", filename, err)
			continue
		}
		filesData = append(filesData, data)
		fmt.Printf("Parsed %s: %d samples\n", filename, len(data.MemoryData))
	}

	if len(filesData) == 0 {
		fmt.Fprintf(os.Stderr, "No files parsed successfully\n")
		os.Exit(1)
	}

	// Create memory plot
	pMem := plot.New()
	pMem.Title.Text = "Memory Usage Comparison"
	pMem.X.Label.Text = "Time (samples)"
	pMem.Y.Label.Text = "Memory (MB)"

	// Create CPU plot
	pCPU := plot.New()
	pCPU.Title.Text = "CPU Usage Comparison"
	pCPU.X.Label.Text = "Time (samples)"
	pCPU.Y.Label.Text = "CPU (%)"

	// Add lines for each file
	for i, data := range filesData {
		colorIdx := i % len(colors)

		// Memory line
		memLine, err := plotter.NewLine(data.MemoryData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error creating memory line for %s: %v\n", data.Name, err)
			continue
		}
		memLine.Color = colors[colorIdx]
		memLine.Width = vg.Points(1.5)
		pMem.Add(memLine)
		pMem.Legend.Add(data.Name, memLine)

		// CPU line
		cpuLine, err := plotter.NewLine(data.CPUData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error creating CPU line for %s: %v\n", data.Name, err)
			continue
		}
		cpuLine.Color = colors[colorIdx]
		cpuLine.Width = vg.Points(1.5)
		pCPU.Add(cpuLine)
		pCPU.Legend.Add(data.Name, cpuLine)
	}

	pMem.Legend.Top = true
	pMem.Legend.Left = true
	pCPU.Legend.Top = true
	pCPU.Legend.Left = true

	// Save plots
	if err := pMem.Save(12*vg.Inch, 6*vg.Inch, "memory_comparison.png"); err != nil {
		fmt.Fprintf(os.Stderr, "Error saving memory plot: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Memory chart saved to: memory_comparison.png")

	if err := pCPU.Save(12*vg.Inch, 6*vg.Inch, "cpu_comparison.png"); err != nil {
		fmt.Fprintf(os.Stderr, "Error saving CPU plot: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("CPU chart saved to: cpu_comparison.png")
}
