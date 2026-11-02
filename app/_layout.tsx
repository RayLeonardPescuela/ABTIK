import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

// Side effect: registers the driver background-location task at app startup so
// GPS streaming keeps working after the OS relaunches the app headless.
import '@/tasks/driverLocationTask';
import { AuthProvider } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'ABTIK' }} />
          <Stack.Screen name="role-select" options={{ title: 'Select Role' }} />
          <Stack.Screen name="(passenger)" options={{ headerShown: false }} />
          <Stack.Screen name="(driver)" options={{ headerShown: false }} />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
