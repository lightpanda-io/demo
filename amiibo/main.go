package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
)

const (
	exitOK   = 0
	exitFail = 1
)

// main starts interruptable context and runs the program.
func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := run(ctx, os.Args, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitFail)
	}

	os.Exit(exitOK)
}

func run(ctx context.Context, args []string, _, stderr io.Writer) error {
	// declare runtime flag parameters.
	flags := flag.NewFlagSet(args[0], flag.ExitOnError)
	flags.SetOutput(stderr)

	var (
		verbose = flags.Bool("verbose", false, "enable debug log level")
		outdir  = flags.String("outdir", os.TempDir(), "output dir")
	)

	// usage func declaration.
	exec := args[0]
	flags.Usage = func() {
		fmt.Fprintf(stderr, "usage: %s\n", exec)
		fmt.Fprintf(stderr, "amiibo generates an example website from Amiibo public API")
		fmt.Fprintf(stderr, "\nCommand line options:\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	if *verbose {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}

	list, err := fetch(ctx)
	if err != nil {
		return fmt.Errorf("fetch API: %w", err)
	}

	if err := generate(ctx, list, *outdir); err != nil {
		return fmt.Errorf("generate: %w", err)
	}

	return nil
}

const endpoint = "https://www.amiiboapi.com/api/amiibo/"

type Serie string
type Game string

type Amiibo struct {
	Serie     Serie  `json:"amiiboSeries"`
	Character string `json:"character"`
	Name      string `json:"name"`
	Game      Game   `json:"gameSeries"`
	Image     string `json:"image"`
	Id        string `json:"tail"`
}

func fetch(ctx context.Context) ([]Amiibo, error) {
	var cli http.Client

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("new req: %w", err)
	}

	resp, err := cli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do req: %w", err)
	}
	defer resp.Body.Close()

	var res struct {
		List []Amiibo `json:"amiibo"`
	}

	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&res); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	return res.List, nil
}

const tpl = `
<!DOCTYPE html>
<html>
	<head>
		<meta charset="UTF-8">
		<script>
(async function () {
try {
  const url = '{{ .JSON }}';
  const response = await fetch(url);
  if (!response.ok) {
	throw new Error("Response status: ${response.status}");
  }
  update(await response.json());
} catch (error) {
  console.error(error.message);
}
}());

function update(data) {
  document.getElementById('title').textContent = data.amiibo.name;
  document.getElementById('name').textContent = data.amiibo.name;
  document.getElementById('game').textContent = data.amiibo.amiiboSeries;
  document.getElementById('serie').textContent = data.amiibo.gameSeries;
  document.getElementById('image').setAttribute('src', data.amiibo.image);

  const nav = document.getElementById('nav');

  const prev = document.createElement("a");
  prev.setAttribute('href', data.prev);
  prev.textContent = "Previous";
  nav.appendChild(prev);

  nav.appendChild(document.createTextNode(" | "));

  const next = document.createElement("a");
  next.setAttribute('href', data.next);
  next.textContent = "Next";
  nav.appendChild(next);

  const alt = document.getElementById('alt');
  data.list.forEach(str => {
  	const a = document.createElement("a");
	a.setAttribute('href', str + '.html');
	a.textContent = str;
  	const li = document.createElement("li");
	li.append(a);
	alt.append(li);
  });
}
		</script>
		<title id="title">Amiibo Character</title>
	</head>
	<body>
		<h1 id="name">Amiibo Character</h1>
		<p>
			<img alt="Amiibo Character Image" id="image" src="" />
			<br>
			Game <span id="game">Amiibo Game</span>
			<br>
			Serie <span id="serie">Amiibo Serie</span>
		</p>
		<h2>See also</h2>
		<ul id="alt"></ul>
		<p id="nav"></p>
	</body>
</html>`

func generate(_ context.Context, list []Amiibo, outdir string) error {
	t, err := template.New("amiibo").Parse(tpl)
	if err != nil {
		return fmt.Errorf("parse template: %w", err)
	}

	for i, v := range list {
		ln := len(list)

		var prev string
		switch i {
		case 0:
			prev = list[ln-1].Id + ".html"
		case 1:
			prev = "index.html"
		default:
			prev = list[i-1].Id + ".html"
		}

		var next string
		if i == ln-1 {
			next = "index.html"
		} else {
			next = list[i+1].Id + ".html"
		}

		// generate a random list of 5 items
		randlist := make([]string, 10)
		for i := range randlist {
			r := rand.Intn(ln)
			if r == 0 {
				randlist[i] = "index"
			}
			randlist[i] = list[r].Id
		}

		data := struct {
			Amiibo Amiibo   `json:"amiibo"`
			Next   string   `json:"next"`
			Prev   string   `json:"prev"`
			List   []string `json:"list"`
		}{
			Amiibo: v,
			Next:   next,
			Prev:   prev,
			List:   randlist,
		}

		name := v.Id + ".html"
		if i == 0 {
			name = "index.html"
		}

		slog.Info("generate", slog.String("file", name))

		fjson, err := os.Create(filepath.Join(outdir, v.Id+".json"))
		if err != nil {
			return fmt.Errorf("create file: %w", err)
		}
		enc := json.NewEncoder(fjson)
		enc.SetIndent("", "\t")
		err = enc.Encode(data)
		fjson.Close()
		if err != nil {
			return fmt.Errorf("create json file: %w", err)
		}

		fhtml, err := os.Create(filepath.Join(outdir, name))
		if err != nil {
			return fmt.Errorf("create html file: %w", err)
		}

		err = t.Execute(fhtml, struct{ JSON string }{JSON: v.Id + ".json"})
		fhtml.Close()
		if err != nil {
			return fmt.Errorf("execute template: %w", err)
		}
	}

	return nil
}
