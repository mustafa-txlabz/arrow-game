import type {
  ArrowTile,
  Difficulty,
  Direction,
  GeneratedLevel,
  GridPoint,
} from '../types/game';

const DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

const DIR_DELTA: Record<Direction, { dr: number; dc: number }> = {
  UP: { dr: -1, dc: 0 },
  RIGHT: { dr: 0, dc: 1 },
  DOWN: { dr: 1, dc: 0 },
  LEFT: { dr: 0, dc: -1 },
};

const DIR_DR = [-1, 0, 1, 0];
const DIR_DC = [0, 1, 0, -1];

/** Deterministic Mulberry32 PRNG so each level number generates a consistent puzzle */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function keyOf(r: number, c: number): string {
  return `${r},${c}`;
}

function getRayCells(
  row: number,
  col: number,
  dir: Direction,
  gridSize: number
): GridPoint[] {
  const cells: GridPoint[] = [];
  const { dr, dc } = DIR_DELTA[dir];
  let r = row + dr;
  let c = col + dc;

  while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
    cells.push({ r, c });
    r += dr;
    c += dc;
  }
  return cells;
}

/**
 * Traces an arrow's pointing ray to the outer board boundary.
 * Returns whether the path is unobstructed and the first blocking cell if obstructed.
 */
export function traceArrowPath(
  arrows: ArrowTile[],
  target: ArrowTile,
  gridSize: number
): { clear: boolean; blockerCell: GridPoint | null; freeCells: number } {
  const occ = new Uint8Array(gridSize * gridSize);
  for (const a of arrows) {
    if (a.id === target.id || a.state === 'escaping') continue;
    for (const pt of a.cells) {
      occ[pt.r * gridSize + pt.c] = 1;
    }
  }
  const head = target.cells[target.cells.length - 1];
  const { dr, dc } = DIR_DELTA[target.dir];
  let r = head.r + dr;
  let c = head.c + dc;
  let freeCells = 0;

  while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
    if (occ[r * gridSize + c] === 1) {
      return { clear: false, blockerCell: { r, c }, freeCells };
    }
    freeCells += 1;
    r += dr;
    c += dc;
  }
  return { clear: true, blockerCell: null, freeCells };
}

/**
 * Checks whether an arrow's head has an unobstructed ray to the border of the grid.
 */
export function isArrowClear(
  arrows: ArrowTile[],
  target: ArrowTile,
  gridSize: number
): boolean {
  return traceArrowPath(arrows, target, gridSize).clear;
}

/**
 * Finds a currently escapable arrow for the Hint system.
 */
export function findEscapableArrow(
  arrows: ArrowTile[],
  gridSize: number
): ArrowTile | null {
  for (const arrow of arrows) {
    if (arrow.state === 'escaping') continue;
    if (isArrowClear(arrows, arrow, gridSize)) {
      return arrow;
    }
  }
  return null;
}

/**
 * Rapid progressive grid scaling modeled after original Arrow Escape progression:
 * Starts at a lively 6x6 board (~10-12 arrows) and expands smoothly through
 * 8x8, 10x10, 12x12, 14x14, 16x16, 18x18 (100+ arrows), 20x20, 22x22, up to 24x24 (160-185+ arrows).
 */
export function getGridSizeForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  if (safeLevel <= 2) return 6;
  if (safeLevel <= 5) return 8;
  if (safeLevel <= 9) return 10;
  if (safeLevel <= 15) return 12;
  if (safeLevel <= 22) return 14;
  if (safeLevel <= 30) return 16;
  if (safeLevel <= 40) return 18;
  if (safeLevel <= 55) return 20;
  if (safeLevel <= 75) return 22;
  return 24;
}

function getTierProgress(level: number): { tier: number; tierProgress: number } {
  const safeLevel = Math.max(1, Math.floor(level));
  const bounds: Array<[number, number]> = [
    [1, 2],
    [3, 5],
    [6, 9],
    [10, 15],
    [16, 22],
    [23, 30],
    [31, 40],
    [41, 55],
    [56, 75],
    [76, 120],
  ];
  for (let i = 0; i < bounds.length; i++) {
    const [lo, hi] = bounds[i];
    if (safeLevel <= hi || i === bounds.length - 1) {
      const span = Math.max(1, hi - lo);
      return {
        tier: i,
        tierProgress: Math.min(1, Math.max(0, (safeLevel - lo) / span)),
      };
    }
  }
  return { tier: bounds.length - 1, tierProgress: 1 };
}

export function getLevelDifficulty(level: number): Difficulty {
  const safeLevel = Math.max(1, Math.floor(level));
  if (safeLevel <= 5) return 'Easy';
  if (safeLevel <= 15) return 'Normal';
  if (safeLevel <= 35) return 'Hard';
  return 'Master';
}

export interface ShapeRules {
  maxBends: number;
  allowUTurns: boolean;
}

