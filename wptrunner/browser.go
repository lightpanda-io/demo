package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"os/exec"
	"sync"
	"time"
)

type Browser interface {
	Start(context.Context) error
	Stop()
	Ready() <-chan string
}

type NoopBrowser struct {
	CDP string
}

func (b NoopBrowser) Start(_ context.Context) error {
	return nil
}
func (b NoopBrowser) Stop() {}
func (b NoopBrowser) Ready() <-chan string {
	ch := make(chan string, 1)
	ch <- b.CDP
	return ch
}

type ProcessBrowser struct {
	sync.Mutex

	Cmd BrowserCmd

	ready   chan struct{}
	running bool
	done    chan struct{}
	cancel  context.CancelFunc
}

func (b *ProcessBrowser) Stop() {
	b.Lock()
	defer b.Unlock()

	b.cancel()
	<-b.done
}

var ErrBrowserIsRunning = errors.New("browser is running")

func (b *ProcessBrowser) CDP() string {
	return b.Cmd.CDP()
}

// non blocking
func (b *ProcessBrowser) Start(ctx context.Context) error {
	b.Lock()
	defer b.Unlock()

	if b.running {
		return ErrBrowserIsRunning
	}

	cmd, err := b.Cmd.Command(ctx)
	if err != nil {
		return fmt.Errorf("browser command: %w", err)
	}

	// We keep a reference to the original context to restart the browser with
	// it.
	restartctx := ctx
	ctx, cancel := context.WithCancel(ctx)
	b.cancel = cancel

	slog.Info("starting browser", slog.String("cmd", cmd.String()))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start command: %w", err)
	}

	ready := make(chan struct{})
	done := make(chan struct{})

	b.ready = ready
	b.done = done

	go func() {
		defer close(done)
		defer cancel()

		// Wait for readyness
		time.Sleep(time.Second * 1)
		close(ready)

		// block until the end
		if err := cmd.Wait(); err != nil {
			slog.Debug("browser stop", slog.Any("err", err))
		}

		if ctx.Err() != nil {
			return
		}

		// reset state
		b.Lock()
		b.ready = make(chan struct{})
		b.running = false
		b.Unlock()

		// autorestart
		if err := b.Start(restartctx); err != nil {
			slog.Error("browser restart", slog.Any("err", err))
			return
		}
	}()

	return nil
}

// blocks until done
func (b *ProcessBrowser) Ready() <-chan string {
	b.Lock()
	defer b.Unlock()

	ready := b.ready

	r := make(chan string)
	go func() {
		<-ready
		r <- b.CDP()
		close(r)
	}()

	return r
}

type PoolBrowser struct {
	procs  []*ProcessBrowser
	cancel context.CancelFunc
}

func NewPoolBrowser(cmd BrowserCmd, n uint) *PoolBrowser {
	procs := make([]*ProcessBrowser, n)
	for i := range n {
		cmd := cmd.Copy(int(9222 + i))
		procs[i] = &ProcessBrowser{Cmd: cmd}
	}

	return &PoolBrowser{
		procs: procs,
	}
}

func (b *PoolBrowser) Stop() {
	b.cancel()
	for _, p := range b.procs {
		p.Stop()
	}
}

// non blocking
func (b *PoolBrowser) Start(ctx context.Context) error {
	ctx, b.cancel = context.WithCancel(ctx)
	for i, p := range b.procs {
		if err := p.Start(ctx); err != nil {
			b.cancel()
			return fmt.Errorf("start %d: %w", i, err)
		}
	}

	return nil
}

func (b *PoolBrowser) Ready() <-chan string {
	i := rand.Intn(len(b.procs))
	bb := b.procs[i]
	return bb.Ready()
}

type BrowserCmd interface {
	Command(ctx context.Context) (*exec.Cmd, error)
	CDP() string
	Copy(port int) BrowserCmd
}
