import { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Check,
  Gift,
  Lightbulb,
  Music,
  Smartphone,
  Volume2,
  X,
} from 'lucide-react-native';
import type { GameSettings } from '../types/game';

interface SettingsModalProps {
  open: boolean;
  settings: GameSettings;
  onUpdateSettings: (next: GameSettings) => void;
  onResetProgress: () => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  settings,
  onUpdateSettings,
  onResetProgress,
  onClose,
}: SettingsModalProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const toggle = (key: keyof GameSettings) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => {
        setConfirmReset(false);
        onClose();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.settingsHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity
              onPress={() => {
                setConfirmReset(false);
                onClose();
              }}
              accessibilityLabel="Close settings"
              style={styles.closeBtn}
            >
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <View style={styles.rowsContainer}>
            {/* Audio SFX */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => toggle('sfx')}
              style={styles.settingRow}
            >
              <View style={styles.rowLeft}>
                <Volume2 size={20} color="#2589FF" />
                <Text style={styles.rowLabel}>Audio SFX</Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  settings.sfx
                    ? { backgroundColor: '#2589FF', alignItems: 'flex-end' }
                    : { backgroundColor: '#CBD5E1', alignItems: 'flex-start' },
                ]}
              >
                <View style={styles.switchThumb} />
              </View>
            </TouchableOpacity>

            {/* Ambient Music */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => toggle('music')}
              style={styles.settingRow}
            >
              <View style={styles.rowLeft}>
                <Music size={20} color="#10B981" />
                <Text style={styles.rowLabel}>Ambient Music</Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  settings.music
                    ? { backgroundColor: '#10B981', alignItems: 'flex-end' }
                    : { backgroundColor: '#CBD5E1', alignItems: 'flex-start' },
                ]}
              >
                <View style={styles.switchThumb} />
              </View>
            </TouchableOpacity>

            {/* Haptics */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => toggle('haptics')}
              style={styles.settingRow}
            >
              <View style={styles.rowLeft}>
                <Smartphone size={20} color="#F43F5E" />
                <Text style={styles.rowLabel}>Haptics</Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  settings.haptics
                    ? { backgroundColor: '#F43F5E', alignItems: 'flex-end' }
                    : { backgroundColor: '#CBD5E1', alignItems: 'flex-start' },
                ]}
              >
                <View style={styles.switchThumb} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Inline Reset Confirmation */}
          <View style={styles.resetDivider}>
            {!confirmReset ? (
              <TouchableOpacity
                onPress={() => setConfirmReset(true)}
                style={styles.resetTrigger}
              >
                <Text style={styles.resetTriggerText}>Reset Saved Progress</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  onPress={() => setConfirmReset(false)}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    onResetProgress();
                    setConfirmReset(false);
                    onClose();
                  }}
                  style={styles.confirmResetBtn}
                >
                  <Text style={styles.confirmResetText}>Confirm Reset</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface DailyBonusModalProps {
  open: boolean;
  canClaim: boolean;
  streak: number;
  onClaim: (hintsEarned: number) => void;
  onClose: () => void;
}

export function DailyBonusModal({
  open,
  canClaim,
  streak,
  onClaim,
  onClose,
}: DailyBonusModalProps) {
  const nextDay = (streak % 7) + 1;
  const hintReward = nextDay === 7 ? 2 : 1;

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, styles.centeredCard]}>
          <View style={styles.closeRow}>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Close daily bonus"
              style={styles.closeBtn}
            >
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <View style={styles.giftBadge}>
            <Gift size={28} color="#10B981" />
          </View>

          <Text style={[styles.modalTitle, styles.dailyTitle]}>Daily Bonus</Text>
          <Text style={styles.dailySubtitle}>
            {canClaim
              ? `Day ${nextDay} reward is ready to claim`
              : 'Today’s bonus has been claimed. Come back tomorrow!'}
          </Text>

          {/* 7-day mini streak tracker */}
          <View style={styles.streakGrid}>
            {Array.from({ length: 7 }).map((_, idx) => {
              const dayNum = idx + 1;
              const claimedDay = canClaim
                ? dayNum <= streak % 7
                : dayNum <= ((streak - 1) % 7) + 1;
              const isToday = canClaim && dayNum === nextDay;

              return (
                <View
                  key={dayNum}
                  style={[
                    styles.streakCell,
                    isToday
                      ? styles.streakToday
                      : claimedDay
                        ? styles.streakClaimed
                        : styles.streakPending,
                  ]}
                >
                  {claimedDay ? (
                    <Check size={14} color="#059669" strokeWidth={2.5} />
                  ) : (
                    <Text
                      style={[
                        styles.streakDayText,
                        isToday && { color: '#047857' },
                      ]}
                    >
                      D{dayNum}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.rewardPill}>
            <Lightbulb size={20} color="#2589FF" />
            <Text style={styles.rewardText}>
              +{hintReward} Hint{hintReward > 1 ? 's' : ''}
            </Text>
          </View>

          {canClaim ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onClaim(hintReward)}
              style={styles.claimBtnOuter}
            >
              <LinearGradient
                colors={['#2589FF', '#10B981']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.claimBtn}
              >
                <Text style={styles.claimBtnText}>Claim Reward</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[styles.claimBtnOuter, styles.claimedBtn]}>
              <Text style={styles.claimedBtnText}>Claimed Today</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 10,
  },
  centeredCard: {
    alignItems: 'center',
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeRow: {
    width: '100%',
    alignItems: 'flex-end',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowsContainer: {
    marginTop: 20,
    gap: 12,
  },
  settingRow: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#F5F8FC',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  resetDivider: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 16,
  },
  resetTrigger: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  resetTriggerText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  confirmResetBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F43F5E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmResetText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  giftBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dailyTitle: {
    fontSize: 22,
    marginTop: 12,
  },
  dailySubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  streakGrid: {
    marginTop: 20,
    width: '100%',
    flexDirection: 'row',
    gap: 6,
  },
  streakCell: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakToday: {
    borderColor: '#34D399',
    backgroundColor: '#ECFDF5',
  },
  streakClaimed: {
    borderColor: '#E2E8F0',
    backgroundColor: '#F1F5F9',
  },
  streakPending: {
    borderColor: 'rgba(226, 232, 240, 0.7)',
    backgroundColor: '#F5F8FC',
  },
  streakDayText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  rewardPill: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  rewardText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2589FF',
    fontVariant: ['tabular-nums'],
  },
  claimBtnOuter: {
    marginTop: 20,
    width: '100%',
    height: 48,
    borderRadius: 16,
    overflow: 'hidden',
  },
  claimBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  claimedBtn: {
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimedBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94A3B8',
  },
});