type ArrowArchetype = 'winding_pipe' | 'c_clamp' | 's_curve' | 'short_key';

export function getShapeRulesForLevel(level: number): ShapeRules {
  const safeLevel = Math.max(1, Math.floor(level));
  if (safeLevel === 1) {
    return { maxBends: 2, allowUTurns: false };
  }
  if (safeLevel <= 4) {
    return { maxBends: 3, allowUTurns: true };
  }
  if (safeLevel <= 12) {
    return { maxBends: 5, allowUTurns: true };
  }
  if (safeLevel <= 30) {
    return { maxBends: 7, allowUTurns: true };
  }
  return { maxBends: 10, allowUTurns: true };
}

interface LevelProgressionTargets {
  gridSize: number;
  tier: number;
  tierProgress: number;
  complexityFactor: number;
  targetOccupied: number;
  targetArrows: number;
  idealInitFree: number;
  maxOneCell: number;
}

function getLevelTargets(level: number): LevelProgressionTargets {
  const safeLevel = Math.max(1, Math.floor(level));
  const gridSize = getGridSizeForLevel(safeLevel);
  const { tier, tierProgress } = getTierProgress(safeLevel);
  const complexityFactor = Math.min(1, (safeLevel - 1) / 85);

  const totalCells = gridSize * gridSize;

  // High-density wall-to-wall labyrinth occupancy: ~90% on Lv 1 climbing to ~95%-97%
  const baseFill =
    safeLevel === 1
      ? 0.9
      : safeLevel === 2
        ? 0.93
        : Math.min(0.97, 0.935 + tierProgress * 0.025 + Math.min(0.015, tier * 0.002));
  const targetOccupied = Math.min(totalCells, Math.round(totalCells * baseFill));

  // Target average arrow length tightens smoothly from ~3.4 on early boards to ~3.0-3.2 on giant boards
  // Yielding: 6x6 -> 10-12, 8x8 -> 18-21, 10x10 -> 28-33, 12x12 -> 40-46, 14x14 -> 56-64,
  //           16x16 -> 74-84, 18x18 -> 94-106 (100+!), 20x20 -> 115-128, 22x22 -> 140-156, 24x24 -> 165-185+
  const avgArrowLen =
    safeLevel === 1
      ? 3.3
      : Math.max(2.95, 3.32 - tierProgress * 0.22 - complexityFactor * 0.14);
  const targetArrows = Math.max(
    9,
    Math.round(targetOccupied / avgArrowLen)
  );

  // Tight opening bottlenecks even on 100+ arrow boards
  const idealInitFree =
    safeLevel <= 2 ? 3 : Math.max(2, Math.floor(gridSize * 0.45));

  // Minimal 1-cell dots only as rare emergency pocket fillers on large grids
  const maxOneCell = gridSize <= 8 ? 0 : Math.min(4, Math.floor(gridSize / 6));

  return {
    gridSize,
    tier,
    tierProgress,
    complexityFactor,
    targetOccupied,
    targetArrows,
    idealInitFree,
    maxOneCell,
  };
}

/**
 * Validates that an arrow has clean, non-self-crossing geometry:
 * - 1 cell (compact blocker) or >= 2 orthogonally connected distinct in-bounds cells
 * - Final segment enters the head along `dir`
 * - Bend count <= `rules.maxBends`
 * - Exit vector from the head is completely unobstructed by the arrow's own body
 */
export function isCleanArrowShape(
  cells: GridPoint[],
  dir: Direction,
  gridSize: number,
  rules: ShapeRules = { maxBends: 12, allowUTurns: true }
): boolean {
  if (cells.length === 0) return false;

  const seen = new Set<string>();
  for (const pt of cells) {
    if (pt.r < 0 || pt.r >= gridSize || pt.c < 0 || pt.c >= gridSize) {
      return false;
    }
    const k = keyOf(pt.r, pt.c);
    if (seen.has(k)) return false;
    seen.add(k);
  }

  if (cells.length === 1) {
    return true;
  }

  const exitDelta = DIR_DELTA[dir];
  const preHead = cells[cells.length - 2];
  const head = cells[cells.length - 1];
  if (head.r - preHead.r !== exitDelta.dr || head.c - preHead.c !== exitDelta.dc) {
    return false;
  }

  let bends = 0;
  let lastTurnSign = 0;
  let prevDr = 0;
  let prevDc = 0;

  for (let i = 1; i < cells.length; i++) {
    const dr = cells[i].r - cells[i - 1].r;
    const dc = cells[i].c - cells[i - 1].c;

    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;

    if (!rules.allowUTurns && dr * exitDelta.dr + dc * exitDelta.dc < 0) {
      return false;
    }

    if (i > 1 && (dr !== prevDr || dc !== prevDc)) {
      bends += 1;
      if (bends > rules.maxBends) return false;

      const turnSign = Math.sign(prevDr * dc - prevDc * dr);
      if (turnSign === 0) return false;
      if (!rules.allowUTurns && bends === 2 && turnSign === lastTurnSign) {
        return false;
      }
      lastTurnSign = turnSign;
    }

    prevDr = dr;
    prevDc = dc;
  }

  // Visual clarity check: exit vector from head must never cross own body cells
  const exitRay = getRayCells(head.r, head.c, dir, gridSize);
  for (const rayPt of exitRay) {
    if (seen.has(keyOf(rayPt.r, rayPt.c))) {
      return false;
    }
  }

  return true;
}

