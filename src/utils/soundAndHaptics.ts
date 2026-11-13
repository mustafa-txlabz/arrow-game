import type { GameSettings } from '../types/game';

class FeedbackManager {
  private ctx: AudioContext | null = null;
  private musicInterval: number | null = null;
  private settings: GameSettings = {
    sfx: true,
    music: false,
    haptics: true,
  };

  public updateSettings(next: GameSettings): void {
    const musicChanged = next.music !== this.settings.music;
    this.settings = next;
    if (musicChanged) {
      if (next.music) {
        this.startAmbientMusic();
      } else {
        this.stopAmbientMusic();
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    this.getAudioContext();
  }

  public vibrate(pattern: number | number[]): void {
    if (!this.settings.haptics) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore on unsupported devices
      }
    }
  }

  public playTap(): void {
    this.vibrate(8);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.04);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playEscape(): void {
    this.vibrate(12);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.11);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playBlocked(): void {
    this.vibrate([25, 30, 25]);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, now);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playHint(): void {
    this.vibrate(10);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.06;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.23);
    });
  }

  public playReward(): void {
    this.vibrate([10, 20, 15]);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [987.77, 1318.51, 1567.98].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.05;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  }

  public playLevelClear(): void {
    this.vibrate([15, 30, 15, 30, 35]);
    if (!this.settings.sfx) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.075;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  private startAmbientMusic(): void {
    if (this.musicInterval !== null || typeof window === 'undefined') return;
    const chordProgression = [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
    ];
    let step = 0;

    const playChord = () => {
      if (!this.settings.music) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const chord = chordProgression[step % chordProgression.length];
      step += 1;

      chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.018, now + 0.6);
        gain.gain.linearRampToValueAtTime(0.0001, now + 2.7);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 2.8);
      });
    };

    playChord();
    this.musicInterval = window.setInterval(playChord, 2800);
  }

  private stopAmbientMusic(): void {
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }
}

export const feedback = new FeedbackManager();
