package tasks

import "context"

// ChunkSender is a per-task closure that ships incremental output back to
// the server. It is propagated to runners via context.
//
// The agent's executeTask wraps the runner invocation with a real sender
// bound to the current task ID + a seq counter. Runners that exec external
// tools (mtr/traceroute/hping3) automatically stream stdout when present.
type ChunkSender func(stream, text string)

type chunkSenderKey struct{}

// WithChunkSender returns a derived context carrying the given sender.
func WithChunkSender(ctx context.Context, s ChunkSender) context.Context {
	if s == nil {
		return ctx
	}
	return context.WithValue(ctx, chunkSenderKey{}, s)
}

// SenderFromCtx returns the ChunkSender stored in ctx, or nil.
func SenderFromCtx(ctx context.Context) ChunkSender {
	s, _ := ctx.Value(chunkSenderKey{}).(ChunkSender)
	return s
}