interface AttemptMetrics {
  arrows: ArrowTile[];
  occupiedCount: number;
  waveCount: number;
  initialFreeCount: number;
  longPipeCount: number;
  mediumCurveCount: number;
  shortKeyCount: number;
  oneCellCount: number;
  totalBends: number;
}

function countBends(cells: GridPoint[]): number {
  if (cells.length < 3) return 0;
  let bends = 0;
  let prevDr = cells[1].r - cells[0].r;
  let prevDc = cells[1].c - cells[0].c;
  for (let i = 2; i < cells.length; i++) {
    const dr = cells[i].r - cells[i - 1].r;
    const dc = cells[i].c - cells[i - 1].c;
    if (dr !== prevDr || dc !== prevDc) {
      bends += 1;
    }
    prevDr = dr;
    prevDc = dc;
  }
  return bends;
}

/**
 * Fast O(W * N * G) flat-array complexity evaluator with zero Set/string allocations.
 */
function evaluatePuzzleComplexityFast(
  arrows: ArrowTile[],
  gridSize: number
): Omit<AttemptMetrics, 'arrows' | 'occupiedCount'> {
  const totalCells = gridSize * gridSize;
  const occ = new Uint8Array(totalCells);
  const n = arrows.length;
  const active = new Uint8Array(n);
  const headR = new Int16Array(n);
  const headC = new Int16Array(n);
  const dirIdx = new Uint8Array(n);

  let longPipeCount = 0;
  let mediumCurveCount = 0;
  let shortKeyCount = 0;
  let oneCellCount = 0;
  let totalBends = 0;

  for (let i = 0; i < n; i++) {
    const a = arrows[i];
    active[i] = 1;
    for (const pt of a.cells) {
      occ[pt.r * gridSize + pt.c] = 1;
    }
    const head = a.cells[a.cells.length - 1];
    headR[i] = head.r;
    headC[i] = head.c;
    dirIdx[i] =
      a.dir === 'UP' ? 0 : a.dir === 'RIGHT' ? 1 : a.dir === 'DOWN' ? 2 : 3;

    totalBends += countBends(a.cells);
    if (a.cells.length >= 4) longPipeCount += 1;
    else if (a.cells.length === 3) mediumCurveCount += 1;
    else {
      shortKeyCount += 1;
      if (a.cells.length === 1) oneCellCount += 1;
    }
  }

  let remainingCount = n;
  let waveCount = 0;
  let initialFreeCount = 0;
  const freeIndices: number[] = [];

  while (remainingCount > 0) {
    freeIndices.length = 0;
    for (let i = 0; i < n; i++) {
      if (active[i] === 0) continue;
      const d = dirIdx[i];
      const dr = DIR_DR[d];
      const dc = DIR_DC[d];
      let r = headR[i] + dr;
      let c = headC[i] + dc;
      let clear = true;
      while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        if (occ[r * gridSize + c] !== 0) {
          clear = false;
          break;
        }
        r += dr;
        c += dc;
      }
      if (clear) {
        freeIndices.push(i);
      }
    }

    if (freeIndices.length === 0) break;
    if (waveCount === 0) {
      initialFreeCount = freeIndices.length;
    }
    waveCount += 1;

    for (const idx of freeIndices) {
      active[idx] = 0;
      for (const pt of arrows[idx].cells) {
        occ[pt.r * gridSize + pt.c] = 0;
      }
    }
    remainingCount -= freeIndices.length;
  }

  return {
    waveCount,
    initialFreeCount,
    longPipeCount,
    mediumCurveCount,
    shortKeyCount,
    oneCellCount,
    totalBends,
  };
}

