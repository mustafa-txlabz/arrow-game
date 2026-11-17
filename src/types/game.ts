export type ScreenView = 'home' | 'game';

export type Direction = 'UP' | 'RIGHT' | 'DOWN' | 'LEFT';

export type Difficulty = 'Easy' | 'Normal' | 'Hard' | 'Master';

export interface GridPoint {
  r: number;
  c: number;
}

export interface ArrowTile {
  id: string;
  /** Ordered sequence of connected grid cells from tail (index 0) to head (last index) */
  cells: GridPoint[];
  /** Escape direction from the head cell */
  dir: Direction;
  /** Transient animation state on the board */
  state: 'idle' | 'escaping' | 'blocked' | 'penalty_shake';
  /** Persistent red state once an arrow has collided with an obstacle */
  isBlocked?: boolean;
  /** Exact pixel distance along path to travel before hitting blocker */
  bumpDistancePx?: number;
  /** Distance-scaled duration in ms for blocked slide + rebound */
  bumpDurationMs?: number;
}

export interface GeneratedLevel {
  level: number;
  gridSize: number;
  difficulty: Difficulty;
  arrows: ArrowTile[];
}

export interface GameSettings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
}

export interface PlayerProgress {
  currentLevel: number;
  highestUnlockedLevel: number;
  hints: number;
  lastDailyClaimDate: string | null;
  dailyStreak: number;
}

export type AdPlacement =
  | 'rewarded_hint'
  | 'rewarded_revive'
  | 'rewarded_victory_bonus'
  | 'interstitial_level';

