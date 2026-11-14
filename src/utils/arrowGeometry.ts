import type { Direction, GridPoint } from '../types/game';

export const BOARD_VIEWBOX = 360;
export const BOARD_PAD = 16;
const BACK_EXT_LEN = 16;
const EXIT_EXT_LEN = 430;

interface Point2D {
  x: number;
  y: number;
}

export interface ArrowPolylineGeometry {
  pts: Point2D[];
  cumLen: number[];
  totalLen: number;
  backLen: number;
  bodyLen: number;
  tipTrim: number;
  restD: string;
  restHead: { x: number; y: number; angle: number };
}

export function buildGridDotsPath(gridSize: number, cellStep: number): string {
  const parts: string[] = [];
  for (let r = 0; r < gridSize; r++) {
    const y = (BOARD_PAD + r * cellStep + cellStep * 0.5).toFixed(2);
    for (let c = 0; c < gridSize; c++) {
      const x = (BOARD_PAD + c * cellStep + cellStep * 0.5).toFixed(2);
      parts.push(`M ${x} ${y} h 0.01`);
    }
  }
  return parts.join(' ');
}

export function cellCenter(pt: GridPoint, cellStep: number): Point2D {
  return {
    x: BOARD_PAD + pt.c * cellStep + cellStep * 0.5,
    y: BOARD_PAD + pt.r * cellStep + cellStep * 0.5,
  };
}

function dist2D(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Builds a densely sampled rounded-corner polyline extending slightly behind the tail
 * (for elastic rebound overshoot) and far past the head (for smooth flow escape).
 */
export function buildArrowGeometry(
  cells: GridPoint[],
  dir: Direction,
  cellStep: number
): ArrowPolylineGeometry {
  const centers = cells.map((pt) => cellCenter(pt, cellStep));
  const tipTrim = Math.min(8, cellStep * 0.16);
  const cornerRadius = Math.min(14, cellStep * 0.34);

  const dirX = dir === 'LEFT' ? -1 : dir === 'RIGHT' ? 1 : 0;
  const dirY = dir === 'UP' ? -1 : dir === 'DOWN' ? 1 : 0;

  if (centers.length === 1) {
    const center = centers[0];
    const tailOffset = Math.min(cellStep * 0.3, 22);
    const headOffset = Math.min(cellStep * 0.22, 14);
    const pStart: Point2D = {
      x: center.x - dirX * tailOffset,
      y: center.y - dirY * tailOffset,
    };
    const pHead: Point2D = {
      x: center.x + dirX * headOffset,
      y: center.y + dirY * headOffset,
    };
    const backPt: Point2D = {
      x: pStart.x - dirX * BACK_EXT_LEN,
      y: pStart.y - dirY * BACK_EXT_LEN,
    };
    const exitPt: Point2D = {
      x: pHead.x + dirX * EXIT_EXT_LEN,
      y: pHead.y + dirY * EXIT_EXT_LEN,
    };
    const bodyLen = tailOffset + headOffset;
    const pts: Point2D[] = [backPt, pStart, pHead, exitPt];
    const cumLen: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cumLen.push(cumLen[i - 1] + dist2D(pts[i - 1], pts[i]));
    }
    const totalLen = cumLen[cumLen.length - 1];
    const baseGeometry: ArrowPolylineGeometry = {
      pts,
      cumLen,
      totalLen,
      backLen: BACK_EXT_LEN,
      bodyLen,
      tipTrim,
      restD: '',
      restHead: { x: pHead.x, y: pHead.y, angle: 0 },
    };
    const restSlice = sliceArrowGeometry(baseGeometry, 0);
    baseGeometry.restD = restSlice.d;
    baseGeometry.restHead = {
      x: restSlice.headX,
      y: restSlice.headY,
      angle: restSlice.headAngle,
    };
    return baseGeometry;
  }

  // Back extension behind tail along initial segment
  const p0 = centers[0];
  const p1 = centers[1];
  const backDx = p0.x - p1.x;
  const backDy = p0.y - p1.y;
  const backMag = Math.hypot(backDx, backDy) || 1;
  const backPt: Point2D = {
    x: p0.x + (backDx / backMag) * BACK_EXT_LEN,
    y: p0.y + (backDy / backMag) * BACK_EXT_LEN,
  };

  // Sample body with rounded quadratic bends
  const bodyPts: Point2D[] = [p0];
  const lastIdx = centers.length - 1;

  for (let i = 1; i < lastIdx; i++) {
    const prev = centers[i - 1];
    const curr = centers[i];
    const next = centers[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y) || 1;

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y) || 1;

    // Straight continuation
    if (Math.abs(v1x * v2y - v1y * v2x) < 0.01) {
      bodyPts.push(curr);
      continue;
    }

    const r1 = Math.min(cornerRadius, len1 * 0.44);
    const r2 = Math.min(cornerRadius, len2 * 0.44);

    const before: Point2D = {
      x: curr.x - (v1x / len1) * r1,
      y: curr.y - (v1y / len1) * r1,
    };
    const after: Point2D = {
      x: curr.x + (v2x / len2) * r2,
      y: curr.y + (v2y / len2) * r2,
    };

    bodyPts.push(before);
    const steps = 8;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const omt = 1 - t;
      bodyPts.push({
        x: omt * omt * before.x + 2 * omt * t * curr.x + t * t * after.x,
        y: omt * omt * before.y + 2 * omt * t * curr.y + t * t * after.y,
      });
    }
    bodyPts.push(after);
  }

  const head = centers[lastIdx];
  bodyPts.push(head);

  // Compute exact body arc length
  let bodyLen = 0;
  for (let i = 1; i < bodyPts.length; i++) {
    bodyLen += dist2D(bodyPts[i - 1], bodyPts[i]);
  }

  // Forward exit extension along head's escape direction
  const exitPt: Point2D = {
    x: head.x + dirX * EXIT_EXT_LEN,
    y: head.y + dirY * EXIT_EXT_LEN,
  };

  // Assemble full continuous polyline: [backPt, ...bodyPts, exitPt]
  const pts: Point2D[] = [backPt, ...bodyPts, exitPt];
  const cumLen: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cumLen.push(cumLen[i - 1] + dist2D(pts[i - 1], pts[i]));
  }
  const totalLen = cumLen[cumLen.length - 1];

  const baseGeometry: ArrowPolylineGeometry = {
    pts,
    cumLen,
    totalLen,
    backLen: BACK_EXT_LEN,
    bodyLen,
    tipTrim,
    restD: '',
    restHead: { x: head.x, y: head.y, angle: 0 },
  };

  const restSlice = sliceArrowGeometry(baseGeometry, 0);
  baseGeometry.restD = restSlice.d;
  baseGeometry.restHead = {
    x: restSlice.headX,
    y: restSlice.headY,
    angle: restSlice.headAngle,
  };

  return baseGeometry;
}

