# ◉ AgentLens

**A flight recorder and time-travel debugger for AI agent runs.** Drop in a trace and scrub through the session like a video — every thought, tool call, and token, with the cost and latency of each step.

AI agents keep a diary of everything they do: text streaming out token by token, tool calls and their results, retries, errors, token usage. Today that diary is a wall of JSONL in a terminal. AgentLens turns it into something you can *watch*.

> **100% client-side.** Your trace is parsed in a Web Worker inside your own browser and never leaves your machine. No account, no upload, no API key.

## Features

- **Transcript** — the full run as a readable conversation: assistant text, collapsible thinking, and a card for every tool call with its input and result. Virtualized, so huge traces scroll smoothly.
- **Time travel** — drag the scrubber (or press play) and the whole UI reconstructs the exact state of the run at that moment: messages grow token by token, tool calls flip from *running…* to *ok*/*failed*, the transcript follows along.
- **Timeline** — the run laid out against real time in lanes (user / reply / thinking / tools / errors). Click a span to inspect it; click empty space to jump there.
- **Waterfall** — tool calls ranked by latency, so the step that ate the run's time is the first thing you see.
- **Inspector** — timings, token/cost totals, pretty-printed tool inputs, and full results for any step.
- Keyboard: `←`/`→` to step, `space` to play/pause.

## Try it

```bash
pnpm install
pnpm sample   # generates public/samples/bugfix-session.jsonl
pnpm dev      # open http://localhost:5173 and click "Load the sample trace"
```

Or drop any `.jsonl` trace in the AgentLens format (below) onto the page.

The bundled sample is a realistic session of a coding agent chasing a floating-point rounding bug — reads, greps, edits, a failing test run, an API error with retry, and a green finish. Generate a stress-test trace with `node scripts/generate-sample.mjs --repeat 250 --out public/samples/big.jsonl` (~103k events, ~7 MB).

## Trace format (v0)

One JSON event per line (JSONL), chronological, timestamps in epoch milliseconds. The schema mirrors a streamed Claude API agent session flattened into events:

| event | fields | meaning |
| --- | --- | --- |
| `trace_meta` | `agent?`, `model?`, `title?` | optional header |
| `user_message` | `text` | a user turn |
| `message_start` | `model?` | assistant turn begins |
| `text_delta` / `thinking_delta` | `text` | streamed output / reasoning |
| `tool_use_start` | `id`, `name` | tool call begins |
| `tool_input_delta` | `id`, `partial_json` | streamed tool arguments |
| `tool_use_stop` | `id` | arguments complete |
| `tool_result` | `id`, `ok`, `content`, `duration_ms?` | tool finished |
| `message_stop` | `usage?`, `cost_usd?`, `stop_reason?` | assistant turn ends |
| `error` / `retry` | `message` / `attempt`, `reason?` | failures and recovery |

Every event also carries `type` and `ts`. Malformed lines are counted and skipped, never fatal.

## How it works

- The file is streamed and parsed **in a Web Worker** (`src/parse/worker.ts`), so the main thread never blocks — a progress counter ticks while big files load.
- One pass (`src/parse/normalize.ts`) folds events into transcript items that carry **breakpoints**: `[eventIndex, textLength]` pairs. The state at any scrub position is then a binary search, not a replay — which is why dragging the slider is instant.
- The transcript uses a tiny home-grown **virtualized list** (`src/components/VirtualList.tsx`): estimated row heights corrected by measurement, prefix-sum offsets, binary-searched visible range. Zero runtime dependencies beyond React.
- The timeline is drawn on a **canvas** with devicePixelRatio scaling, and items are coalesced into per-pixel coverage runs before drawing — so paint cost stays flat no matter how many spans the trace has.

Measured on the 103,217-event / 7.2 MB stress trace (Apple Silicon MacBook, Chrome): parse completes in ~2s off the main thread; moving the scrubber costs **5 ms median, 9 ms p95** per state update — comfortably inside a 60 fps frame budget.

## Roadmap

- [ ] Scroll-while-parsing: render the transcript incrementally during load
- [ ] `npx agentlens trace.jsonl` — local viewer CLI
- [ ] Recorder shim: wrap the Anthropic SDK and capture traces from any Node agent
- [ ] OpenTelemetry GenAI span ingestion
- [ ] Embeddable `<AgentLens />` React component on npm

## License

[MIT](LICENSE) — Kajol Tandurkar
