import 'react-native-gesture-handler';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import AppRoot from './src/App';

SplashScreen.preventAutoHideAsync().catch(() => {});

interface ErrorBoundaryState {
  hasError: boolean;
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    SplashScreen.hideAsync().catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Arrow Escape</Text>
          <Text style={styles.errorSubtitle}>
            Something went wrong while loading the game.
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => this.setState({ hasError: false })}
            style={styles.retryBtn}
          >
            <Text style={styles.retryBtnText}>Reload Game</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootErrorBoundary>
          <AppRoot />
        </RootErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F8FC',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#F5F8FC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  errorSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 20,
    backgroundColor: '#2589FF',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
