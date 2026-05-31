# Block Editor — Offline-Resilient Collaborative Reordering

## Quick Start

Open [this link](https://offline-resilient-collaborative-blo.vercel.app/) in two tabs.

Or run locally:

```bash
npm install
npm run dev        # open in two tabs at http://localhost:5173
```

---

## Ordering Strategy — Fractional Indexing

Every block carries a position (**pos**): a string built from a base-62 character set (0-9, a-z, A-Z). The visible list is always sorted by this string using standard lexicographic comparison.

**Inserting between two neighbours** calculates the midpoint character between the two bounding position strings. If no gap exists at the current string index, the algorithm appends a new character to the string (creating a smaller subdivision).

No integer or floating-point positions are stored. Two concurrent moves to different positions produce distinct strings that compare unambiguously. Because strings can grow in length to create new subdivisions, collisions float exhaustion is not a concern.

---

## Operation Format

```ts
type MoveOperation = {
  id: string; // UUID v4 — globally unique, used for deduplication
  actorId: string; // UUID assigned once per tab via sessionStorage
  lamport: number; // Lamport logical clock value at op creation
  blockId: string; // which block moved
  newPos: string; // the fractional position assigned by this tab
};
```

`(actorId, lamport)` together provide a total causal order.
`id` ensures idempotent replay — applying the same op twice has no effect.

---

## Conflict Resolution Rules

**Per-block winner selection** (not last-write-wins for the whole list):

> For a given `blockId`, the op with the **highest Lamport timestamp** wins.
> Tie-break: the op with the **lexicographically higher `actorId`** wins.
> The winning op's `newPos` is applied. Ops on _different_ blocks never
> conflict — both apply independently.

The current block list is always **derived from the full oplog**, meaning adding new ops never requires complicated rollbacks—we simply evaluate the highest priority operation for each block ID.

---

## Conflict Scenario Timelines

### Scenario 1 — Both tabs move the same block concurrently

```
Tab A (id "aaa")           |  Tab B (id "bbb")
───────────────────────────|───────────────────────────────
L=1 move block-2 → pos 'm' |  L=1 move block-2 → pos 'k'
[reconnect / syncReq]
```

Both tabs receive both operations. Tie-break: `"bbb" > "aaa"` → Op B wins → position `'k'` is applied identically on both tabs.

### Scenario 2 — Offline tab accumulates moves while online tab also moves

```
Tab A (online)              |  Tab B (offline)
────────────────────────────|──────────────────────────────
L=1 move block-3 → pos 'r'  |  L=1 move block-1 → pos 's' (queued)
                            |  L=2 move block-3 → pos 'h' (queued)
[Tab B reconnects, broadcasts offline ops + syncReq]
```

- block-1: Only Tab B touched it → pos 's' applied (no conflict).
- block-3: Tab A is at L=1, Tab B is at L=2 → Tab B wins (higher lamport) → pos 'h' applied.

Result is identical on both tabs.

---

## Offline Catch-Up Behaviour

1. **Go Offline** — Operations are routed to the offlineOps store in IndexedDB.
2. **Reorder blocks** — Optimistic local UI updates instantly; nothing is broadcasted.
3. **Refresh the tab** — sessionStorage preserves the clientId. On boot, replayOperations() pulls from both remoteOps and offlineOps, allowing the user to seamlessly see their un-synced offline state.
4. **Go Online** —
   - Iterates through offlineOps, moves them to remoteOps, and broadcasts them individually (type: "op").
   - Broadcasts a syncReq message to request any missed state.
   - Remote tabs reply with syncRes containing their remoteOps, bringing this tab fully up to date.

---

## Known Limitations / Trade-offs

| Concern                  | Current behaviour                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| String length growth     | Continuously moving blocks between the same neighbours without a gap will cause the position strings to grow indefinitely in length. A production app would need a periodic re-indexing/re-balancing job.                  |
| Broadcast storms         | Emitting a syncReq forces every connected tab to respond with a syncRes payload. If multiple tabs are open, they will all reply with the full history. This could be mitigated using debouncing or simple leader-election. |
| Oplog growth             | The operation log is never compacted. A snapshot + truncation strategy would be needed for long-lived collaborative sessions.                                                                                              |
| Winner rule is per-block | Both concurrent orderings are "valid"; the winner rule picks one consistently but may not match either tab's full intent.                                                                                                  |
| Unbatched offline sync   | Reconnecting sends offline ops one by one via BroadcastChannel. Batching these into a single message would be more performant.                                                                                             |
