import { create } from "zustand";
import { openDB } from "idb";
import { v4 as uuidv4 } from "uuid";

// Types
export type Block = {
  id: string;
  text: string;
  pos: string;
  lastModifiedBy: string;
  lastModifiedLamport: number;
};

export type MoveOperation = {
  id: string;
  actorId: string;
  lamport: number;
  blockId: string;
  newPos: string;
};

// Initial Hardcoded State
const INITIAL_BLOCKS: Block[] = [
  {
    id: "1",
    text: "Block A",
    pos: "j",
    lastModifiedBy: "system",
    lastModifiedLamport: 0,
  },
  {
    id: "2",
    text: "Block B",
    pos: "l",
    lastModifiedBy: "system",
    lastModifiedLamport: 0,
  },
  {
    id: "3",
    text: "Block C",
    pos: "n",
    lastModifiedBy: "system",
    lastModifiedLamport: 0,
  },
  {
    id: "4",
    text: "Block D",
    pos: "p",
    lastModifiedBy: "system",
    lastModifiedLamport: 0,
  },
];

// Session Client ID setup
let clientId = sessionStorage.getItem("clientId");
if (!clientId) {
  clientId = uuidv4();
  sessionStorage.setItem("clientId", clientId);
}

// Check session storage for existing online state (defaults to true)
const storedIsOnline = sessionStorage.getItem("isOnline");
const initialIsOnline = storedIsOnline ? storedIsOnline === "true" : true;

// IndexedDB Setup
const dbPromise = openDB(`opLogs-${clientId}`, 1, {
  upgrade(db) {
    db.createObjectStore("remoteOps", { keyPath: "id" });
    db.createObjectStore("offlineOps", { keyPath: "id" });
  },
});

// Broadcast Channel for Sync
const bc = new BroadcastChannel("block-editor-sync");

// Lexicographic fractional indexing generator
function generatePosition(prev: string | null, next: string | null): string {
  const p = prev || "";
  const n = next || "";
  let i = 0;
  while (true) {
    const pChar = p.charCodeAt(i) || 96; // 'a' - 1
    const nChar = n.charCodeAt(i) || 123; // 'z' + 1
    if (nChar - pChar > 1) {
      return (
        p.substring(0, i) + String.fromCharCode(Math.floor((pChar + nChar) / 2))
      );
    }
    i++;
  }
}

interface EditorState {
  blocks: Block[];
  isOnline: boolean;
  lamport: number;
  clientId: string;
  init: () => Promise<void>;
  toggleOnline: () => Promise<void>;
  moveBlock: (blockId: string, newIndex: number) => Promise<void>;
  receiveOp: (op: MoveOperation) => Promise<void>;
  syncOfflineOps: () => Promise<void>;
  replayOperations: () => Promise<void>;
}

export const useStore = create<EditorState>((set, get) => ({
  blocks: INITIAL_BLOCKS,
  isOnline: initialIsOnline,
  lamport: 0,
  clientId: clientId as string,

  init: async () => {
    await get().replayOperations();
    if (get().isOnline) {
      bc.postMessage({ type: "syncReq", clientId: get().clientId });
    }
  },

  toggleOnline: async () => {
    const { isOnline, syncOfflineOps, clientId } = get();
    const newOnline = !isOnline;

    sessionStorage.setItem("isOnline", String(newOnline));
    set({ isOnline: newOnline });

    if (newOnline) {
      await syncOfflineOps();
      bc.postMessage({ type: "syncReq", clientId });
    }
  },

  moveBlock: async (blockId, newIndex) => {
    const { blocks, isOnline, lamport, clientId, replayOperations } = get();

    const filteredBlocks = blocks.filter((b) => b.id !== blockId);
    if (newIndex > filteredBlocks.length) newIndex = filteredBlocks.length;

    const prev = newIndex > 0 ? filteredBlocks[newIndex - 1].pos : null;
    const next =
      newIndex < filteredBlocks.length ? filteredBlocks[newIndex].pos : null;

    const newPos = generatePosition(prev, next);
    const newLamport = lamport + 1;

    const op: MoveOperation = {
      id: uuidv4(),
      actorId: clientId,
      lamport: newLamport,
      blockId,
      newPos,
    };

    const db = await dbPromise;
    if (isOnline) {
      await db.put("remoteOps", op);
      bc.postMessage({ type: "op", op });
    } else {
      await db.put("offlineOps", op);
    }

    set({ lamport: newLamport });
    await replayOperations();
  },

  receiveOp: async (op) => {
    const { lamport, replayOperations } = get();
    const db = await dbPromise;
    await db.put("remoteOps", op);

    set({ lamport: Math.max(lamport, op.lamport) + 1 });
    await replayOperations();
  },

  syncOfflineOps: async () => {
    const db = await dbPromise;
    const offlineOps = await db.getAll("offlineOps");
    if (offlineOps.length === 0) return;

    const tx = db.transaction(["offlineOps", "remoteOps"], "readwrite");
    for (const op of offlineOps) {
      await tx.objectStore("remoteOps").put(op);
      await tx.objectStore("offlineOps").delete(op.id);
      bc.postMessage({ type: "op", op });
    }
    await tx.done;
  },

  // Optimized replay that exits early once all blocks are computed
  replayOperations: async () => {
    const db = await dbPromise;
    const remoteOps = await db.getAll("remoteOps");
    const offlineOps = await db.getAll("offlineOps");
    const allOps = [...remoteOps, ...offlineOps];

    // Sort descending by lamport, tie-break by actorId deterministically
    allOps.sort((a, b) => {
      if (a.lamport !== b.lamport) return b.lamport - a.lamport;
      return b.actorId.localeCompare(a.actorId);
    });

    const blocksMap = new Map<string, Block>(
      INITIAL_BLOCKS.map((b) => [b.id, { ...b }]),
    );
    const seenBlocks = new Set<string>();
    let uncomputedBlocks = INITIAL_BLOCKS.length;

    for (const op of allOps) {
      if (!seenBlocks.has(op.blockId)) {
        seenBlocks.add(op.blockId);
        const block = blocksMap.get(op.blockId);
        if (block) {
          block.pos = op.newPos;
          block.lastModifiedBy = op.actorId;
          block.lastModifiedLamport = op.lamport;
        }
        uncomputedBlocks--;
        if (uncomputedBlocks === 0) break; // Optimization: early exit
      }
    }

    const updatedBlocks = Array.from(blocksMap.values()).sort((a, b) =>
      a.pos.localeCompare(b.pos),
    );
    set({ blocks: updatedBlocks });
  },
}));

// Cross-tab message listener setup
bc.onmessage = async (event) => {
  const data = event.data;
  const state = useStore.getState();

  if (!state.isOnline) return;

  if (data.type === "op") {
    await state.receiveOp(data.op);
  } else if (data.type === "syncReq") {
    const db = await dbPromise;
    const remoteOps = await db.getAll("remoteOps");
    bc.postMessage({
      type: "syncRes",
      ops: remoteOps,
      toClientId: data.clientId,
    });
  } else if (data.type === "syncRes" && data.toClientId === state.clientId) {
    const db = await dbPromise;
    const tx = db.transaction("remoteOps", "readwrite");
    let maxLamport = state.lamport;
    for (const op of data.ops) {
      await tx.store.put(op);
      maxLamport = Math.max(maxLamport, op.lamport);
    }
    await tx.done;
    useStore.setState({ lamport: maxLamport + 1 });
    await useStore.getState().replayOperations();
  }
};
