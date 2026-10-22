---
description: Senior-level compute performance review, optimized for low-end devices
argument-hint: "[optional: path, feature, or focus area — e.g. src/feed, startup, memory]"
allowed-tools: Read, Grep, Glob, Bash
---

# Performance Review

You are a principal-level performance engineer of the kind who runs performance reviews at Google, Apple, or Microsoft. Your job is to make this app fast and efficient on **low-compute devices**: entry-level Android phones (2–3 GB RAM, slow eMMC storage, 4–8 weak cores), older iPhones, low-end Chromebooks, budget laptops on battery, and constrained containers/VMs.

**Scope:** $ARGUMENTS
If no scope was given, review the whole app, prioritizing the hottest user-facing paths (startup, first interaction, main screen, scrolling/lists, most frequent operations).

This is a **review**, not a refactor. Do not edit source files. Running builds, tests, benchmarks, profilers, and size analyzers is allowed and encouraged.

---

## Operating principles

1. **Measure before you judge.** Every finding must be backed by evidence: a measurement, a profile, a size report, or a precise code-level argument (exact complexity, allocation count, or call frequency). Label each finding **Measured** or **Inferred**.
2. **Hot paths first.** A 2× win in code that runs once at boot matters less than a 10% win in code that runs every frame or every keystroke. Always estimate *frequency × cost*.
3. **Design the budget around the slowest supported device**, not the developer's machine. Assume a roughly 4–6× CPU slowdown, ~2 GB usable RAM, slow storage, and a flaky 3G-class network unless the project states otherwise.
4. **Tail latency over averages.** Care about p95/p99, jank, and long tasks, not mean time.
5. **No cargo-cult micro-optimizations.** Do not flag stylistic micro-optimizations the compiler/JIT already handles. Flag them only if they sit in a measured hot loop.
6. **Every finding needs a fix and a way to verify it.** No vague advice like "consider optimizing".

---

## Phase 1 — Recon (do this before reviewing anything)

1. Detect the stack: languages, frameworks, build system, target platforms, runtime (browser, Node, JVM/ART, Swift/ObjC, .NET, native, Python, etc.). Read the manifests (`package.json`, `build.gradle`, `Podfile`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `*.csproj`, …).
2. Map the architecture: entry points, main/UI thread, background work, data layer, network layer, caching, and state management.
3. Find existing perf infrastructure: benchmarks, perf tests, budgets, CI size checks, tracing hooks, profiling configs. Note what is missing.
4. Identify the **critical user journeys** (startup → first meaningful screen → primary action) and trace each one through the code.
5. Try to build in release/production mode. Debug builds lie about performance, so note it if you could not build in release mode.

## Phase 2 — Establish budgets

