import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { openInMaps } from '../lib/maps';
import { fetchAppDisplayName } from '../lib/appSettings';
import { startGeofencing } from '../lib/geofencing';
import { getDistanceMeters, formatDistance } from '../lib/distance';
import ChatScreen from './ChatScreen';
import SettingsScreen from './SettingsScreen';
import FamilyMapScreen from './FamilyMapScreen';
import SavedPlaceScreen from './SavedPlaceScreen';
import PlacesListScreen from './PlacesListScreen';

export default function ParentScreen() {
  const { signOut, profile } = useAuth();
  const [lastLocation, setLastLocation] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [familyMapVisible, setFamilyMapVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
  const [placesListVisible, setPlacesListVisible] = useState(false);
  const [addTransferVisible, setAddTransferVisible] = useState(false);
  const [displayName, setDisplayName] = useState('Vilda');
  const [childName, setChildName] = useState('');
  const [todayNote, setTodayNote] = useState(null);
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    loadLatest();
    loadTodayNote();
    fetchAppDisplayName().then(setDisplayName);
    if (profile?.location_sharing_enabled) refreshHomeGeofencing();

    supabase
      .from('saved_places')
      .select('*')
      .in('label', ['hem', 'skola'])
      .then(({ data }) => setPlaces(data || []));

    const todayNoteChannel = supabase
      .channel('today-note-parent')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'today_note' }, (payload) => {
        setTodayNote(payload.new?.content || null);
      })
      .subscribe();

    supabase
      .from('profiles')
      .select('display_name')
      .eq('role', 'child')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setChildName(data?.display_name || ''));

    const settingsChannel = supabase
      .channel('app-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
        setDisplayName(payload.new?.display_name || 'Vilda');
      })
      .subscribe();

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

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(settingsChannel);
      supabase.removeChannel(todayNoteChannel);
    };
  }, []);

  async function refreshHomeGeofencing() {
    const { data } = await supabase.from('saved_places').select('*').eq('label', 'hem').maybeSingle();
    if (data) startGeofencing([data]);
  }

  async function loadTodayNote() {
    const { data } = await supabase.from('today_note').select('*').eq('id', 1).maybeSingle();
    setTodayNote(data?.content || null);
  }

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

  const locationStatus = (() => {
    if (!lastLocation) return null;
    for (const place of places) {
      const distance = getDistanceMeters(
        lastLocation.latitude,
        lastLocation.longitude,
        place.latitude,
        place.longitude
      );
      if (distance <= (place.radius_meters || 100)) {
        return place.label === 'hem' ? '🏠 Hemma' : '🏫 I skolan';
      }
    }
    const home = places.find((p) => p.label === 'hem');
    if (home) {
      const distance = getDistanceMeters(
        lastLocation.latitude,
        lastLocation.longitude,
        home.latitude,
        home.longitude
      );
      return `📍 Ute, ${formatDistance(distance)} från hemmet`;
    }
    return '📍 Ute';
  })();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{displayName} 💜</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setChatVisible(true)}>
            <Text style={styles.chatLink}>💬 Chatt</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsVisible(true)}>
            <Text style={styles.chatLink}>⚙️</Text>
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
            {locationStatus && <Text style={styles.statusBadge}>{locationStatus}</Text>}
            <Text style={styles.batteryText}>
              🔋 {lastLocation.battery_level ?? '–'}%
              {lastLocation.is_charging ? ' (laddar)' : ''}
            </Text>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => openInMaps(lastLocation.latitude, lastLocation.longitude, childName || 'Barnet')}
            >
              <Text style={styles.mapButtonText}>📍 Visa på karta</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.statusValue}>Väntar på position...</Text>
        )}
      </View>

      {todayNote && (
        <View style={styles.todayCard}>
          <Text style={styles.todayLabel}>📅 Dagens notering</Text>
          <Text style={styles.todayText}>{todayNote}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.familyMapButton} onPress={() => setFamilyMapVisible(true)}>
        <Text style={styles.familyMapButtonText}>🗺️ Familjekarta</Text>
      </TouchableOpacity>

      <View style={styles.placeRow}>
        <TouchableOpacity style={styles.addFriendButton} onPress={() => setAddFriendVisible(true)}>
          <Text style={styles.addFriendButtonText}>📍 Lägg till plats</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addFriendButton} onPress={() => setPlacesListVisible(true)}>
          <Text style={styles.addFriendButtonText}>📋 Mina platser</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.addTransferButton} onPress={() => setAddTransferVisible(true)}>
        <Text style={styles.addFriendButtonText}>🚏 Lägg till bytesplats</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Larm & känslor</Text>
      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AlertRow item={item} onDelete={() => handleDeleteAlert(item.id)} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      <ChatScreen visible={chatVisible} onClose={() => setChatVisible(false)} />
      <SettingsScreen visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <FamilyMapScreen visible={familyMapVisible} onClose={() => setFamilyMapVisible(false)} />
      <SavedPlaceScreen
        visible={addFriendVisible}
        onClose={() => setAddFriendVisible(false)}
        onSaved={() => {}}
        label="plats"
        icon="📍"
        title="Lägg till plats"
        name="Platsen"
        allowMultiple
      />
      <SavedPlaceScreen
        visible={addTransferVisible}
        onClose={() => setAddTransferVisible(false)}
        onSaved={() => {}}
        label="byte"
        icon="🚏"
        title="Lägg till bytesplats"
        name="Bytesplatsen"
        allowMultiple
      />
      <PlacesListScreen visible={placesListVisible} onClose={() => setPlacesListVisible(false)} />
    </View>
  );
}

function AlertRow({ item, onDelete }) {
  const isSos = item.alert_type === 'sos';
  const isByteStuck = item.alert_type === 'byte_stuck';
  const icon = isSos ? '🚨' : isByteStuck ? '🚏' : '💛';
  const title = isSos ? 'LARM' : isByteStuck ? 'Kvar vid bytet' : 'Känner sig orolig';

  return (
    <View style={[styles.eventRow, isSos ? styles.sosRow : styles.worriedRow]}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle}>{title}</Text>
        {item.feeling ? <Text style={styles.eventBody}>{item.feeling}</Text> : null}
        {item.note && !isByteStuck ? <Text style={styles.eventBody}>{item.note}</Text> : null}
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
  statusBadge: { fontSize: 15, fontWeight: '600', color: '#6D28D9', marginTop: 6 },
  batteryText: { marginTop: 8, fontSize: 16, color: '#444' },
  mapButton: {
    backgroundColor: '#EDE9FE',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  mapButtonText: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#6D28D9' },
  todayCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  todayLabel: { color: '#92400E', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  todayText: { color: '#78350F', fontSize: 16, fontWeight: '500' },
  familyMapButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  familyMapButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#6D28D9' },
  placeRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  addFriendButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  addTransferButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  addFriendButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#6D28D9' },
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
