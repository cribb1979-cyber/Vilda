import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { staticMapUrl } from '../lib/staticMap';

export default function ParentScreen() {
  const { signOut } = useAuth();
  const [lastLocation, setLastLocation] = useState(null);
  const [events, setEvents] = useState([]); // meddelanden + larm i en tidslinje

  useEffect(() => {
    loadLatest();

    // Lyssna på nya positioner, meddelanden och larm i realtid
    const channel = supabase
      .channel('parent-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, (payload) => {
        setLastLocation(payload.new);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setEvents((prev) => [{ type: 'message', ...payload.new }, ...prev]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        setEvents((prev) => [{ type: 'alert', ...payload.new }, ...prev]);
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

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    const { data: alerts } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    const combined = [
      ...(msgs || []).map((m) => ({ type: 'message', ...m })),
      ...(alerts || []).map((a) => ({ type: 'alert', ...a })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    setEvents(combined);
  }

  const minutesAgo = lastLocation
    ? Math.round((Date.now() - new Date(lastLocation.recorded_at)) / 60000)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Vilda 💜</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.logout}>Logga ut</Text>
        </TouchableOpacity>
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
          </>
        ) : (
          <Text style={styles.statusValue}>Väntar på position...</Text>
        )}
      </View>

      {lastLocation && (
        <Image
          style={styles.map}
          source={{ uri: staticMapUrl(lastLocation.latitude, lastLocation.longitude) }}
        />
      )}

      <Text style={styles.sectionTitle}>Senaste</Text>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventRow item={item} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

function EventRow({ item }) {
  if (item.type === 'alert') {
    const isSos = item.alert_type === 'sos';
    return (
      <View style={[styles.eventRow, isSos ? styles.sosRow : styles.worriedRow]}>
        <Text style={styles.eventIcon}>{isSos ? '🚨' : '💛'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle}>{isSos ? 'LARM' : 'Känner sig orolig'}</Text>
          {item.feeling ? <Text style={styles.eventBody}>{item.feeling}</Text> : null}
          {item.note ? <Text style={styles.eventBody}>{item.note}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.eventRow}>
      <Text style={styles.eventIcon}>💬</Text>
      <Text style={styles.eventBody}>{item.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#6D28D9' },
  logout: { color: '#7C3AED', fontSize: 14 },
  statusCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 24 },
  statusLabel: { color: '#7C3AED', fontSize: 14 },
  statusValue: { fontSize: 22, fontWeight: '600', marginTop: 4 },
  batteryText: { marginTop: 8, fontSize: 16, color: '#444' },
  map: { height: 220, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
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
});
