import { Stack } from 'expo-router';

import { colors } from '@/theme/colors';

export default function PassengerLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="home" options={{ title: 'Book a Ride' }} />
      <Stack.Screen
        name="active-ride"
        options={{ title: 'Active Trip', headerBackVisible: false }}
      />
    </Stack>
  );
}