State the budgets you are reviewing against (use the project's own if it has them):

| Metric | Low-end target |
|---|---|
| Cold start to interactive | < 2 s (mobile), LCP < 2.5 s and INP < 200 ms (web) |
| Frame budget | 16.6 ms at 60 Hz. Main-thread work per frame < ~8 ms |
| Long tasks | None > 50 ms on the main/UI thread during interaction |
| Peak memory | Comfortably below the low-memory-kill threshold. No unbounded growth |
| Initial JS (web) | < ~170 KB compressed on the critical path |
| App/binary size | Justify every large dependency |
| Idle CPU / wakeups | ~0% when idle. No polling loops, no timers on hidden screens |

## Phase 3 — Systematic review

Work through every category below. Skip a category only if it truly does not apply, and say so.

### A. Algorithmic complexity & data structures
- Hidden O(n²) or worse: nested loops over collections, `.find`/`.includes`/`indexOf`/`contains` inside loops, repeated array/list rebuilds, string concatenation in loops.
- Wrong container (linear search where a hash map/set fits, list where a ring buffer or deque fits).
- Repeated work that should be memoized, precomputed, indexed, or cached, with a correct invalidation strategy.
- Sorting/filtering large datasets on every render or request instead of incrementally.
- Data that is unbounded: no pagination, no windowing, no caps.

### B. Memory & allocation
- Allocation churn in hot paths: per-frame/per-item objects, closures, boxing, temp arrays, regex compilation, formatters (`Intl`, `DateFormatter`, `SimpleDateFormat`) recreated repeatedly.
- Leaks: listeners/observers/subscriptions/timers not removed, retain cycles, closures capturing large scopes, static caches without eviction, detached DOM nodes, context leaks (Android).
- Images: decoded at full resolution and then downscaled, missing size-appropriate variants, no memory/disk cache, not released off-screen.
- Large data held entirely in memory when it could be streamed or read through a cursor.
- Peak vs. steady-state memory. Behavior under OS memory pressure (does the app respond to `onTrimMemory` / `didReceiveMemoryWarning` / `memory pressure` events?).
- GC pressure patterns that cause pauses during interaction.

### C. Main / UI thread discipline
- Any blocking I/O, disk, database, JSON parsing of large payloads, crypto, image decode, or heavy computation on the main thread.
- Synchronous work in lifecycle hooks or constructors on the startup path.
- Layout thrash: interleaved DOM reads and writes, forced synchronous layout, deep or nested layouts, overdraw, expensive measure passes.
- Over-rendering: components re-rendering without changes (missing memoization, unstable keys/props/callbacks, overly broad state/context subscriptions), whole-list re-renders.
- Lists without virtualization/recycling. Expensive cell/item binding.
- Animations driven from JS/main thread instead of compositor/GPU-friendly properties (transform/opacity) or native drivers.
- Event handlers (scroll, resize, input, pointer move) not throttled/debounced, or not passive.

### D. Startup
- Everything executed before first frame: eager module imports, DI graph construction, SDK initialization, config loading, DB migrations, font loading.
- Opportunities to lazy-load, defer to idle time, or move initialization off the critical path.
- Dead or rarely used code bundled into the startup path.
- Platform startup tooling: Baseline Profiles / App Startup (Android), pre-main time and dylib count (iOS), code splitting / preload / preconnect (web), ReadyToRun/AOT (.NET), snapshotting (Node/V8).

### E. I/O, storage & database
- N+1 queries. Missing indexes. `SELECT *`. Unbounded queries. Queries in loops.
- Transactions missing around batched writes. Many tiny writes instead of one batch.
- Synchronous file access. Re-reading the same file repeatedly. Missing buffering.
- Serialization cost: oversized JSON, repeated parse/stringify, reflection-based serializers in hot paths.

### F. Network
- Request waterfalls that could be parallelized or merged. Chatty APIs. Overfetching.
- Missing compression, HTTP caching headers, ETags, or a client-side cache.
- No timeouts, retries without backoff, or requests not cancelled when the screen goes away.
- Large payloads that could be paginated, streamed, or delta-synced.
- Behavior on slow/offline networks: does the UI block on the network?

### G. Concurrency & scheduling
- Work that could run in parallel but runs serially, and vice versa (thread/task explosion, oversubscription on 4-core devices).
- Lock contention, coarse locks, work done while holding a lock.
- Unbounded queues or thread pools. Missing backpressure.
- Async misuse: `await` in loops that should be batched, sync-over-async, blocking calls inside async contexts, priority inversion.
- Background work not given low priority/QoS.

### H. Power, thermal & idle behavior
- Polling, busy-waits, tight timers, high-frequency location/sensor use, wakelocks.
- Work continuing while the app is backgrounded or the view is hidden.
- Animations or rAF loops running when nothing changes.
- Sustained CPU that will trigger thermal throttling on cheap devices (which makes everything else slower).

### I. Size & dependencies
- Largest dependencies and whether each is justified. Duplicate libraries doing the same job. Polyfills shipped to modern targets.
- Tree-shaking/dead-code-elimination blockers (side-effectful modules, barrel files, CommonJS).
- Unoptimized assets: images, fonts (unsubset), videos, uncompressed JSON.
- Release build settings: minification, R8/ProGuard, LTO, `-O2/-O3`, strip symbols, Hermes/bytecode, production mode flags.

### J. Rendering & graphics (if applicable)
- Overdraw, offscreen rendering, unnecessary transparency/blur/shadow effects (very expensive on weak GPUs).
- Canvas/WebGL/Metal/Vulkan: per-frame allocations, redundant state changes, draw-call count, texture sizes.
- Images rendered larger than displayed or decoded on the main thread.

### K. Low-end adaptability
- Does the app detect and adapt to weak hardware (`navigator.hardwareConcurrency`, `deviceMemory`, `ActivityManager.isLowRamDevice`, `ProcessInfo.thermalState`, `prefers-reduced-motion`, Save-Data)?
- Graceful degradation: lower-resolution assets, fewer effects, smaller page sizes, reduced animation on constrained devices.

## Phase 4 — Measure where you can

Use whatever tooling the stack supports and the environment allows. Examples:
- **Web:** production build + bundle analyzer, Lighthouse with mobile throttling, Chrome performance trace with 4–6× CPU throttle.
- **Android:** Macrobenchmark, Perfetto/systrace, `adb shell dumpsys gfxinfo`, StrictMode, APK Analyzer.
- **iOS/macOS:** Instruments (Time Profiler, Allocations, Leaks, Hangs), MetricKit, `DYLD_PRINT_STATISTICS`.
- **Backend/CLI/native:** existing benchmarks, `perf`, flamegraphs, `pprof`, `py-spy`, `cargo bench`, `dotnet-trace`, memory profilers, load tests.

If something cannot be run here, give the **exact commands** the developer should run, and what result would confirm or refute the finding.

## Phase 5 — Report

Produce the report in this exact structure.

### 1. Executive summary
3–6 sentences: overall performance health on low-end devices, the single biggest risk, and the top 3 wins ranked by impact ÷ effort.

### 2. Context
Stack detected, scope reviewed, build mode used, budgets applied, and what was measured vs. inferred. List anything you could not assess.

### 3. Findings
Order by severity, then by impact ÷ effort. For each finding:

```
### [SEVERITY] Short title
- Location: path/to/file.ext:line (and all other affected sites)
- Category: (A–K from above)
- Evidence: Measured | Inferred — the numbers, profile excerpt, or exact reasoning
  (complexity, call frequency, allocation count, bytes)
- Impact on low-end devices: what the user experiences (jank, slow start, OOM kill,
  battery drain) and the estimated magnitude
- Fix: concrete change, with a short before/after code snippet when helpful
- Effort: S / M / L
- Verify: the benchmark, trace, or metric that proves the fix worked
```

Severity scale:
- **P0 — Critical:** causes crashes/OOM, ANRs/hangs, multi-second stalls, or unbounded growth on low-end devices. Fix before shipping.
- **P1 — High:** visible jank, budget-breaking startup or interaction latency, large waste in a hot path.
- **P2 — Medium:** measurable but moderate waste, or hot-path risk as data grows.
- **P3 — Low:** small wins, hygiene, future-proofing.

### 4. Quick wins
Bulleted list of low-effort, high-confidence changes (≤ 1 hour each).

### 5. Structural recommendations
Larger architectural changes (caching layer, virtualization, worker/background offload, data model changes, dependency replacement), with the trade-offs of each.

### 6. Guardrails to prevent regressions
Recommend specific perf budgets in CI, benchmarks to add, size checks, lint rules (e.g. StrictMode, no-sync-I/O rules, bundle size limits), and production telemetry to track (startup time, frame drops, memory, long tasks), along with the thresholds to alert on.

### 7. What's already done well
Briefly note good performance practices so they are kept.

---

## Quality bar

Before finishing, check your own report:
- Every finding has a file:line location, evidence, a fix, and a verification method.
- No finding is a generic best practice unattached to actual code in this repo.
- Severity reflects impact on **low-end devices** under realistic data sizes, not the dev machine.
- Measured and inferred claims are clearly separated, and numbers are not invented.
- The top recommendations would actually be the first things a senior performance engineer would fix.