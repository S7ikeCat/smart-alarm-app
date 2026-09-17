import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { RootTabParamList, SchedulesStackParamList } from './types';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { SchedulesScreen } from '../screens/schedules/SchedulesScreen';
import { CreateScheduleScreen } from '../screens/schedules/CreateScheduleScreen';
import { ToolsScreen } from '../screens/tools/ToolsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { colors } from '../theme/colors';

import { Calendar, CalendarRange, Timer, Settings } from 'lucide-react-native';

import { ConfigureScheduleScreen } from '../screens/schedules/ConfigureScheduleScreen';

import { CustomPatternScreen } from '../screens/schedules/CustomPatternScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();
const SchedulesStack = createNativeStackNavigator<SchedulesStackParamList>();

function SchedulesStackNavigator() {
  return (
    <SchedulesStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
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

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
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
  component={CalendarScreen}
  options={{
    title: 'Календарь',
    tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
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