/** Area-controlled four-neighbor graph cut of the normalized STF protection gate. */
export const STF_GRAPH_CUT_MAX_WORK_PIXELS = 32_768;
const STF_GRAPH_CUT_BOUNDARY_WEIGHT = 0.6;
const STF_GRAPH_CUT_EDGE_FALLOFF = 0.12;
const STF_GRAPH_CUT_AREA_ITERATIONS = 12;
const FLOW_EPSILON = 1e-9;

type CutResult = { mask: Uint8Array; whiteCount: number };

export type StfGraphCutInfo = {
  workingWidth: number;
  workingHeight: number;
  targetWhiteFraction: number;
  achievedWhiteFraction: number;
  cuts: number;
  areaBias: number;
};

/**
 * Reusable residual network with paired reverse arcs, and iterative Dinic
 * blocking flows (not recursive, so a long image cannot overflow the stack).
 */
class StfGridCut {
  private readonly head: Int32Array;
  private readonly to: Int32Array;
  private readonly next: Int32Array;
  private readonly capacity: Float64Array;
  private readonly residual: Float64Array;
  private readonly source: number;
  private readonly sink: number;
  private readonly sourceEdges: Int32Array;
  private readonly sinkEdges: Int32Array;
  private readonly levels: Int32Array;
  private readonly queue: Int32Array;
  private readonly current: Int32Array;
  private readonly pathNodes: Int32Array;
  private readonly pathEdges: Int32Array;
  private readonly pathFlows: Float64Array;
  private arcCount = 0;

  constructor(private readonly values: Float32Array, width: number, height: number) {
    const pixels = values.length;
    const vertices = pixels + 2;
    const neighbors = (width - 1) * height + (height - 1) * width;
    // Each neighbor has two directed edges, each with a reverse arc;
    // source/pixel and pixel/sink each also have a reverse arc.
    const arcSlots = 4 * (pixels + neighbors);
    this.head = new Int32Array(vertices).fill(-1);
    this.to = new Int32Array(arcSlots);
    this.next = new Int32Array(arcSlots);
    this.capacity = new Float64Array(arcSlots);
    this.residual = new Float64Array(arcSlots);
    this.source = pixels;
    this.sink = pixels + 1;
    this.sourceEdges = new Int32Array(pixels);
    this.sinkEdges = new Int32Array(pixels);
    this.levels = new Int32Array(vertices);
    this.queue = new Int32Array(vertices);
    this.current = new Int32Array(vertices);
    this.pathNodes = new Int32Array(vertices);
    this.pathEdges = new Int32Array(vertices);
    this.pathFlows = new Float64Array(vertices);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        this.sourceEdges[p] = this.addArc(this.source, p, 0);
        this.sinkEdges[p] = this.addArc(p, this.sink, 0);
        if (x > 0) this.addBoundary(p, p - 1);
        if (y > 0) this.addBoundary(p, p - width);
      }
    }
    if (this.arcCount !== arcSlots) throw new Error("STF Graph Cut graph capacity is inconsistent.");
  }

  private addArc(a: number, b: number, strength: number): number {
    const edge = this.arcCount;
    this.to[edge] = b;
    this.next[edge] = this.head[a];
    this.head[a] = edge;
    this.capacity[edge] = strength;
    this.to[edge + 1] = a;
    this.next[edge + 1] = this.head[b];
    this.head[b] = edge + 1;
    this.arcCount += 2;
    return edge;
  }

  private addBoundary(p: number, q: number): void {
    // Symmetric boundary cost, attenuated across an actual confidence edge.
    const weight = STF_GRAPH_CUT_BOUNDARY_WEIGHT *
      Math.exp(-Math.abs(this.values[p] - this.values[q]) / STF_GRAPH_CUT_EDGE_FALLOFF);
    this.addArc(p, q, weight);
    this.addArc(q, p, weight);
  }

  cut(bias: number): CutResult {
    const pixels = this.values.length;
    // Reuse the graph topology, restoring only residual capacities.
    for (let p = 0; p < pixels; p++) {
      const whiteCost = 1 - this.values[p] + bias;
      const blackCost = this.values[p];
      // An equal per-pixel offset makes both terminal capacities nonnegative.
      this.capacity[this.sourceEdges[p]] = blackCost + Math.max(0, -whiteCost);
      this.capacity[this.sinkEdges[p]] = Math.max(0, whiteCost);
    }
    this.residual.set(this.capacity);
    const { source, sink, head, to, next, residual, queue, levels, current } = this;
    const nodes = this.pathNodes, edges = this.pathEdges, flows = this.pathFlows;
    // Dinic maximum flow. All source/sink capacities are finite; the graph
    // has no need for synthetic infinite capacities or class-specific seeds.
    for (;;) {
      levels.fill(-1);
      let start = 0, end = 1;
      queue[0] = source;
      levels[source] = 0;
      while (start < end) {
        const v = queue[start++];
        for (let e = head[v]; e !== -1; e = next[e]) {
          const u = to[e];
          if (residual[e] > FLOW_EPSILON && levels[u] < 0) {
            levels[u] = levels[v] + 1;
            queue[end++] = u;
          }
        }
      }
      if (levels[sink] < 0) break;
      current.set(head);
      for (;;) {
        nodes[0] = source;
        flows[0] = Infinity;
        let depth = 0;
        let pushed = 0;
        while (depth >= 0) {
          const v = nodes[depth];
          if (v === sink) {
            pushed = flows[depth];
            for (let i = 0; i < depth; i++) {
              const e = edges[i];
              residual[e] -= pushed;
              residual[e ^ 1] += pushed;
            }
            break;
          }
          let e = current[v];
          while (e !== -1 && (residual[e] <= FLOW_EPSILON || levels[to[e]] !== levels[v] + 1)) e = next[e];
          current[v] = e;
          if (e === -1) {
            depth--;
            if (depth >= 0) current[nodes[depth]] = next[edges[depth]];
          } else {
            edges[depth] = e;
            nodes[++depth] = to[e];
            flows[depth] = Math.min(flows[depth - 1], residual[e]);
          }
        }
        if (pushed <= FLOW_EPSILON) break;
      }
    }
    // Labels are given by source-reachability in the final residual graph.
    const visited = new Uint8Array(pixels + 2);
    let start = 0, end = 1, whiteCount = 0;
    queue[0] = source;
    visited[source] = 1;
    while (start < end) {
      const v = queue[start++];
      for (let e = head[v]; e !== -1; e = next[e]) {
        const u = to[e];
        if (!visited[u] && residual[e] > FLOW_EPSILON) {
          visited[u] = 1;
          queue[end++] = u;
        }
      }
    }
    const mask = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p++) {
      if (visited[p]) { mask[p] = 1; whiteCount++; }
    }
    return { mask, whiteCount };
  }
}

