# Benchmark

## Methodology

We all love benchmarks but we know it's difficult to do fair comparisons.
That's why it's important to be very transparent about the protocol of the benchmark.

The benchmark uses a [homemade demo web page](https://github.com/lightpanda-io/demo).
This web page is a fake e-commerce product offer page loading product details
and reviews in JSON with two XHR requests.

We decided to use a homemade page because Lightpanda browser is not yet fully
compliant and we wanted to be sure it would be able to execute the web page
correctly to be comparable with Google Chrome.

Moreover, using this web page allows us to run the test with a local web server,
reducing network request impacts to the bench.

### Metrics and tools

We measure two metrics:
* time of execution with the help of [Hyperfine](https://github.com/sharkdp/hyperfine)
* peaked memory usage with the help of [GNU time](https://www.gnu.org/software/time/)

## Preparation

### Dependencies

To run the benchmark, you have to install
[Hyperfine](https://github.com/sharkdp/hyperfine) and [GNU
time](https://www.gnu.org/software/time/) tools.

We also expose the demo web page locally using a simple Go program, but you
can use another web server if you want to.

On Debian Linux, you can use:
```console
$ apt install time hyperfine
```

You have also to install [Google Chrome](https://www.google.com/chrome/) and
[Lightpanda browser](https://github.com/lightpanda-io/browser/releases/tag/nightly).

### Demo web page

Clone the [demo web page](https://github.com/lightpanda-io/demo) and expose the
`public/` directory locally with a web server.

We use the simple Go program to expose the files in `ws/` dir.
By default it exposes the `public` dir using the `1234` port.

```console
$ go run ws/main.go
```

### Test machine

The tests are run in an AWS m5.large (x86_64) with a fresh Debian install.

![aws.m5 neofetch](./img/aws_m5_neofetch.png)

## Single request

This bench is a very basic test to compare the two software.
We start the browser and request the fake web page once with full JS execution. The final DOMTree is
rendered in stdout.

We use Google Chrome version 130.0.6723.58.

```console
$ google-chrome --version
Google Chrome 130.0.6723.58
```

And Lightpanda commit [b846541ff69082f4d283155f0b3651ae0394a240](https://github.com/lightpanda-io/browser/commit/b846541ff69082f4d283155f0b3651ae0394a240).

### Execution time

```console
$ hyperfine --warmup 3 --runs 20 --shell=none "google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/" "./lightpanda --dump http://127.0.0.1:1234/campfire-commerce/"
Benchmark 1: google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/
  Time (mean ± σ):     598.7 ms ±   8.6 ms    [User: 348.0 ms, System: 165.1 ms]
  Range (min … max):   586.3 ms … 611.9 ms    20 runs

Benchmark 2: ./lightpanda --dump http://127.0.0.1:1234/campfire-commerce/
  Time (mean ± σ):      19.6 ms ±   0.1 ms    [User: 6.7 ms, System: 4.1 ms]
  Range (min … max):    19.4 ms …  19.9 ms    20 runs

Summary
  './lightpanda --dump http://127.0.0.1:1234/campfire-commerce/' ran
   30.50 ± 0.49 times faster than 'google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/'
```

![aws.m5 hyperfine](./img/aws_m5_hyperfine.png)

### Memory peak

```console
$ /usr/bin/time -v google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:1234/campfire-commerce/
        Command being timed: "google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:1234/campfire-commerce/"
        User time (seconds): 0.34
        System time (seconds): 0.19
        Percent of CPU this job got: 94%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:00.57
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 174096
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 17
        Minor (reclaiming a frame) page faults: 20609
        Voluntary context switches: 2563
        Involuntary context switches: 1618
        Swaps: 0
        File system inputs: 1048
        File system outputs: 4576
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status: 0

```

```console
$ /usr/bin/time -v ./lightpanda --dump http://127.0.0.1:1234/campfire-commerce/
        Command being timed: "./lightpanda --dump http://127.0.0.1:1234/campfire-commerce/"
        User time (seconds): 0.00
        System time (seconds): 0.00
        Percent of CPU this job got: 92%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:00.01
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 21276
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 0
        Minor (reclaiming a frame) page faults: 925
        Voluntary context switches: 6
        Involuntary context switches: 11
        Swaps: 0
        File system inputs: 0
        File system outputs: 0
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status: 0
```

## Multiple requests using Puppeteer

We compare now multiple page loads and js evaluations using
[Puppeteer](https://https://pptr.dev/), which connects to the browser using CDP
(Chrome Debug Protocol).

### Dependencies

To run the benchmark, you need ti install [nodejs](https://nodejs.org/en/download).

Once `nodejs` is installed, please run a `npm install` to install nodejs
dependencies, mainly Puppeteer.

You have also to install [Google Chrome](https://www.google.com/chrome/) and
Lightpanda browser, but the code is not publicly available yet.

### Running the benchmark

The `puppeteer/cdp.js` benchmark accepts multiple env vars to be configured.
* `BROWSER_ADDRESS` is the address of the running browser listening the CDP protocol, by default `ws://127.0.0.1:9222`.
* `BASE_URL` is the base url of the running web reser to request, by default `http://127.0.0.1:1234`.
* `RUNS` is the number of pages loaded by the benchmark, default is `100`.

`npm run bench-puppeteer-cdp` starts a Puppeteer process
instance and load the page to extract data 100 times.

```console
$ npm run bench-puppeteer-cdp
```

### Results

**Google Chrome**

We use Google Chrome version 130.0.6723.58.

You have to start the browser first.
```console
$ /usr/bin/time -v google-chrome --headless=new --remote-debugging-port=9222
```

Then you can run the benchmark.
```console
$ BROWSER_ADDRESS=http://127.0.0.1:9222 npm run bench-puppeteer-cdp

> demo@1.0.0 bench-puppeteer-cdp
> node puppeteer/cdp.js

................................................................................
....................
total runs 100
total duration (ms) 25218
avg run duration (ms) 248
min run duration (ms) 216
max run duration (ms) 451
```

![aws.m5 Puppeteer with Google Chrome](./img/aws_m5_puppeteer_chrome.png)

```console
        Command being timed: "google-chrome --headless=new --remote-debugging-port=9222"
        User time (seconds): 16.19
        System time (seconds): 6.59
        Percent of CPU this job got: 41%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:54.51
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 207828
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 138
        Minor (reclaiming a frame) page faults: 265165
        Voluntary context switches: 143625
        Involuntary context switches: 82912
        Swaps: 0
        File system inputs: 35680
        File system outputs: 169688
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status: 0
```

**Lightpanda browser**

We use Lightpanda commit [b846541ff69082f4d283155f0b3651ae0394a240](https://github.com/lightpanda-io/browser/commit/b846541ff69082f4d283155f0b3651ae0394a240).

You have to start Lightpanda browser.
```console
/usr/bin/time -v ./lightpanda
```

Then you can run the benchmark.
```console
$ npm run bench-puppeteer-cdp

> demo@1.0.0 bench-puppeteer-cdp
> node puppeteer/cdp.js

.
................................................................................
...................
total runs 100
total duration (ms) 2277
avg run duration (ms) 22
min run duration (ms) 18
max run duration (ms) 40
```

![aws.m5 Puppeteer with Lightpanda browser](./img/aws_m5_puppeteer_lightpanda.png)

```console
        Command being timed: "./lightpanda"
        User time (seconds): 1.05
        System time (seconds): 0.55
        Percent of CPU this job got: 17%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:09.25
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 23456
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 0
        Minor (reclaiming a frame) page faults: 62976
        Voluntary context switches: 8189
        Involuntary context switches: 2804
        Swaps: 0
        File system inputs: 0
        File system outputs: 0
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status: 0
```

---

Console images generated with [Carbon](https://carbon.now.sh).
