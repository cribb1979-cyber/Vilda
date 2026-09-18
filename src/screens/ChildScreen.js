import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as Speech from 'expo-speech';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { startGeofencing } from '../lib/geofencing';
import { startBackgroundLocationTracking } from '../lib/backgroundLocation';
import { callNumber, openWalkingDirections } from '../lib/maps';
import { getDistanceMeters, formatDistance } from '../lib/distance';
import { fetchAppDisplayName, fetchAiChatEnabled } from '../lib/appSettings';
import SavedPlaceScreen from './SavedPlaceScreen';
import ChatScreen from './ChatScreen';
import FamilyMapScreen from './FamilyMapScreen';
import LostScreen from './LostScreen';
import AIChatScreen from './AIChatScreen';

const FEELINGS = [
  { key: 'vilse', label: '🧭 Jag är vilse' },
  { key: 'laskigt', label: '😟 Det är läskigt här' },
  { key: 'missade_hallplats', label: '🚌 Jag missade hållplatsen' },
  { key: 'ensam', label: '😔 Jag känner mig ensam' },
];

const CALM_MESSAGE =
  'Du är trygg. Pappa ser var du är och kommer hjälpa dig. Andas lugnt, ett andetag i taget.';

export default function ChildScreen() {
  const { profile, signOut } = useAuth();
  const [worriedVisible, setWorriedVisible] = useState(false);
  const [setHomeVisible, setSetHomeVisible] = useState(false);
  const [setSchoolVisible, setSetSchoolVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [homeDirection, setHomeDirection] = useState(null); // { bearingLabel, distanceMeters }
  const [todayNote, setTodayNote] = useState(null);
  const [familyMapVisible, setFamilyMapVisible] = useState(false);
  const [lostVisible, setLostVisible] = useState(false);
  const [aiChatVisible, setAiChatVisible] = useState(false);
  const [aiChatEnabled, setAiChatEnabled] = useState(false);
  const [appName, setAppName] = useState('Vilda');
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    startTracking();
    refreshGeofencing();
    loadTodayNote();
    fetchAppDisplayName().then(setAppName);
    fetchAiChatEnabled().then(setAiChatEnabled);

    const channel = supabase
      .channel('today-note-child')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'today_note' }, (payload) => {
        setTodayNote(payload.new?.content || null);
      })
      .subscribe();

    const appSettingsChannel = supabase
      .channel('app-settings-child')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
        setAiChatEnabled(payload.new?.ai_chat_enabled || false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(appSettingsChannel);
    };
  }, []);

  async function loadTodayNote() {
    const { data } = await supabase.from('today_note').select('*').eq('id', 1).maybeSingle();
    setTodayNote(data?.content || null);
  }

  async function handleCallParent() {
    const { data: parent } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('role', 'parent')
      .not('phone_number', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!parent?.phone_number) {
      Alert.alert('Inget nummer sparat', 'Pappa har inte lagt in sitt telefonnummer än.');
      return;
    }
    callNumber(parent.phone_number);
  }

  async function handleDirections(label, placeName) {
    const { data: place } = await supabase
      .from('saved_places')
      .select('*')
      .eq('label', label)
      .maybeSingle();

    if (!place) {
      Alert.alert(`Ingen ${placeName} sparad`, `Tryck på "Ställ in ${placeName}" för att välja platsen.`);
      return;
    }
    openWalkingDirections(place.latitude, place.longitude, placeName);
  }

  async function refreshGeofencing() {
    const { data } = await supabase.from('saved_places').select('*').in('label', ['hem', 'skola']);
    if (data?.length) startGeofencing(data);
  }

  async function startTracking() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    // Skicka en position direkt, sen tar bakgrundsspårningen över
    // (fortsätter även när appen är stängd eller telefonen låst).
    sendLocationUpdate();
    startBackgroundLocationTracking();
  }

  async function sendLocationUpdate() {
    const loc = await Location.getCurrentPositionAsync({});
    const batteryLevel = await Battery.getBatteryLevelAsync();
    const batteryState = await Battery.getBatteryStateAsync();

    await supabase.from('locations').insert({
      user_id: profile.id,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      battery_level: Math.round(batteryLevel * 100),
      is_charging: batteryState === Battery.BatteryState.CHARGING,
    });
  }

  async function handleSos() {
    const loc = await Location.getCurrentPositionAsync({});
    await supabase.from('alerts').insert({
      user_id: profile.id,
      alert_type: 'sos',
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
    pulseAnimation();
  }

  function pulseAnimation() {
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.15, duration: 150, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }

  async function handleFeelingPress(feeling) {
    if (feeling.key === 'vilse') {
      setWorriedVisible(false);
      setLostVisible(true);
      return;
    }

    const loc = await Location.getCurrentPositionAsync({});
    await supabase.from('alerts').insert({
      user_id: profile.id,
      alert_type: 'worried',
      feeling: feeling.label,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
    setWorriedVisible(false);
  }

  function playCalmMessage() {
    Speech.speak(CALM_MESSAGE, { language: 'sv-SE', rate: 0.92 });
  }

  async function findWayHome() {
    const loc = await Location.getCurrentPositionAsync({});
    const { data: home } = await supabase
      .from('saved_places')
      .select('*')
      .eq('label', 'hem')
      .maybeSingle();

    if (!home) {
      Alert.alert('Ingen hemplats sparad', 'Tryck på "Ställ in hem" för att välja var ni bor.');
      return;
    }

    const distance = getDistanceMeters(
      loc.coords.latitude,
      loc.coords.longitude,
      home.latitude,
      home.longitude
    );
    const bearing = getBearing(
      loc.coords.latitude,
      loc.coords.longitude,
      home.latitude,
      home.longitude
    );

    setHomeDirection({
      arrow: bearingToArrow(bearing),
      distanceLabel: formatDistance(distance),
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hej {profile?.display_name}! 💜</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setChatVisible(true)}>
            <Text style={styles.chatLink}>💬 Chatt</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.logout}>Logga ut</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.helper}>Pappa ser var du är just nu 📍</Text>

      <TouchableOpacity style={styles.mapButton} onPress={() => setFamilyMapVisible(true)}>
        <Text style={styles.mapButtonText}>🗺️ Familjekarta</Text>
      </TouchableOpacity>
      <FamilyMapScreen visible={familyMapVisible} onClose={() => setFamilyMapVisible(false)} />

      {aiChatEnabled && (
        <TouchableOpacity style={styles.aiButton} onPress={() => setAiChatVisible(true)}>
          <Text style={styles.aiButtonText}>🤖 {appName} AI</Text>
        </TouchableOpacity>
      )}
      <AIChatScreen
        visible={aiChatVisible}
        onClose={() => setAiChatVisible(false)}
        onEmergency={() => {
          setAiChatVisible(false);
          setLostVisible(true);
        }}
        appName={appName}
      />

      {todayNote && (
        <View style={styles.todayCard}>
          <Text style={styles.todayLabel}>📅 Idag</Text>
          <Text style={styles.todayText}>{todayNote}</Text>
        </View>
      )}

      {homeDirection && (
        <View style={styles.homeCard}>
          <Text style={styles.homeArrow}>{homeDirection.arrow}</Text>
          <Text style={styles.homeDistance}>{homeDirection.distanceLabel} den vägen</Text>
        </View>
      )}

      <TouchableOpacity style={styles.findHomeButton} onPress={findWayHome}>
        <Text style={styles.findHomeText}>🧭 Hjälp mig hitta hem</Text>
      </TouchableOpacity>

      <View style={styles.placeButtonRow}>
        <TouchableOpacity style={styles.setHomeButton} onPress={() => setSetHomeVisible(true)}>
          <Text style={styles.setHomeText}>🏠 Ställ in hem</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.setHomeButton} onPress={() => setSetSchoolVisible(true)}>
          <Text style={styles.setHomeText}>🏫 Ställ in skola</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.addFriendButton} onPress={() => setAddFriendVisible(true)}>
        <Text style={styles.setHomeText}>📍 Lägg till plats</Text>
      </TouchableOpacity>

      <View style={styles.placeButtonRow}>
        <TouchableOpacity style={styles.directionsButton} onPress={() => handleDirections('hem', 'hem')}>
          <Text style={styles.directionsText}>🗺️ Vägbeskrivning hem</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.directionsButton} onPress={() => handleDirections('skola', 'skola')}>
          <Text style={styles.directionsText}>🗺️ Vägbeskrivning skola</Text>
        </TouchableOpacity>
      </View>

      <SavedPlaceScreen
        visible={setHomeVisible}
        onClose={() => setSetHomeVisible(false)}
        onSaved={refreshGeofencing}
        label="hem"
        icon="🏠"
        title="Ställ in hem"
        name="Hemplatsen"
      />
      <SavedPlaceScreen
        visible={setSchoolVisible}
        onClose={() => setSetSchoolVisible(false)}
        onSaved={refreshGeofencing}
        label="skola"
        icon="🏫"
        title="Ställ in skola"
        name="Skolplatsen"
      />
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
      <ChatScreen visible={chatVisible} onClose={() => setChatVisible(false)} />
      <LostScreen visible={lostVisible} onClose={() => setLostVisible(false)} />

      <TouchableOpacity style={styles.worriedButton} onPress={() => setWorriedVisible(true)}>
        <Text style={styles.worriedText}>💛 Jag känner mig orolig</Text>
      </TouchableOpacity>

      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <TouchableOpacity style={styles.sosButton} onPress={handleSos}>
          <Text style={styles.sosText}>🚨 LARM</Text>
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={worriedVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Vad känner du? 💛</Text>
            <Text style={styles.modalSubtitle}>Pappa får veta direkt.</Text>

            {FEELINGS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={styles.feelingButton}
                onPress={() => handleFeelingPress(f)}
              >
                <Text style={styles.feelingText}>{f.label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.calmButton} onPress={playCalmMessage}>
              <Text style={styles.calmButtonText}>🔊 Lyssna på en lugnande röst</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.callButton} onPress={handleCallParent}>
              <Text style={styles.callButtonText}>📞 Ring pappa</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setWorriedVisible(false)}>
              <Text style={styles.closeText}>Stäng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --- Enkel geometri för "hitta hem"-pilen ---
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingToArrow(bearing) {
  const arrows = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
  return arrows[Math.round(bearing / 45) % 8];
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 24, fontWeight: '700', color: '#6D28D9' },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  chatLink: { color: '#7C3AED', fontSize: 14, fontWeight: '600' },
  logout: { color: '#7C3AED', fontSize: 14 },
  helper: { color: '#7C3AED', marginTop: 6, marginBottom: 14 },
  mapButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  mapButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#6D28D9' },
  aiButton: {
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  aiButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#6D28D9' },
  todayCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  todayLabel: { color: '#92400E', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  todayText: { color: '#78350F', fontSize: 16, fontWeight: '500' },
  homeCard: {
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  homeArrow: { fontSize: 48 },
  homeDistance: { fontSize: 16, color: '#4C1D95', marginTop: 6 },
  findHomeButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  findHomeText: { textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#6D28D9' },
  placeButtonRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  setHomeButton: {
    flex: 1,
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    padding: 14,
  },
  setHomeText: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#6D28D9' },
  addFriendButton: {
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  directionsButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  directionsText: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#6D28D9' },
  worriedButton: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  worriedText: { textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#92400E' },
  sosButton: {
    backgroundColor: '#DC2626',
    borderRadius: 20,
    padding: 26,
    marginTop: 20,
  },
  sosText: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: '#fff' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  modalSubtitle: { color: '#7C3AED', marginBottom: 16 },
  feelingButton: { backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginBottom: 10 },
  feelingText: { fontSize: 16, fontWeight: '500' },
  calmButton: { backgroundColor: '#DDD6FE', borderRadius: 14, padding: 16, marginTop: 6, marginBottom: 10 },
  calmButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#4C1D95' },
  callButton: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 16, marginBottom: 14 },
  callButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#fff' },
  closeText: { textAlign: 'center', color: '#999', fontSize: 14 },
});