/**
 * Compute a reusable binary mask on the <=32768-pixel work grid.
 * Raising the white-area gate is deliberately performed separately, so
 * changing the area-guard exponent does not repeat max-flow optimization.
 */
export function buildStfGraphCutMask(
  confidence: Float32Array,
  width: number,
  height: number,
  blurRatio: number,
  maxWorkPixels = STF_GRAPH_CUT_MAX_WORK_PIXELS,
): { mask: Uint8Array; info: StfGraphCutInfo } {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || confidence.length !== pixels ||
      !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
      !Number.isFinite(blurRatio) || blurRatio < 0 || blurRatio > 1 ||
      !Number.isInteger(maxWorkPixels) || maxWorkPixels < 1) {
    throw new Error("STF Graph Cut parameters are invalid.");
  }
  for (const value of confidence) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("STF Graph Cut input must be in [0,1].");
    }
  }
  const scale = Math.min(1, Math.sqrt(maxWorkPixels / pixels));
  let workingWidth = Math.max(1, Math.round(width * scale));
  let workingHeight = Math.max(1, Math.round(height * scale));
  // Rounding both dimensions independently can exceed the requested budget.
  while (workingWidth * workingHeight > maxWorkPixels) {
    if (workingWidth >= workingHeight && workingWidth > 1) workingWidth--;
    else workingHeight--;
  }
  const count = workingWidth * workingHeight;
  const sums = new Float64Array(count);
  const counts = new Uint32Array(count);
  for (let y = 0; y < height; y++) {
    const dy = Math.min(workingHeight - 1, Math.floor(y * workingHeight / height));
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const dest = dy * workingWidth + Math.min(workingWidth - 1, Math.floor(x * workingWidth / width));
      sums[dest] += confidence[index];
      counts[dest]++;
    }
  }
  const reduced = new Float32Array(count);
  for (let i = 0; i < count; i++) reduced[i] = counts[i] ? sums[i] / counts[i] : 0;
  const target = 1 - blurRatio;
  const cut = new StfGridCut(reduced, workingWidth, workingHeight);
  // Lower (negative) white costs increase the chosen white area. The symmetric
  // interval brackets all-white/all-black solutions regardless of topology.
  let lower = -2, upper = 2;
  let bestMask: Uint8Array = new Uint8Array(count);
  let bestCount = -1;
  let bestBias = 0;
  let bestError = Infinity;
  let cuts = 0;
  for (let iteration = 0; iteration < STF_GRAPH_CUT_AREA_ITERATIONS; iteration++) {
    const bias = (lower + upper) / 2;
    const result = cut.cut(bias);
    cuts++;
    const error = Math.abs(result.whiteCount / count - target);
    if (error < bestError) {
      bestError = error;
      bestCount = result.whiteCount;
      bestMask = result.mask;
      bestBias = bias;
    }
    if (error <= 0.005) break;
    if (result.whiteCount / count > target) lower = bias;
    else upper = bias;
  }
  return { mask: bestMask, info: {
    workingWidth, workingHeight,
    targetWhiteFraction: target,
    achievedWhiteFraction: Math.max(0, bestCount) / count,
    cuts, areaBias: bestBias,
  } };
}

/** Apply the selected area-guard exponent, without rerunning Graph Cut. */
export function applyStfGraphCutBoost(
  confidence: Float32Array, width: number, height: number,
  mask: Uint8Array, workingWidth: number, workingHeight: number, exponent: number,
): Float32Array {
  if (confidence.length !== width * height || mask.length !== workingWidth * workingHeight ||
      !(width > 0 && height > 0 && workingWidth > 0 && workingHeight > 0) ||
      !Number.isFinite(exponent) || !(exponent > 0 && exponent < 1)) {
    throw new Error("STF Graph Cut boost parameters are invalid.");
  }
  const values = new Float32Array(confidence.length);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(workingHeight - 1, (y + 0.5) * workingHeight / height - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(workingHeight - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(workingWidth - 1, (x + 0.5) * workingWidth / width - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(workingWidth - 1, x0 + 1), tx = fx - x0;
      const top = mask[y0 * workingWidth + x0] * (1 - tx) + mask[y0 * workingWidth + x1] * tx;
      const bottom = mask[y1 * workingWidth + x0] * (1 - tx) + mask[y1 * workingWidth + x1] * tx;
      const softMask = top * (1 - ty) + bottom * ty;
      const index = y * width + x;
      const original = confidence[index];
      if (!Number.isFinite(original) || original < 0 || original > 1) throw new Error("STF Graph Cut boost input must be [0,1].");
      values[index] = original + softMask * (Math.pow(original, exponent) - original);
    }
  }
  return values;
}
