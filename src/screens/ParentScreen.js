import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { openInMaps } from '../lib/maps';
import ChatScreen from './ChatScreen';

export default function ParentScreen() {
  const { signOut } = useAuth();
  const [lastLocation, setLastLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);

  useEffect(() => {
    loadLatest();

    // Lyssna på nya positioner och larm i realtid
    const channel = supabase
      .channel('parent-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, (payload) => {
        setLastLocation(payload.new);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        setAlerts((prev) => [payload.new, ...prev]);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  async function loadLatest() {
    const { data: loc } = await supabase
      .from('locations')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();
    setLastLocation(loc);

    const { data } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    setAlerts(data || []);
  }

  function handleDeleteAlert(id) {
    Alert.alert('Radera?', 'Vill du radera den här händelsen?', [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Radera',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('alerts').delete().eq('id', id);
          if (error) {
            Alert.alert('Kunde inte radera', error.message);
            return;
          }
          setAlerts((prev) => prev.filter((a) => a.id !== id));
        },
      },
    ]);
  }

  const minutesAgo = lastLocation
    ? Math.round((Date.now() - new Date(lastLocation.recorded_at)) / 60000)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Vilda 💜</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setChatVisible(true)}>
            <Text style={styles.chatLink}>💬 Chatt</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.logout}>Logga ut</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statusCard}>
        {lastLocation ? (
          <>
            <Text style={styles.statusLabel}>Senast sedd</Text>
            <Text style={styles.statusValue}>
              {minutesAgo === 0 ? 'Just nu' : `${minutesAgo} min sedan`}
            </Text>
            <Text style={styles.batteryText}>
              🔋 {lastLocation.battery_level ?? '–'}%
              {lastLocation.is_charging ? ' (laddar)' : ''}
            </Text>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => openInMaps(lastLocation.latitude, lastLocation.longitude, 'Vilda')}
            >
              <Text style={styles.mapButtonText}>📍 Visa på karta</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.statusValue}>Väntar på position...</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Larm & känslor</Text>
      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AlertRow item={item} onDelete={() => handleDeleteAlert(item.id)} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      <ChatScreen visible={chatVisible} onClose={() => setChatVisible(false)} />
    </View>
  );
}

function AlertRow({ item, onDelete }) {
  const isSos = item.alert_type === 'sos';
  return (
    <View style={[styles.eventRow, isSos ? styles.sosRow : styles.worriedRow]}>
      <Text style={styles.eventIcon}>{isSos ? '🚨' : '💛'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle}>{isSos ? 'LARM' : 'Känner sig orolig'}</Text>
        {item.feeling ? <Text style={styles.eventBody}>{item.feeling}</Text> : null}
        {item.note ? <Text style={styles.eventBody}>{item.note}</Text> : null}
      </View>
      <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
        <Text style={styles.deleteButtonText}>🗑</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#6D28D9' },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  chatLink: { color: '#7C3AED', fontSize: 14, fontWeight: '600' },
  logout: { color: '#7C3AED', fontSize: 14 },
  statusCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 24 },
  statusLabel: { color: '#7C3AED', fontSize: 14 },
  statusValue: { fontSize: 22, fontWeight: '600', marginTop: 4 },
  batteryText: { marginTop: 8, fontSize: 16, color: '#444' },
  mapButton: {
    backgroundColor: '#EDE9FE',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  mapButtonText: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#6D28D9' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10, color: '#4C1D95' },
  eventRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  sosRow: { backgroundColor: '#FEE2E2' },
  worriedRow: { backgroundColor: '#FEF3C7' },
  eventIcon: { fontSize: 22, marginRight: 10 },
  eventTitle: { fontWeight: '700', fontSize: 15 },
  eventBody: { fontSize: 14, color: '#333' },
  deleteButton: { padding: 8 },
  deleteButtonText: { fontSize: 18 },
});