function pickArchetypeAndLength(
  targets: LevelProgressionTargets,
  placedCount: number,
  occupiedCount: number,
  longCount: number,
  mediumCount: number,
  shortCount: number,
  rand: () => number
): { archetype: ArrowArchetype; desiredLen: number } {
  const { gridSize, targetOccupied, targetArrows, complexityFactor } = targets;
  const totalCells = gridSize * gridSize;
  const cellsLeft = Math.max(1, totalCells - occupiedCount);
  const targetCellsLeft = Math.max(2, targetOccupied - occupiedCount);
  const arrowsRemaining = Math.max(1, targetArrows - placedCount);
  const avgNeeded = targetCellsLeft / arrowsRemaining;

  const maxLongLen = Math.min(10, Math.max(5, Math.floor(gridSize * 0.55) + 2));
  const maxLongTarget = Math.max(2, Math.floor(targetArrows * 0.34));
  const fillRatioNow = occupiedCount / totalCells;

  // Anchor early phase with long winding snakes + interlocking C/S-curves
  if (fillRatioNow < 0.42 && cellsLeft >= 4) {
    const r = rand();
    if (longCount < maxLongTarget && (r < 0.46 + complexityFactor * 0.14 || longCount === 0)) {
      const len = Math.min(
        cellsLeft,
        4 + Math.floor(rand() * Math.max(1, maxLongLen - 3))
      );
      return { archetype: 'winding_pipe', desiredLen: len };
    }
    const curveType: ArrowArchetype = rand() < 0.5 ? 'c_clamp' : 's_curve';
    return { archetype: curveType, desiredLen: Math.min(cellsLeft, 3 + (rand() < 0.25 ? 1 : 0)) };
  }

  // Budget-aware scheduling so arrow count AND snake variety balance cleanly
  if (avgNeeded >= 3.65 && cellsLeft >= 4 && longCount < maxLongTarget) {
    const len = Math.min(
      cellsLeft,
      4 + Math.floor(rand() * Math.max(1, maxLongLen - 3))
    );
    return { archetype: 'winding_pipe', desiredLen: len };
  }

  // Mid phase: dense weave of snakes, C/S-hooks, and 2-cell keys
  if (fillRatioNow < 0.84 && cellsLeft >= 2) {
    if (shortCount < Math.floor(placedCount * 0.25) && rand() < 0.52) {
      return { archetype: 'short_key', desiredLen: 2 };
    }
    if (avgNeeded <= 2.3) {
      return { archetype: 'short_key', desiredLen: 2 };
    }
    const r = rand();
    if (
      longCount < maxLongTarget &&
      r < 0.28 + complexityFactor * 0.14 &&
      cellsLeft >= 4 &&
      avgNeeded >= 2.95
    ) {
      const len = Math.min(
        cellsLeft,
        4 + Math.floor(rand() * Math.max(1, maxLongLen - 4))
      );
      return { archetype: 'winding_pipe', desiredLen: len };
    }
    if ((r < 0.68 || mediumCount < Math.floor(placedCount * 0.3)) && cellsLeft >= 3) {
      return {
        archetype: rand() < 0.5 ? 'c_clamp' : 's_curve',
        desiredLen: Math.min(cellsLeft, 3),
      };
    }
    return { archetype: 'short_key', desiredLen: 2 };
  }

  // Late phase: tightly pack remaining cavities with 2-cell keys and 3-cell hooks
  if (cellsLeft >= 3 && avgNeeded >= 2.6 && rand() < 0.44) {
    return {
      archetype: rand() < 0.5 ? 'c_clamp' : 's_curve',
      desiredLen: 3,
    };
  }
  return {
    archetype: 'short_key',
    desiredLen: Math.min(cellsLeft, 2),
  };
}

