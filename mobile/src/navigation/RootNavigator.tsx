import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { PermissionsOnboardingScreen } from '../screens/onboarding/PermissionsOnboardingScreen';
import { checkAllPermissions } from '../native/permissions';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { RootTabParamList, SchedulesStackParamList, CalendarStackParamList } from './types';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { AddEventScreen } from '../screens/calendar/AddEventScreen';
import { SchedulesScreen } from '../screens/schedules/SchedulesScreen';
import { CreateScheduleScreen } from '../screens/schedules/CreateScheduleScreen';
import { ConfigureScheduleScreen } from '../screens/schedules/ConfigureScheduleScreen';
import { CustomPatternScreen } from '../screens/schedules/CustomPatternScreen';
import { ExtraAlarmsScreen } from '../screens/alarms/ExtraAlarmsScreen';
import { ToolsScreen } from '../screens/tools/ToolsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { colors } from '../theme/colors';

import { Calendar, CalendarRange, Timer, Settings, AlarmClock } from 'lucide-react-native';

const Tab = createBottomTabNavigator<RootTabParamList>();
const SchedulesStack = createNativeStackNavigator<SchedulesStackParamList>();
const CalendarStack = createNativeStackNavigator<CalendarStackParamList>();

function SchedulesStackNavigator() {
  return (
    <SchedulesStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <SchedulesStack.Screen
        name="SchedulesList"
        component={SchedulesScreen}
        options={{ title: 'Графики' }}
      />
      <SchedulesStack.Screen
        name="CreateSchedule"
        component={CreateScheduleScreen}
        options={{ title: 'Создать график' }}
      />
      <SchedulesStack.Screen
        name="CustomPattern"
        component={CustomPatternScreen}
        options={{ title: 'Свой график' }}
      />
      <SchedulesStack.Screen
        name="ConfigureSchedule"
        component={ConfigureScheduleScreen}
        options={{ title: 'Настройка графика' }}
      />
    </SchedulesStack.Navigator>
  );
}

function CalendarStackNavigator() {
  return (
    <CalendarStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <CalendarStack.Screen
        name="CalendarMain"
        component={CalendarScreen}
        options={{ headerShown: false }}
      />
      <CalendarStack.Screen
        name="AddEvent"
        component={AddEventScreen}
        options={{ title: 'Новое событие' }}
      />
    </CalendarStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          sceneStyle: { backgroundColor: colors.background },
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        }}
      >
        <Tab.Screen
          name="Calendar"
          component={CalendarStackNavigator}
          options={{
            title: 'Календарь',
            tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Alarms"
          component={ExtraAlarmsScreen}
          options={{
            title: 'Будильники',
            tabBarIcon: ({ color, size }) => <AlarmClock color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Schedules"
          component={SchedulesStackNavigator}
          options={{
            title: 'Графики',
            tabBarIcon: ({ color, size }) => <CalendarRange color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Tools"
          component={ToolsScreen}
          options={{
            title: 'Инструменты',
            tabBarIcon: ({ color, size }) => <Timer color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Настройки',
            tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}


/**
 * Входная точка: пока не выданы все разрешения, вместо вкладок показываем
 * экран настройки. Он появляется при каждом запуске, если чего-то не хватает
 * (и вернётся, если разрешение потом отозвать), а не только в первый раз.
 */
export function RootNavigator() {
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    checkAllPermissions().then(state => setNeedsOnboarding(!state.requiredGranted));
  }, []);

  if (needsOnboarding === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (needsOnboarding) {
    return <PermissionsOnboardingScreen onFinish={() => setNeedsOnboarding(false)} />;
  }

  return <AppNavigator />;
}