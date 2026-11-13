import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import type { GameSettings } from '../types/game';

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '=';
  }
  return out;
}

interface ToneNote {
  freqStart: number;
  freqEnd?: number;
  delaySec: number;
  durationSec: number;
  volume: number;
  wave?: 'sine' | 'triangle' | 'sawtooth';
}

function synthesizeWavDataUri(notes: ToneNote[], totalDurationSec: number): string {
  const sampleRate = 22050;
  const numSamples = Math.max(1, Math.floor(sampleRate * totalDurationSec));
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const mix = new Float32Array(numSamples);

  for (const note of notes) {
    const startIdx = Math.floor(note.delaySec * sampleRate);
    const lenSamples = Math.floor(note.durationSec * sampleRate);
    const freqEnd = note.freqEnd ?? note.freqStart;
    let phase = 0;

    for (let i = 0; i < lenSamples; i++) {
      const idx = startIdx + i;
      if (idx >= numSamples) break;
      const t = i / lenSamples;
      const freq = note.freqStart + (freqEnd - note.freqStart) * t;
      phase += (2 * Math.PI * freq) / sampleRate;

      let sample = Math.sin(phase);
      if (note.wave === 'triangle') {
        sample = (2 / Math.PI) * Math.asin(Math.sin(phase));
      } else if (note.wave === 'sawtooth') {
        const norm = (phase / (2 * Math.PI)) % 1;
        sample = 2 * norm - 1;
      }

      const attack = Math.min(1, i / Math.max(1, sampleRate * 0.012));
      const release = Math.pow(1 - t, 1.4);
      mix[idx] += sample * note.volume * attack * release;
    }
  }

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, mix[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  const base64 = bytesToBase64(new Uint8Array(buffer));
  return `data:audio/wav;base64,${base64}`;
}

type SfxKey = 'tap' | 'escape' | 'blocked' | 'hint' | 'reward' | 'levelClear';

class NativeFeedbackManager {
  private settings: GameSettings = {
    sfx: true,
    music: false,
    haptics: true,
  };
  private audioConfigured = false;
  private toneUris: Partial<Record<SfxKey, string>> = {};
  private musicInterval: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

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

  private ensureAudioMode(): void {
    if (this.audioConfigured) return;
    this.audioConfigured = true;
    setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
  }

  public unlock(): void {
    this.ensureAudioMode();
  }

  private playSfx(key: SfxKey, notes: ToneNote[], totalDurationSec: number): void {
    if (!this.settings.sfx) return;
    this.ensureAudioMode();
    try {
      if (!this.toneUris[key]) {
        this.toneUris[key] = synthesizeWavDataUri(notes, totalDurationSec);
      }
      const uri = this.toneUris[key]!;
      const player = createAudioPlayer(uri);
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          sub.remove();
          player.remove();
        }
      });
      player.play();
    } catch {
      // Ignore audio failures on simulators/unsupported devices
    }
  }

  public playTap(): void {
    if (this.settings.haptics) {
      Haptics.selectionAsync().catch(() => {});
    }
    this.playSfx(
      'tap',
      [{ freqStart: 520, freqEnd: 640, delaySec: 0, durationSec: 0.055, volume: 0.25 }],
      0.06
    );
  }

  public playEscape(): void {
    if (this.settings.haptics) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    this.playSfx(
      'escape',
      [
        {
          freqStart: 420,
          freqEnd: 880,
          delaySec: 0,
          durationSec: 0.13,
          volume: 0.35,
          wave: 'triangle',
        },
      ],
      0.14
    );
  }

  public playBlocked(): void {
    if (this.settings.haptics) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    this.playSfx(
      'blocked',
      [
        {
          freqStart: 165,
          freqEnd: 95,
          delaySec: 0,
          durationSec: 0.16,
          volume: 0.4,
          wave: 'sawtooth',
        },
      ],
      0.17
    );
  }

  public playHint(): void {
    if (this.settings.haptics) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    this.playSfx(
      'hint',
      [
        { freqStart: 660, delaySec: 0, durationSec: 0.18, volume: 0.28 },
        { freqStart: 990, delaySec: 0.06, durationSec: 0.2, volume: 0.28 },
      ],
      0.27
    );
  }

  public playReward(): void {
    if (this.settings.haptics) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    this.playSfx(
      'reward',
      [
        { freqStart: 987.77, delaySec: 0, durationSec: 0.18, volume: 0.26, wave: 'triangle' },
        { freqStart: 1318.51, delaySec: 0.05, durationSec: 0.18, volume: 0.26, wave: 'triangle' },
        { freqStart: 1567.98, delaySec: 0.1, durationSec: 0.2, volume: 0.26, wave: 'triangle' },
      ],
      0.32
    );
  }

  public playLevelClear(): void {
    if (this.settings.haptics) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    this.playSfx(
      'levelClear',
      [
        { freqStart: 523.25, delaySec: 0, durationSec: 0.26, volume: 0.28, wave: 'triangle' },
        { freqStart: 659.25, delaySec: 0.075, durationSec: 0.26, volume: 0.28, wave: 'triangle' },
        { freqStart: 783.99, delaySec: 0.15, durationSec: 0.26, volume: 0.28, wave: 'triangle' },
        { freqStart: 1046.5, delaySec: 0.225, durationSec: 0.34, volume: 0.3, wave: 'triangle' },
      ],
      0.58
    );
  }

  private startAmbientMusic(): void {
    if (this.musicInterval !== null) return;
    const chordProgression = [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
    ];

    const playChord = () => {
      if (!this.settings.music) return;
      this.ensureAudioMode();
      try {
        const chord = chordProgression[this.musicStep % chordProgression.length];
        this.musicStep += 1;
        const notes: ToneNote[] = chord.map((freq) => ({
          freqStart: freq,
          delaySec: 0,
          durationSec: 2.6,
          volume: 0.07,
          wave: 'sine',
        }));
        const uri = synthesizeWavDataUri(notes, 2.7);
        const player = createAudioPlayer(uri);
        const sub = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) {
            sub.remove();
            player.remove();
          }
        });
        player.play();
      } catch {
        // Ignore ambient audio failure
      }
    };

    playChord();
    this.musicInterval = setInterval(playChord, 2800);
  }

  private stopAmbientMusic(): void {
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }
}

export const feedback = new NativeFeedbackManager();
