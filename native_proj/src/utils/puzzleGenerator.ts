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
  const occupied = new Set<string>();
  for (const a of arrows) {
    if (a.id === target.id || a.state === 'escaping') continue;
    for (const pt of a.cells) {
      occupied.add(keyOf(pt.r, pt.c));
    }
  }
  const head = target.cells[target.cells.length - 1];
  const ray = getRayCells(head.r, head.c, target.dir, gridSize);
  let freeCells = 0;
  for (const pt of ray) {
    if (occupied.has(keyOf(pt.r, pt.c))) {
      return { clear: false, blockerCell: pt, freeCells };
    }
    freeCells += 1;
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

export function getGridSizeForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const tier = Math.floor((safeLevel - 1) / 50);
  return Math.min(12, 4 + tier);
}

export function getLevelDifficulty(level: number): Difficulty {
  const safeLevel = Math.max(1, Math.floor(level));
  const tier = Math.floor((safeLevel - 1) / 50);
  const posInTier = (safeLevel - 1) % 50;

  if (tier === 0) {
    return posInTier < 20 ? 'Easy' : 'Normal';
  }
  if (tier === 1) {
    return posInTier < 25 ? 'Normal' : 'Hard';
  }
  if (tier === 2) {
    return posInTier < 25 ? 'Hard' : 'Master';
  }
  return 'Master';
}

export interface ShapeRules {
  maxBends: number;
  allowUTurns: boolean;
}

type ArrowArchetype = 'winding_pipe' | 'c_clamp' | 's_curve' | 'short_key';