function buildBoardAttempt(
  level: number,
  targets: LevelProgressionTargets,
  rules: ShapeRules,
  rand: () => number
): AttemptMetrics {
  const { gridSize, targetOccupied, complexityFactor, maxOneCell } = targets;
  const totalCells = gridSize * gridSize;

  // Flat typed-array grid representation (zero string allocations inside inner search)
  const occ = new Int32Array(totalCells).fill(-1);
  const minRayOrder = new Float64Array(totalCells).fill(Infinity);
  const unblockedHotspot = new Uint16Array(totalCells);
  const arrowOrder: number[] = [];
  const arrowHeadIdx: number[] = [];
  const arrowDirIdx: number[] = [];
  const arrowBlocked = new Uint8Array(totalCells);
  const placed: ArrowTile[] = [];

  let occupiedCount = 0;
  let longCount = 0;
  let mediumCount = 0;
  let shortCount = 0;
  let oneCellCount = 0;

  const inwardTargetLen = Math.max(2, Math.floor(gridSize * 0.42));
  const maxGuards = totalCells * (gridSize >= 16 ? 3 : 4);
  let guard = 0;

  const refreshUnblockedHotspots = () => {
    unblockedHotspot.fill(0);
    for (let i = 0; i < placed.length; i++) {
      if (arrowBlocked[i] !== 0) continue;
      const hi = arrowHeadIdx[i];
      const hr = Math.floor(hi / gridSize);
      const hc = hi % gridSize;
      const d = arrowDirIdx[i];
      const dr = DIR_DR[d];
      const dc = DIR_DC[d];
      let r = hr + dr;
      let c = hc + dc;
      let isBlocked = false;
      while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        if (occ[r * gridSize + c] !== -1) {
          isBlocked = true;
          break;
        }
        r += dr;
        c += dc;
      }
      if (isBlocked) {
        arrowBlocked[i] = 1;
        continue;
      }
      r = hr + dr;
      c = hc + dc;
      while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        unblockedHotspot[r * gridSize + c] += 1;
        r += dr;
        c += dc;
      }
    }
  };

  /**
   * Re-normalizes all arrow orders cleanly via topological sort whenever rank intervals get tight,
   * guaranteeing numerical headroom across even 180+ deeply nested arrows.
   */
  const rebalanceOrders = () => {
    const n = placed.length;
    if (n === 0) return;
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => arrowOrder[a] - arrowOrder[b]);
    for (let rank = 0; rank < n; rank++) {
      arrowOrder[indices[rank]] = (rank + 1) * 1_000_000;
    }
    minRayOrder.fill(Infinity);
    for (let i = 0; i < n; i++) {
      const ord = arrowOrder[i];
      const hi = arrowHeadIdx[i];
      const hr = Math.floor(hi / gridSize);
      const hc = hi % gridSize;
      const d = arrowDirIdx[i];
      const dr = DIR_DR[d];
      const dc = DIR_DC[d];
      let r = hr + dr;
      let c = hc + dc;
      while (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        const cellIdx = r * gridSize + c;
        if (ord < minRayOrder[cellIdx]) minRayOrder[cellIdx] = ord;
        r += dr;
        c += dc;
      }
    }
  };

  const commitArrow = (
    cells: GridPoint[],
    dIdx: number,
    maxBlockerOrder: number,
    minBlockedRayOrder: number
  ): boolean => {
    // Safety invariant check: M < m prevents 100% of dependency cycles
    let M = maxBlockerOrder;
    let m = minBlockedRayOrder;
    if (m - M < 1e-4) {
      rebalanceOrders();
      // Recompute M and m under rebalanced scale
      const head = cells[cells.length - 1];
      const dr = DIR_DR[dIdx];
      const dc = DIR_DC[dIdx];
      M = -Infinity;
      let rr = head.r + dr;
      let cc = head.c + dc;
      while (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
        const o = occ[rr * gridSize + cc];
        if (o !== -1 && arrowOrder[o] > M) M = arrowOrder[o];
        rr += dr;
        cc += dc;
      }
      m = Infinity;
      for (const pt of cells) {
        const ro = minRayOrder[pt.r * gridSize + pt.c];
        if (ro < m) m = ro;
      }
      if (m <= M + 1e-4) return false;
    }

    let newOrder: number;
    if (M === -Infinity && m === Infinity) {
      newOrder = 1_000_000_000 + placed.length * 1_000_000;
    } else if (M === -Infinity) {
      newOrder = m - 1_000_000;
    } else if (m === Infinity) {
      newOrder = M + 1_000_000;
    } else {
      newOrder = (M + m) * 0.5;
    }

    const idx = placed.length;
    const head = cells[cells.length - 1];
    const headIdx = head.r * gridSize + head.c;

    arrowOrder.push(newOrder);
    arrowHeadIdx.push(headIdx);
    arrowDirIdx.push(dIdx);

    for (const pt of cells) {
      occ[pt.r * gridSize + pt.c] = idx;
    }
    occupiedCount += cells.length;

    const dr = DIR_DR[dIdx];
    const dc = DIR_DC[dIdx];
    let rr = head.r + dr;
    let cc = head.c + dc;
    while (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
      const cellIdx = rr * gridSize + cc;
      if (newOrder < minRayOrder[cellIdx]) {
        minRayOrder[cellIdx] = newOrder;
      }
      rr += dr;
      cc += dc;
    }

    if (cells.length >= 4) longCount += 1;
    else if (cells.length === 3) mediumCount += 1;
    else {
      shortCount += 1;
      if (cells.length === 1) oneCellCount += 1;
    }

    placed.push({
      id: `L${level}-A${idx}`,
      cells,
      dir: DIRECTIONS[dIdx],
      state: 'idle',
    });
    return true;
  };

  interface HeadCandidate {
    hr: number;
    hc: number;
    pr: number;
    pc: number;
    dIdx: number;
    maxBlockerOrder: number;
    canExtend: boolean;
    score: number;
  }

  // Phase 1: High-speed ranked labyrinth routing
  while (occupiedCount < targetOccupied && guard < maxGuards) {
    guard += 1;
    refreshUnblockedHotspots();

    const fillRatioNow = occupiedCount / totalCells;
    const { archetype, desiredLen } = pickArchetypeAndLength(
      targets,
      placed.length,
      occupiedCount,
      longCount,
      mediumCount,
      shortCount,
      rand
    );

    const candidates: HeadCandidate[] = [];
    const allowBlockedPoints = fillRatioNow >= 0.42;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const headIdx = r * gridSize + c;
        if (occ[headIdx] !== -1) continue;

        const mHead = minRayOrder[headIdx];
        const hotspotHead = unblockedHotspot[headIdx];

        for (let dIdx = 0; dIdx < 4; dIdx++) {
          const dr = DIR_DR[dIdx];
          const dc = DIR_DC[dIdx];

          let rr = r + dr;
          let cc = c + dc;
          let maxBlockerOrder = -Infinity;
          let rayLen = 0;
          let blockerCount = 0;

          while (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
            const o = occ[rr * gridSize + cc];
            if (o !== -1) {
              blockerCount += 1;
              const ord = arrowOrder[o];
              if (ord > maxBlockerOrder) maxBlockerOrder = ord;
            }
            rayLen += 1;
            rr += dr;
            cc += dc;
          }

          if (!allowBlockedPoints && blockerCount > 0) continue;
          if (mHead <= maxBlockerOrder + 1e-4) continue;

          const pr = r - dr;
          const pc = c - dc;
          let canExtend = false;
          let hotspotPre = 0;
          if (pr >= 0 && pr < gridSize && pc >= 0 && pc < gridSize) {
            const preIdx = pr * gridSize + pc;
            if (occ[preIdx] === -1 && minRayOrder[preIdx] > maxBlockerOrder + 1e-4) {
              canExtend = true;
              hotspotPre = unblockedHotspot[preIdx];
            }
          }

          if (!canExtend) continue;

          const rayScore =
            rayLen === 0
              ? -24
              : rayLen === 1 && fillRatioNow < 0.72
                ? -10
                : Math.min(gridSize - 1, rayLen) * (fillRatioNow < 0.7 ? 2.4 : 1.1) +
                  (rayLen >= inwardTargetLen ? 4 : 0);

          const unblockedBonus =
            (hotspotHead + hotspotPre) *
            (archetype === 'short_key' ? 8.0 : 5.0 + complexityFactor * 3.5);
          // Pointing into an existing earlier arrow adds depth without increasing initialFreeCount
          const alreadyBlockedBonus = blockerCount > 0 ? 11 + complexityFactor * 6 : 0;

          const score =
            rayScore +
            unblockedBonus +
            alreadyBlockedBonus +
            rand() * 2.2;

          candidates.push({
            hr: r,
            hc: c,
            pr,
            pc,
            dIdx,
            maxBlockerOrder,
            canExtend: true,
            score,
          });
        }
      }
    }

    if (candidates.length === 0) break;

    candidates.sort((a, b) => b.score - a.score);
    const topSlice = Math.min(
      candidates.length,
      Math.max(2, Math.ceil(candidates.length * 0.16))
    );
    const start = candidates[Math.floor(rand() * topSlice)];

    const drExit = DIR_DR[start.dIdx];
    const dcExit = DIR_DC[start.dIdx];
    const M = start.maxBlockerOrder;
    let m = Math.min(
      minRayOrder[start.hr * gridSize + start.hc],
      minRayOrder[start.pr * gridSize + start.pc]
    );

    const reversedCells: GridPoint[] = [
      { r: start.hr, c: start.hc },
      { r: start.pr, c: start.pc },
    ];
    const localUsed = new Set<number>([
      start.hr * gridSize + start.hc,
      start.pr * gridSize + start.pc,
    ]);

    let curR = start.pr;
    let curC = start.pc;
    let prevDr = start.pr - start.hr;
    let prevDc = start.pc - start.hc;
    let bendCount = 0;
    let lastTurnSign = 0;

    while (reversedCells.length < desiredLen) {
      const neighbors: Array<{
        r: number;
        c: number;
        dr: number;
        dc: number;
        isBend: boolean;
        turnSign: number;
        minOrd: number;
        weight: number;
      }> = [];

      for (let ndIdx = 0; ndIdx < 4; ndIdx++) {
        const dr = DIR_DR[ndIdx];
        const dc = DIR_DC[ndIdx];
        const nr = curR + dr;
        const nc = curC + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

        const nIdx = nr * gridSize + nc;
        if (occ[nIdx] !== -1 || localUsed.has(nIdx)) continue;

        // O(1) check: never step onto own exit ray
        if (
          (nr - start.hr) * dcExit === (nc - start.hc) * drExit &&
          (nr - start.hr) * drExit + (nc - start.hc) * dcExit > 0
        ) {
          continue;
        }

        // Preserve strict M < m cycle-free invariant
        const cellMinOrd = minRayOrder[nIdx];
        if (cellMinOrd <= M + 1e-4) continue;

        if (!rules.allowUTurns && -dr * drExit + -dc * dcExit < 0) {
          continue;
        }

        const isStraight = dr === prevDr && dc === prevDc;
        const isReverse = dr === -prevDr && dc === -prevDc;
        if (isReverse) continue;

        let turnSign = 0;
        let isUTurn = false;
        if (!isStraight) {
          if (bendCount >= rules.maxBends) continue;
          turnSign = Math.sign(prevDr * dc - prevDc * dr);
          if (turnSign === 0) continue;
          isUTurn = bendCount >= 1 && turnSign === lastTurnSign;
          if (!rules.allowUTurns && isUTurn) continue;
        }

        // Hug adjacent occupied cells and walls tightly like real Arrow Escape circuits
        let adjOccupied = 0;
        for (let ad = 0; ad < 4; ad++) {
          const ar = nr + DIR_DR[ad];
          const ac = nc + DIR_DC[ad];
          if (ar < 0 || ar >= gridSize || ac < 0 || ac >= gridSize) {
            adjOccupied += 0.6;
          } else if (occ[ar * gridSize + ac] !== -1 || localUsed.has(ar * gridSize + ac)) {
            adjOccupied += 1;
          }
        }

        let shapeWeight = 1.0;
        if (archetype === 'c_clamp') {
          shapeWeight = !isStraight
            ? bendCount === 0 || isUTurn
              ? 3.6
              : 0.7
            : 0.85;
        } else if (archetype === 's_curve') {
          shapeWeight = !isStraight
            ? bendCount === 0 || !isUTurn
              ? 3.4
              : 0.65
            : 0.9;
        } else if (archetype === 'winding_pipe') {
          shapeWeight = isStraight ? 1.15 : 2.6;
        } else {
          shapeWeight = isStraight ? 1.25 : 1.75;
        }

        const hotspotBonus = unblockedHotspot[nIdx] * (4.2 + complexityFactor * 3.5);
        const hugBonus = adjOccupied * (1.2 + complexityFactor * 0.6);

        neighbors.push({
          r: nr,
          c: nc,
          dr,
          dc,
          isBend: !isStraight,
          turnSign,
          minOrd: cellMinOrd,
          weight: shapeWeight + hotspotBonus + hugBonus,
        });
      }

      if (neighbors.length === 0) break;

      const totalWeight = neighbors.reduce((sum, n) => sum + n.weight, 0);
      let roll = rand() * totalWeight;
      let picked = neighbors[0];
      for (const n of neighbors) {
        roll -= n.weight;
        if (roll <= 0) {
          picked = n;
          break;
        }
      }

      if (picked.isBend) {
        bendCount += 1;
        lastTurnSign = picked.turnSign;
      }

      if (picked.minOrd < m) m = picked.minOrd;
      reversedCells.push({ r: picked.r, c: picked.c });
      localUsed.add(picked.r * gridSize + picked.c);
      prevDr = picked.dr;
      prevDc = picked.dc;
      curR = picked.r;
      curC = picked.c;
    }

    const cells = reversedCells.reverse();
    if (!isCleanArrowShape(cells, DIRECTIONS[start.dIdx], gridSize, rules)) {
      continue;
    }

    commitArrow(cells, start.dIdx, M, m);
  }

  // Phase 2: Deterministic Pocket-Filler Pass (packs remaining 2-cell corridors up to 94-97%!)
  if (occupiedCount < targetOccupied) {
    const emptyIndices: number[] = [];
    for (let i = 0; i < totalCells; i++) {
      if (occ[i] === -1) emptyIndices.push(i);
    }
    // Deterministic shuffle
    for (let i = emptyIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = emptyIndices[i];
      emptyIndices[i] = emptyIndices[j];
      emptyIndices[j] = tmp;
    }

    for (const hrIdx of emptyIndices) {
      if (occupiedCount >= targetOccupied) break;
      if (occ[hrIdx] !== -1) continue;
      const hr = Math.floor(hrIdx / gridSize);
      const hc = hrIdx % gridSize;

      let bestFill: {
        cells: GridPoint[];
        dIdx: number;
        M: number;
        m: number;
        score: number;
      } | null = null;

      for (let dIdx = 0; dIdx < 4; dIdx++) {
        const dr = DIR_DR[dIdx];
        const dc = DIR_DC[dIdx];
        const pr = hr - dr;
        const pc = hc - dc;
        if (pr < 0 || pr >= gridSize || pc < 0 || pc >= gridSize) continue;
        const prIdx = pr * gridSize + pc;
        if (occ[prIdx] !== -1) continue;

        let rr = hr + dr;
        let cc = hc + dc;
        let M = -Infinity;
        while (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
          const o = occ[rr * gridSize + cc];
          if (o !== -1 && arrowOrder[o] > M) M = arrowOrder[o];
          rr += dr;
          cc += dc;
        }

        const m = Math.min(minRayOrder[hrIdx], minRayOrder[prIdx]);
        if (m <= M + 1e-4) continue;

        const score = (M > -Infinity ? 10 : 0) + rand() * 2;
        if (!bestFill || score > bestFill.score) {
          bestFill = {
            cells: [
              { r: pr, c: pc },
              { r: hr, c: hc },
            ],
            dIdx,
            M,
            m,
            score,
          };
        }
      }

      if (bestFill) {
        commitArrow(bestFill.cells, bestFill.dIdx, bestFill.M, bestFill.m);
      }
    }

    // Rare 1-cell cap pocket fill only on large boards if still below target
    if (occupiedCount < targetOccupied && oneCellCount < maxOneCell) {
      for (const hrIdx of emptyIndices) {
        if (occupiedCount >= targetOccupied || oneCellCount >= maxOneCell) break;
        if (occ[hrIdx] !== -1) continue;
        const hr = Math.floor(hrIdx / gridSize);
        const hc = hrIdx % gridSize;
        for (let dIdx = 0; dIdx < 4; dIdx++) {
          const dr = DIR_DR[dIdx];
          const dc = DIR_DC[dIdx];
          let rr = hr + dr;
          let cc = hc + dc;
          let M = -Infinity;
          while (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
            const o = occ[rr * gridSize + cc];
            if (o !== -1 && arrowOrder[o] > M) M = arrowOrder[o];
            rr += dr;
            cc += dc;
          }
          const m = minRayOrder[hrIdx];
          if (m > M + 1e-4) {
            if (commitArrow([{ r: hr, c: hc }], dIdx, M, m)) break;
          }
        }
      }
    }
  }

  const metrics = evaluatePuzzleComplexityFast(placed, gridSize);
  return {
    arrows: placed,
    occupiedCount,
    ...metrics,
  };
}

