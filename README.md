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

And Lightpanda commit [826f82610e10634aa57a41abc1fba337a5e9c88b](https://github.com/lightpanda-io/browser/commit/826f82610e10634aa57a41abc1fba337a5e9c88b).

### Execution time

```console
$ hyperfine --warmup 3 --runs 20 --shell=none "google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/" "./lightpanda-get --dump http://127.0.0.1:1234/campfire-commerce/"
Benchmark 1: google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/
  Time (mean ± σ):     620.6 ms ±  15.5 ms    [User: 357.2 ms, System: 168.9 ms]
  Range (min … max):   598.0 ms … 647.9 ms    20 runs

Benchmark 2: ./lightpanda-get --dump http://127.0.0.1:1234/campfire-commerce/
  Time (mean ± σ):      10.3 ms ±   0.2 ms    [User: 5.6 ms, System: 4.3 ms]
  Range (min … max):    10.0 ms …  10.7 ms    20 runs

Summary
  './lightpanda-get --dump http://127.0.0.1:1234/campfire-commerce/' ran
   60.14 ± 1.93 times faster than 'google-chrome --user-data-dir=/tmp/bench_chrome --headless=new --dump-dom http://127.0.0.1:124/campfire-commerce/'
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
$ /usr/bin/time -v ./lightpanda-get --dump http://127.0.0.1:1234/campfire-commerce/
        Command being timed: "./lightpanda-get --dump http://127.0.0.1:1234/campfire-commerce/"
        User time (seconds): 0.01
        System time (seconds): 0.00
        Percent of CPU this job got: 81%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:00.01
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 20528
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 0
        Minor (reclaiming a frame) page faults: 924
        Voluntary context switches: 6
        Involuntary context switches: 1006
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
* `BROWSER_ADDRESS` is the address of the running browser listening the CDP protocol, by default `http://127.0.0.1:9222`.
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
npm run bench-puppeteer-cdp

> demo@1.0.0 bench-puppeteer-cdp
> node puppeteer/cdp.js

................................................................................
....................
total runs 100
total duration (ms) 23637
avg run duration (ms) 233
min run duration (ms) 207
max run duration (ms) 298
```

![aws.m5 Playwright with Google Chrome](./img/aws_m5_playwright_chrome.png)

```console
        Command being timed: "google-chrome --headless=new --remote-debugging-port=9222"
        User time (seconds): 16.26
        System time (seconds): 6.49
        Percent of CPU this job got: 74%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:30.61
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 206500
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 8
        Minor (reclaiming a frame) page faults: 255088
        Voluntary context switches: 144548
        Involuntary context switches: 86315
        Swaps: 0
        File system inputs: 0
        File system outputs: 168872
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status: 0
```

**Lightpanda browser**

We use Lightpanda commit [826f82610e10634aa57a41abc1fba337a5e9c88b](https://github.com/lightpanda-io/browser/commit/826f82610e10634aa57a41abc1fba337a5e9c88b).

You have to start the Lightpanda Gateway.
```console
./gateway
```

And Lightpanda browser itself.
```console
/usr/bin/time -v ./lightpanda
```

Then you can run the benchmark.
```console
npm run bench-puppeteer-cdp

> demo@1.0.0 bench-puppeteer-cdp
> node puppeteer/cdp.js

................................................................................
....................
total runs 100
total duration (ms) 20907
avg run duration (ms) 205
min run duration (ms) 191
max run duration (ms) 29
```

```console
        Command being timed: "./lightpanda"
        User time (seconds): 25.39
        System time (seconds): 9.14
        Percent of CPU this job got: 99%
        Elapsed (wall clock) time (h:mm:ss or m:ss): 0:34.67
        Average shared text size (kbytes): 0
        Average unshared data size (kbytes): 0
        Average stack size (kbytes): 0
        Average total size (kbytes): 0
        Maximum resident set size (kbytes): 98100
        Average resident set size (kbytes): 0
        Major (requiring I/O) page faults: 0
        Minor (reclaiming a frame) page faults: 29282
        Voluntary context switches: 293
        Involuntary context switches: 1153
        Swaps: 0
        File system inputs: 0
        File system outputs: 0
        Socket messages sent: 0
        Socket messages received: 0
        Signals delivered: 0
        Page size (bytes): 4096
        Exit status:
```
