# Block Editor — Offline-Resilient Collaborative Reordering

## Quick Start

```bash
npm install
npm run dev        # open in two tabs at http://localhost:5173
```

---

## Ordering Strategy — Fractional Indexing

Every block carries a **rank**: a decimal string in the open interval `(0, 1)`
(e.g. `"0.5"`, `"0.25"`, `"0.625"`). The visible list is always sorted by
rank using standard lexicographic string comparison, which agrees with numeric
order for strings produced by our `midpoint()` helper.

**Inserting between two neighbours** computes `(lo + hi) / 2` to 20 decimal
places. Precision grows lazily; for the number of blocks in this exercise
collisions are mathematically impossible.

No integer positions are stored. Two concurrent moves to different positions
produce two distinct rank strings that compare unambiguously.

---

## Operation Format

```ts
interface MoveOp {
  opId: string; // UUID v4 — globally unique, used for deduplication
  clientId: string; // UUID assigned once per tab via sessionStorage
  lamport: number; // Lamport logical clock value at op creation
  blockId: string; // which block moved
  newRank: string; // the fractional rank assigned by this tab
  timestamp: number; // wall-clock ms (display only)
}
```

`(clientId, lamport)` together provide a total causal order.
`opId` ensures idempotent replay — applying the same op twice has no effect.

---

## Conflict Resolution Rules

**Per-block winner selection** (not last-write-wins for the whole list):

> For a given `blockId`, the op with the **highest Lamport timestamp** wins.
> Tie-break: the op with the **lexicographically higher `clientId`** wins.
> The winning op's `newRank` is applied. Ops on _different_ blocks never
> conflict — both apply independently.

The current block list is always **derived from the full oplog**, so adding
new ops never requires reprocessing earlier history from scratch.

---

## Conflict Scenario Timelines

### Scenario 1 — Both tabs move the same block concurrently

```
Tab A (id "aaa")  |  Tab B (id "bbb")
──────────────────|──────────────────────
L=1 move block-b → rank 0.75
                  |  L=1 move block-b → rank 0.25
[reconnect / CATCHUP]
```

Both tabs receive both ops. Tie-break: `"bbb" > "aaa"` → Op B wins → rank
`0.25` applied identically on both tabs.

### Scenario 2 — Offline tab accumulates moves while online tab also moves

```
Tab A (online)     |  Tab B (offline)
───────────────────|───────────────────
L=1 move block-c → 0.8
                   |  L=1 move block-a → 0.9  (queued)
                   |  L=2 move block-c → 0.3  (queued)
[Tab B reconnects, broadcasts CATCHUP]
```

- `block-a`: only Tab B touched it → rank `0.9` (no conflict)
- `block-c`: Tab A at L=1, Tab B at L=2 → Tab B wins (higher lamport) → rank `0.3`

Result is identical on both tabs.

---

## Offline Catch-Up Behaviour

1. **Go Offline** — ops saved to IndexedDB `pending_ops`, scoped by `clientId`.
2. **Reorder blocks** — optimistic local UI; nothing broadcast.
3. **Refresh the tab** — `sessionStorage` preserves `clientId`; pending ops
   are replayed locally on boot so the tab sees its own queued state.
4. **Go Online** — `reconnect()` broadcasts a `CATCHUP` message with all
   pending ops, then clears the local queue and updates `shared_state`.

**Isolation**: pending ops are filtered by `clientId`. One tab's offline work
is never exposed to another tab on reload.

**Bootstrap**: `shared_state` in IndexedDB is updated on every online op.
A newly opened tab reads it immediately, starting from the latest agreed
order rather than hard-coded defaults.

---

## Known Limitations / Trade-offs

| Concern                  | Current behaviour                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Rank exhaustion          | After ~50 moves between the same neighbours, float precision is reached. A real app would periodically rebalance ranks.   |
| Oplog growth             | The log is never compacted. A snapshot + truncation strategy would be needed for long sessions.                           |
| Winner rule is per-block | Both concurrent orderings are "valid"; the winner rule picks one consistently but may not match either tab's full intent. |
| No auth                  | `clientId` is a random UUID. Production would replace it with real user identity.                                         |