function scoreAttempt(
  attempt: AttemptMetrics,
  targets: LevelProgressionTargets
): number {
  const {
    gridSize,
    complexityFactor,
    targetOccupied,
    targetArrows,
    idealInitFree,
    maxOneCell,
  } = targets;

  const occDeficit = Math.max(0, targetOccupied - attempt.occupiedCount);
  const arrowDeficit = Math.max(0, targetArrows - attempt.arrows.length);
  const arrowDelta = Math.abs(attempt.arrows.length - targetArrows);

  const hasLong = attempt.longPipeCount >= Math.max(2, Math.floor(gridSize * 0.4)) ? 1 : 0;
  const hasMedium = attempt.mediumCurveCount >= Math.max(2, Math.floor(gridSize * 0.4)) ? 1 : 0;
  const hasShort = attempt.shortKeyCount >= Math.max(2, Math.floor(gridSize * 0.4)) ? 1 : 0;
  const diversityBonus = (hasLong + hasMedium + hasShort) * 35;

  const oneCellPenalty = Math.max(0, attempt.oneCellCount - maxOneCell) * 60;

  const densityScore =
    attempt.occupiedCount * 9 -
    occDeficit * 32 -
    arrowDeficit * 28 -
    arrowDelta * 12 -
    oneCellPenalty +
    attempt.longPipeCount * (10 + complexityFactor * 8) +
    attempt.mediumCurveCount * 6 +
    attempt.totalBends * (3.0 + complexityFactor * 4.5) +
    diversityBonus;

  const excessFree = Math.max(0, attempt.initialFreeCount - idealInitFree);
  const interlockScore =
    attempt.waveCount * (28 + complexityFactor * 34) -
    excessFree * (26 + complexityFactor * 28);

  return densityScore + interlockScore;
}

