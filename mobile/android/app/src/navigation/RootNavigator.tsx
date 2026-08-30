import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { RootTabParamList, SchedulesStackParamList } from '../../src/main/navigation/types';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { SchedulesScreen } from '../screens/schedules/SchedulesScreen';
import { CreateScheduleScreen } from '../screens/schedules/CreateScheduleScreen';
import { ToolsScreen } from '../screens/tools/ToolsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();
const SchedulesStack = createNativeStackNavigator<SchedulesStackParamList>();

/**
 * Стек-навигатор для вкладки "Графики" — список графиков + экран создания.
 * Отдельная функция, а не инлайн внутри Tab.Screen, чтобы не захламлять
 * основной навигатор вложенной конфигурацией.
 */
function SchedulesStackNavigator() {
  return (
    <SchedulesStack.Navigator>
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
    </SchedulesStack.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen
          name="Calendar"
          component={CalendarScreen}
          options={{ title: 'Календарь' }}
        />
        <Tab.Screen
          name="Schedules"
          component={SchedulesStackNavigator}
          options={{ title: 'Графики' }}
        />
        <Tab.Screen name="Tools" component={ToolsScreen} options={{ title: 'Инструменты' }} />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Настройки' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}