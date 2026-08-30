import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function CreateScheduleScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Создать график</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
});