export function getShapeRulesForLevel(level: number): ShapeRules {
  const safeLevel = Math.max(1, Math.floor(level));
  const tier = Math.floor((safeLevel - 1) / 50);

  if (safeLevel <= 8) {
    return { maxBends: 3, allowUTurns: true };
  }
  if (tier === 0) {
    return { maxBends: 4, allowUTurns: true };
  }
  if (tier === 1) {
    return { maxBends: 5, allowUTurns: true };
  }
  if (tier === 2) {
    return { maxBends: 6, allowUTurns: true };
  }
  return { maxBends: Math.min(9, 5 + tier), allowUTurns: true };
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
  rules: ShapeRules = { maxBends: 9, allowUTurns: true }
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

function evaluatePuzzleComplexity(
  arrows: ArrowTile[],
  gridSize: number
): Omit<AttemptMetrics, 'arrows' | 'occupiedCount'> {
  let remaining = [...arrows];
  let waveCount = 0;
  let initialFreeCount = 0;

  while (remaining.length > 0) {
    const freeIds = new Set<string>();
    for (const a of remaining) {
      if (isArrowClear(remaining, a, gridSize)) {
        freeIds.add(a.id);
      }
    }
    if (freeIds.size === 0) break;
    if (waveCount === 0) {
      initialFreeCount = freeIds.size;
    }
    waveCount += 1;
    remaining = remaining.filter((a) => !freeIds.has(a.id));
  }

  let longPipeCount = 0;
  let mediumCurveCount = 0;
  let shortKeyCount = 0;
  let totalBends = 0;

  for (const a of arrows) {
    totalBends += countBends(a.cells);
    if (a.cells.length >= 4) {
      longPipeCount += 1;
    } else if (a.cells.length === 3) {
      mediumCurveCount += 1;
    } else {
      shortKeyCount += 1;
    }
  }

  return {
    waveCount,
    initialFreeCount,
    longPipeCount,
    mediumCurveCount,
    shortKeyCount,
    totalBends,
  };
}

function pickArchetypeAndLength(
  gridSize: number,
  fillRatioNow: number,
  cellsLeft: number,
  complexityFactor: number,
  longCount: number,
  mediumCount: number,
  shortCount: number,
  oneCellCount: number,
  rand: () => number
): { archetype: ArrowArchetype; desiredLen: number } {
  const maxLong = Math.min(7, Math.max(4, gridSize));
  const maxLongTarget = gridSize <= 4 ? 2 : Math.max(3, gridSize - 1);
  const maxOneCell = gridSize <= 5 ? 1 : Math.min(3, Math.floor(gridSize / 2) - 1);

  // Phase 1: Early board skeleton -> prioritize long winding pipes (4-6+ cells) & C/S curves
  if (fillRatioNow < 0.44 && cellsLeft >= 4) {
    const r = rand();
    if (longCount < maxLongTarget && (r < 0.56 || longCount === 0)) {
      const len = Math.min(
        cellsLeft,
        4 + Math.floor(rand() * Math.max(1, maxLong - 3))
      );
      return { archetype: 'winding_pipe', desiredLen: len };
    }
    const curveType: ArrowArchetype = rand() < 0.5 ? 'c_clamp' : 's_curve';
    return {
      archetype: curveType,
      desiredLen: Math.min(
        cellsLeft,
        3 + (longCount < maxLongTarget && rand() < 0.35 ? 1 : 0)
      ),
    };
  }

  // Phase 2: Mid-board circuit weaving -> mix C-clamps, S-curves, medium pipes, and 2-cell key blockers
  if (fillRatioNow < 0.86 && cellsLeft >= 2) {
    if (shortCount === 0 && rand() < 0.65) {
      return { archetype: 'short_key', desiredLen: 2 };
    }
    const r = rand();
    if (longCount < maxLongTarget && r < 0.24 + complexityFactor * 0.14 && cellsLeft >= 4) {
      const len = Math.min(
        cellsLeft,
        4 + Math.floor(rand() * Math.max(1, maxLong - 4))
      );
      return { archetype: 'winding_pipe', desiredLen: len };
    }
    if ((r < 0.68 || mediumCount < 2) && cellsLeft >= 3) {
      const curveType: ArrowArchetype = rand() < 0.52 ? 'c_clamp' : 's_curve';
      return { archetype: curveType, desiredLen: Math.min(cellsLeft, 3) };
    }
    const allowOne = oneCellCount < maxOneCell && rand() < 0.15;
    return { archetype: 'short_key', desiredLen: allowOne ? 1 : 2 };
  }

  // Phase 3: Late cavity & gap filling -> 2-cell keys and 3-cell hooks first, 1-cell stubs sparingly
  if (cellsLeft >= 3 && shortCount >= 1 && rand() < 0.4) {
    return { archetype: rand() < 0.5 ? 'c_clamp' : 's_curve', desiredLen: 3 };
  }
  const allowOne =
    cellsLeft === 1 || (oneCellCount < maxOneCell && rand() < 0.3);
  return {
    archetype: 'short_key',
    desiredLen: cellsLeft >= 2 && !allowOne ? 2 : 1,
  };
}

function buildBoardAttempt(
  level: number,
  gridSize: number,
  targetOccupied: number,
  rules: ShapeRules,
  complexityFactor: number,
  rand: () => number
): AttemptMetrics {
  const placed: ArrowTile[] = [];
  const occupied = new Set<string>();
  const totalCells = gridSize * gridSize;
  const maxGuards = totalCells * 8;
  let guard = 0;
  let longCount = 0;
  let mediumCount = 0;
  let shortCount = 0;
  let oneCellCount = 0;
  const maxOneCellSoft = gridSize <= 5 ? 1 : Math.min(3, Math.floor(gridSize / 2) - 1);

  while (occupied.size < targetOccupied && guard < maxGuards) {
    guard += 1;

    const fillRatioNow = occupied.size / totalCells;
    const cellsLeft = totalCells - occupied.size;
    const { archetype, desiredLen } = pickArchetypeAndLength(
      gridSize,
      fillRatioNow,
      cellsLeft,
      complexityFactor,
      longCount,
      mediumCount,
      shortCount,
      oneCellCount,
      rand
    );

    // Compute live unblocked exit rays so new arrows actively intercept and gate earlier ones
    const rayHotspots = new Map<string, number>();
    for (const existing of placed) {
      if (!isArrowClear(placed, existing, gridSize)) continue;
      const head = existing.cells[existing.cells.length - 1];
      const ray = getRayCells(head.r, head.c, existing.dir, gridSize);
      for (const pt of ray) {
        const k = keyOf(pt.r, pt.c);
        rayHotspots.set(k, (rayHotspots.get(k) ?? 0) + 1);
      }
    }

    const headCandidates: Array<{
      hr: number;
      hc: number;
      pr: number;
      pc: number;
      dir: Direction;
      rayLen: number;
      canExtend: boolean;
      score: number;
    }> = [];

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (occupied.has(keyOf(r, c))) continue;

        for (const dir of DIRECTIONS) {
          const ray = getRayCells(r, c, dir, gridSize);
          if (ray.some((pt) => occupied.has(keyOf(pt.r, pt.c)))) continue;

          const { dr, dc } = DIR_DELTA[dir];
          const pr = r - dr;
          const pc = c - dc;
          const canExtend =
            pr >= 0 &&
            pr < gridSize &&
            pc >= 0 &&
            pc < gridSize &&
            !occupied.has(keyOf(pr, pc));

          const hotspot = rayHotspots.get(keyOf(r, c)) ?? 0;
          const preHotspot = canExtend ? rayHotspots.get(keyOf(pr, pc)) ?? 0 : 0;

          // Strongly discourage rayLen === 0 (border stubs) so later arrows can block earlier rays
          const rayScore =
            ray.length === 0
              ? -16
              : Math.min(gridSize - 1, ray.length) *
                (fillRatioNow < 0.72 ? 2.5 : 1.5);

          // Short keys strongly seek hotspots so they lock existing pipes
          const hotspotWeight =
            archetype === 'short_key'
              ? 4.8 + complexityFactor * 2.8
              : 2.5 + complexityFactor * 2.0;

          const score =
            rayScore +
            (hotspot + preHotspot) * hotspotWeight +
            (canExtend ? 2.5 : -6) +
            rand() * 1.25;

          headCandidates.push({
            hr: r,
            hc: c,
            pr,
            pc,
            dir,
            rayLen: ray.length,
            canExtend,
            score,
          });
        }
      }
    }

    if (headCandidates.length === 0) break;

    const extendablePool = headCandidates.filter((h) => h.canExtend);
    const usePool =
      desiredLen >= 2 && extendablePool.length > 0 ? extendablePool : headCandidates;

    usePool.sort((a, b) => b.score - a.score);
    const topSlice = Math.min(usePool.length, Math.max(2, Math.ceil(usePool.length * 0.25)));
    const start = usePool[Math.floor(rand() * topSlice)];

    if (desiredLen === 1 || !start.canExtend) {
      // Skip unnecessary 1-cell placements early unless we already tried many guards or truly lack space
      if (
        oneCellCount >= maxOneCellSoft &&
        extendablePool.length > 0 &&
        guard < maxGuards * 0.72
      ) {
        continue;
      }
      const singleCell: GridPoint[] = [{ r: start.hr, c: start.hc }];
      occupied.add(keyOf(start.hr, start.hc));
      oneCellCount += 1;
      shortCount += 1;
      placed.push({
        id: `L${level}-A${placed.length}`,
        cells: singleCell,
        dir: start.dir,
        state: 'idle',
      });
      continue;
    }

    const exitDelta = DIR_DELTA[start.dir];
    const exitRayKeys = new Set(
      getRayCells(start.hr, start.hc, start.dir, gridSize).map((pt) =>
        keyOf(pt.r, pt.c)
      )
    );

    const reversedCells: GridPoint[] = [
      { r: start.hr, c: start.hc },
      { r: start.pr, c: start.pc },
    ];
    const localUsed = new Set<string>([
      keyOf(start.hr, start.hc),
      keyOf(start.pr, start.pc),
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
        weight: number;
      }> = [];

      for (const dir of DIRECTIONS) {
        const { dr, dc } = DIR_DELTA[dir];
        const nr = curR + dr;
        const nc = curC + dc;
        if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;

        const k = keyOf(nr, nc);
        if (occupied.has(k) || localUsed.has(k)) continue;
        if (exitRayKeys.has(k)) continue;

        if (!rules.allowUTurns && -dr * exitDelta.dr + -dc * exitDelta.dc < 0) {
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

        // Count adjacent occupied cells (hugging existing structures eliminates empty gaps)
        let adjOccupied = 0;
        for (const d of DIRECTIONS) {
          const ar = nr + DIR_DELTA[d].dr;
          const ac = nc + DIR_DELTA[d].dc;
          if (occupied.has(keyOf(ar, ac))) adjOccupied += 1;
        }

        // Shape archetype routing preference
        let shapeWeight = 1.0;
        if (archetype === 'c_clamp') {
          if (!isStraight) {
            shapeWeight = bendCount === 0 || isUTurn ? 3.4 : 0.7;
          } else {
            shapeWeight = 0.85;
          }
        } else if (archetype === 's_curve') {
          if (!isStraight) {
            shapeWeight = bendCount === 0 || !isUTurn ? 3.2 : 0.65;
          } else {
            shapeWeight = 0.9;
          }
        } else if (archetype === 'winding_pipe') {
          shapeWeight = isStraight ? 1.05 : 2.6;
        } else {
          shapeWeight = isStraight ? 1.2 : 1.8;
        }

        const hotspotBonus = (rayHotspots.get(k) ?? 0) * (2.5 + complexityFactor * 2.2);
        const hugBonus = adjOccupied * (0.55 + complexityFactor * 0.45);

        neighbors.push({
          r: nr,
          c: nc,
          dr,
          dc,
          isBend: !isStraight,
          turnSign,
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

      reversedCells.push({ r: picked.r, c: picked.c });
      localUsed.add(keyOf(picked.r, picked.c));
      prevDr = picked.dr;
      prevDc = picked.dc;
      curR = picked.r;
      curC = picked.c;
    }

    const cells = reversedCells.reverse();
    if (!isCleanArrowShape(cells, start.dir, gridSize, rules)) {
      continue;
    }

    for (const pt of cells) {
      occupied.add(keyOf(pt.r, pt.c));
    }

    if (cells.length >= 4) longCount += 1;
    else if (cells.length === 3) mediumCount += 1;
    else shortCount += 1;

    placed.push({
      id: `L${level}-A${placed.length}`,
      cells,
      dir: start.dir,
      state: 'idle',
    });
  }

  const metrics = evaluatePuzzleComplexity(placed, gridSize);
  return {
    arrows: placed,
    occupiedCount: occupied.size,
    ...metrics,
  };
}

function scoreAttempt(
  attempt: AttemptMetrics,
  targetOccupied: number,
  gridSize: number,
  complexityFactor: number
): number {
  const occDeficit = Math.max(0, targetOccupied - attempt.occupiedCount);

  // Reward boards that achieve full coverage AND combine all 3 archetypes:
  // long winding pipes (4+ cells), C/S-curves (3 cells), and short key blockers (1-2 cells)
  const hasLong = attempt.longPipeCount >= (gridSize >= 5 ? 2 : 1) ? 1 : 0;
  const hasMedium = attempt.mediumCurveCount >= (gridSize >= 5 ? 2 : 1) ? 1 : 0;
  const hasShort = attempt.shortKeyCount >= (gridSize >= 5 ? 2 : 1) ? 1 : 0;
  const diversityBonus = (hasLong + hasMedium + hasShort) * 36;

  const oneCellCount = attempt.arrows.filter((a) => a.cells.length === 1).length;
  const maxOneCellIdeal = gridSize <= 5 ? 1 : Math.min(3, Math.floor(gridSize / 2) - 1);
  const oneCellPenalty = Math.max(0, oneCellCount - maxOneCellIdeal) * 20;

  const densityScore =
    attempt.occupiedCount * 11 -
    occDeficit * 35 -
    oneCellPenalty +
    attempt.longPipeCount * (12 + complexityFactor * 10) +
    attempt.mediumCurveCount * 7 +
    attempt.totalBends * (4 + complexityFactor * 4) +
    diversityBonus;

  // Strongly reward multi-layered extraction chains (high waves, tight opening)
  const interlockScore =
    attempt.waveCount * (24 + complexityFactor * 30) -
    attempt.initialFreeCount * (18 + complexityFactor * 22);

  return densityScore + interlockScore;
}

/**
 * Generates a deterministic, labyrinthine, guaranteed-solvable puzzle seeded strictly by `level`.
 * - Grid size scales strictly every 50 levels (1-50: 4x4, 51-100: 5x5, 101-150: 6x6, ...).
 * - Combines long winding pipes (4-6+ cells), interlocking C-shapes & S-curves, and short key blockers
 *   into densely packed, multi-layered circuit mazes with zero deadlocks.
 */
export function generateLevel(level: number): GeneratedLevel {
  const safeLevel = Math.max(1, Math.floor(level));
  const gridSize = getGridSizeForLevel(safeLevel);
  const difficulty = getLevelDifficulty(safeLevel);
  const rules = getShapeRulesForLevel(safeLevel);

  const tier = Math.floor((safeLevel - 1) / 50);
  const posInTier = (safeLevel - 1) % 50;
  const tierProgress = posInTier / 49;
  const complexityFactor = Math.min(1, (safeLevel - 1) / 160);

  const totalCells = gridSize * gridSize;
  const fillRatio = Math.min(0.98, 0.86 + tierProgress * 0.1 + Math.min(0.02, tier * 0.01));
  const targetOccupied = Math.min(totalCells, Math.round(totalCells * fillRatio));

  const baseSeed = (safeLevel * 0x9e3779b1 + 0x85ebca6b) >>> 0;
  let best = buildBoardAttempt(
    safeLevel,
    gridSize,
    targetOccupied,
    rules,
    complexityFactor,
    mulberry32(baseSeed)
  );
  let bestScore = scoreAttempt(best, targetOccupied, gridSize, complexityFactor);

  const attemptCount = safeLevel >= 51 ? 26 : 22;
  for (let attempt = 1; attempt < attemptCount; attempt++) {
    const candidate = buildBoardAttempt(
      safeLevel,
      gridSize,
      targetOccupied,
      rules,
      complexityFactor,
      mulberry32((baseSeed + attempt * 7919) >>> 0)
    );
    const candidateScore = scoreAttempt(
      candidate,
      targetOccupied,
      gridSize,
      complexityFactor
    );
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return {
    level: safeLevel,
    gridSize,
    difficulty,
    arrows: best.arrows,
  };
}
