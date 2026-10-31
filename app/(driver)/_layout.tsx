import { Stack } from 'expo-router';

import { colors } from '@/theme/colors';

export default function DriverLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="dashboard" options={{ title: 'Driver Dashboard' }} />
      <Stack.Screen
        name="trip"
        options={{ title: 'Active Trip', headerBackVisible: false }}
      />
    </Stack>
  );
}
