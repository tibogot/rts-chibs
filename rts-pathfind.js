/**
 * Fast grid A* helpers — generation-stamped buffers (no O(N) clear per search).
 */

export function createAstarState() {
  return {
    n: 0,
    g: null,
    f: null,
    came: null,
    closed: null,
    stamp: null,
    gen: 0,
    heap: [],
  };
}

export function astarEnsureCapacity(state, n) {
  if (!state.g || state.n < n) {
    state.n = n;
    state.g = new Float32Array(n);
    state.f = new Float32Array(n);
    state.came = new Int32Array(n);
    state.closed = new Uint8Array(n);
    state.stamp = new Uint32Array(n);
  }
}

export function astarBeginSearch(state) {
  state.gen++;
  if (state.gen === 0xffffffff) {
    state.stamp.fill(0);
    state.gen = 1;
  }
  state.heap.length = 0;
}

export function astarTouch(state, idx) {
  if (state.stamp[idx] !== state.gen) {
    state.stamp[idx] = state.gen;
    state.g[idx] = Infinity;
    state.f[idx] = Infinity;
    state.came[idx] = -1;
    state.closed[idx] = 0;
  }
}

export function astarPushHeap(state, idx) {
  const heap = state.heap;
  const fScore = state.f;
  heap.push(idx);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (fScore[heap[p]] <= fScore[heap[i]]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}

export function astarPopHeap(state) {
  const heap = state.heap;
  const fScore = state.f;
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const rr = l + 1;
      let sm = i;
      if (l < heap.length && fScore[heap[l]] < fScore[heap[sm]]) sm = l;
      if (rr < heap.length && fScore[heap[rr]] < fScore[heap[sm]]) sm = rr;
      if (sm === i) break;
      [heap[sm], heap[i]] = [heap[i], heap[sm]];
      i = sm;
    }
  }
  return top;
}