/**
 * Generates a deterministic, progressive, guaranteed-solvable puzzle seeded strictly by `level`.
 * - Rapid progressive grid scaling from 6x6 (~10-12 arrows) up to 24x24 (160-185+ arrows).
 * - Cycle-free rank-based insertion packs 92-97% of every board with zero empty holes.
 */
export function generateLevel(level: number): GeneratedLevel {
  const safeLevel = Math.max(1, Math.floor(level));
  const targets = getLevelTargets(safeLevel);
  const difficulty = getLevelDifficulty(safeLevel);
  const rules = getShapeRulesForLevel(safeLevel);

  const baseSeed = (safeLevel * 0x9e3779b1 + 0x85ebca6b) >>> 0;
  let best = buildBoardAttempt(safeLevel, targets, rules, mulberry32(baseSeed));
  let bestScore = scoreAttempt(best, targets);

  const attemptCount =
    targets.gridSize <= 10 ? 14 : targets.gridSize <= 16 ? 8 : 5;
  for (let attempt = 1; attempt < attemptCount; attempt++) {
    const candidate = buildBoardAttempt(
      safeLevel,
      targets,
      rules,
      mulberry32((baseSeed + attempt * 7919) >>> 0)
    );
    const candidateScore = scoreAttempt(candidate, targets);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return {
    level: safeLevel,
    gridSize: targets.gridSize,
    difficulty,
    arrows: best.arrows,
  };
}
