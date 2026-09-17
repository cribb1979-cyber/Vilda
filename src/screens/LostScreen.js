import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { callNumber } from '../lib/maps';
import { getDistanceMeters, formatDistance } from '../lib/distance';

const STEPS = [
  'Stanna där du är.',
  'Titta runt efter en trygg vuxen.',
  'Vi visar var du är.',
  'Tryck på "Jag behöver hjälp".',
];

const CALM_MESSAGE =
  'Du är trygg. Pappa ser var du är och kommer hjälpa dig. Andas lugnt, ett andetag i taget.';

export default function LostScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [helpRequested, setHelpRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [myPosition, setMyPosition] = useState(null);
  const [distances, setDistances] = useState([]);
  const [parent, setParent] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setHelpRequested(false);
    loadEverything();
  }, [visible]);

  async function loadEverything() {
    setLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    const loc = status === 'granted' ? await Location.getCurrentPositionAsync({}) : null;
    const here = loc ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude } : null;
    setMyPosition(here);

    const { data: places } = await supabase
      .from('saved_places')
      .select('*')
      .in('label', ['hem', 'skola']);

    const { data: parentProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'parent')
      .limit(1)
      .maybeSingle();
    setParent(parentProfile || null);

    const rows = [];
    if (here) {
      (places || []).forEach((place) => {
        const meters = getDistanceMeters(here.latitude, here.longitude, place.latitude, place.longitude);
        rows.push({
          key: place.label,
          icon: place.label === 'hem' ? '🏠' : '🏫',
          name: place.label === 'hem' ? 'Hem' : 'Skolan',
          distanceLabel: formatDistance(meters),
        });
      });

      if (parentProfile?.location_sharing_enabled) {
        const { data: parentLoc } = await supabase
          .from('locations')
          .select('*')
          .eq('user_id', parentProfile.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (parentLoc) {
          const meters = getDistanceMeters(here.latitude, here.longitude, parentLoc.latitude, parentLoc.longitude);
          rows.push({
            key: 'parent',
            icon: '🙂',
            name: parentProfile.display_name,
            distanceLabel: formatDistance(meters),
          });
        }
      }
    }
    setDistances(rows);
    setLoading(false);
  }

  async function handleRequestHelp() {
    setSending(true);
    const loc = myPosition || (await Location.getCurrentPositionAsync({})).coords;
    await supabase.from('alerts').insert({
      user_id: profile.id,
      alert_type: 'worried',
      feeling: '🧭 Jag är vilse',
      latitude: loc.latitude,
      longitude: loc.longitude,
    });
    setSending(false);
    setHelpRequested(true);
  }

  function playCalmMessage() {
    Speech.speak(CALM_MESSAGE, { language: 'sv-SE', rate: 0.92 });
  }

  function handleCallParent() {
    if (!parent?.phone_number) return;
    callNumber(parent.phone_number);
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
        ) : helpRequested ? (
          <>
            <Text style={styles.title}>💛 Pappa vet nu var du är</Text>
            <Text style={styles.subtitle}>Håll dig kvar där du är, hjälp är på väg.</Text>

            <TouchableOpacity style={styles.calmButton} onPress={playCalmMessage}>
              <Text style={styles.calmButtonText}>🔊 Lyssna på en lugnande röst</Text>
            </TouchableOpacity>

            {parent?.phone_number && (
              <TouchableOpacity style={styles.callButton} onPress={handleCallParent}>
                <Text style={styles.callButtonText}>📞 Ring pappa</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>Stäng</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>💛 Lugn, du är inte ensam.</Text>
            <Text style={styles.subtitle}>Vi hjälper dig steg för steg.</Text>

            <View style={styles.stepsCard}>
              {STEPS.map((step, i) => (
                <View key={step} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>

            {distances.length > 0 && (
              <View style={styles.distancesCard}>
                {distances.map((row) => (
                  <View key={row.key} style={styles.distanceRow}>
                    <Text style={styles.distanceLabel}>
                      {row.icon} {row.name}
                    </Text>
                    <Text style={styles.distanceValue}>{row.distanceLabel}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.helpButton} onPress={handleRequestHelp} disabled={sending}>
              <Text style={styles.helpButtonText}>
                {sending ? 'Skickar...' : '🚨 JAG BEHÖVER HJÄLP'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>Stäng</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 24, paddingTop: 70 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#6D28D9', marginBottom: 6 },
  subtitle: { fontSize: 16, color: '#7C3AED', marginBottom: 24 },
  stepsCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DDD6FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: { color: '#4C1D95', fontWeight: '700' },
  stepText: { flex: 1, fontSize: 15, color: '#333' },
  distancesCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 24 },
  distanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEFB',
  },
  distanceLabel: { fontSize: 15, color: '#333' },
  distanceValue: { fontSize: 15, fontWeight: '600', color: '#4C1D95' },
  helpButton: {
    backgroundColor: '#DC2626',
    borderRadius: 20,
    padding: 22,
    marginBottom: 16,
  },
  helpButtonText: { textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#fff' },
  calmButton: { backgroundColor: '#DDD6FE', borderRadius: 14, padding: 16, marginBottom: 12 },
  calmButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#4C1D95' },
  callButton: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 16, marginBottom: 16 },
  callButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#fff' },
  closeText: { textAlign: 'center', color: '#999', fontSize: 14 },
});