function samplePointAt(
  geom: ArrowPolylineGeometry,
  targetDist: number
): { x: number; y: number; angle: number } {
  const { pts, cumLen, totalLen } = geom;
  const d = Math.max(0, Math.min(totalLen, targetDist));

  // Binary search segment containing d
  let lo = 0;
  let hi = cumLen.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumLen[mid] <= d) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const segStart = cumLen[lo];
  const segEnd = cumLen[lo + 1];
  const segLen = segEnd - segStart || 1;
  const t = Math.max(0, Math.min(1, (d - segStart) / segLen));

  const a = pts[lo];
  const b = pts[lo + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

/**
 * Slices the arrow along its own path at travel offset `offsetPx`.
 * - `offsetPx = 0`: resting state on its grid cells.
 * - `offsetPx > 0`: arrow flows forward around its bends and out along its exit vector.
 * - `offsetPx < 0`: elastic backward recoil during blocked bump.
 */
export function sliceArrowGeometry(
  geom: ArrowPolylineGeometry,
  offsetPx: number
): { d: string; headX: number; headY: number; headAngle: number } {
  const startDist = Math.max(0, geom.backLen + offsetPx);
  const headDist = Math.min(geom.totalLen, geom.backLen + offsetPx + geom.bodyLen);
  const stemEndDist = Math.max(startDist + 0.5, headDist - geom.tipTrim);

  const startPt = samplePointAt(geom, startDist);
  const endPt = samplePointAt(geom, stemEndDist);
  const headPt = samplePointAt(geom, headDist);

  let d = `M ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)}`;

  const { pts, cumLen } = geom;
  for (let i = 1; i < pts.length - 1; i++) {
    const len = cumLen[i];
    if (len > startDist && len < stemEndDist) {
      d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    }
  }

  d += ` L ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`;

  return {
    d,
    headX: headPt.x,
    headY: headPt.y,
    headAngle: headPt.angle,
  };
}
