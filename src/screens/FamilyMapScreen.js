import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { openWalkingDirections } from '../lib/maps';
import { getDistanceMeters, formatDistance, estimateWalkingMinutes } from '../lib/distance';

const PLACE_ICONS = { hem: '🏠', skola: '🏫' };

export default function FamilyMapScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [myPosition, setMyPosition] = useState(null);
  const [people, setPeople] = useState([]);
  const [places, setPlaces] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    loadEverything();

    const channel = supabase
      .channel('family-map-locations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, () => {
        loadPeople();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [visible]);

  async function loadEverything() {
    setLoading(true);
    await Promise.all([loadMyPosition(), loadPeople(), loadPlaces()]);
    setLoading(false);
  }

  async function loadMyPosition() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({});
    setMyPosition({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  const loadPeople = useCallback(async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', profile.id)
      .or('role.eq.child,location_sharing_enabled.eq.true');

    if (!profiles?.length) {
      setPeople([]);
      return;
    }

    const ids = profiles.map((p) => p.id);
    const { data: locs } = await supabase
      .from('locations')
      .select('*')
      .in('user_id', ids)
      .order('recorded_at', { ascending: false });

    const latestByUser = {};
    (locs || []).forEach((loc) => {
      if (!latestByUser[loc.user_id]) latestByUser[loc.user_id] = loc;
    });

    const withLocation = profiles
      .filter((p) => latestByUser[p.id])
      .map((p) => ({ ...p, location: latestByUser[p.id] }));

    setPeople(withLocation);
  }, [profile?.id]);

  async function loadPlaces() {
    const { data } = await supabase.from('saved_places').select('*');
    setPlaces(data || []);
  }

  function distanceFromMe(lat, lon) {
    if (!myPosition) return null;
    return getDistanceMeters(myPosition.latitude, myPosition.longitude, lat, lon);
  }

  const allPoints = [
    ...(myPosition ? [myPosition] : []),
    ...people.map((p) => ({ latitude: p.location.latitude, longitude: p.location.longitude })),
    ...places.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
  ];

  const initialRegion = allPoints.length
    ? {
        latitude: allPoints[0].latitude,
        longitude: allPoints[0].longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : {
        latitude: 59.3293,
        longitude: 18.0686,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🗺️ Familjekarta</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
        ) : (
          <MapView style={styles.map} initialRegion={initialRegion}>
            {people.map((p) => (
              <Marker
                key={p.id}
                coordinate={{ latitude: p.location.latitude, longitude: p.location.longitude }}
                onPress={() => setSelected({ type: 'person', ...p })}
              >
                <View style={styles.personPin}>
                  <Text style={styles.personPinText}>{p.display_name?.[0]?.toUpperCase() || '?'}</Text>
                </View>
              </Marker>
            ))}
            {places.map((place) => (
              <Marker
                key={place.id}
                coordinate={{ latitude: place.latitude, longitude: place.longitude }}
                onPress={() => setSelected({ type: 'place', ...place })}
              >
                <Text style={styles.placeEmoji}>{PLACE_ICONS[place.label] || '📍'}</Text>
              </Marker>
            ))}
          </MapView>
        )}

        {selected && (
          <DetailCard
            selected={selected}
            distanceMeters={distanceFromMe(
              selected.type === 'person' ? selected.location.latitude : selected.latitude,
              selected.type === 'person' ? selected.location.longitude : selected.longitude
            )}
            onClose={() => setSelected(null)}
          />
        )}
      </View>
    </Modal>
  );
}

function DetailCard({ selected, distanceMeters, onClose }) {
  const isPerson = selected.type === 'person';
  const name = isPerson ? selected.display_name : selected.name || selected.label;
  const lat = isPerson ? selected.location.latitude : selected.latitude;
  const lon = isPerson ? selected.location.longitude : selected.longitude;

  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailName}>
          {isPerson ? '🙂' : PLACE_ICONS[selected.label] || '📍'} {name}
        </Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.detailCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      {distanceMeters != null && (
        <>
          <Text style={styles.detailRow}>📍 {formatDistance(distanceMeters)} bort</Text>
          <Text style={styles.detailRow}>🚶 ~{estimateWalkingMinutes(distanceMeters)} min bort</Text>
        </>
      )}
      {isPerson && (
        <Text style={styles.detailRow}>
          🔋 {selected.location.battery_level ?? '–'}%
          {selected.location.is_charging ? ' (laddar)' : ''}
        </Text>
      )}

      <TouchableOpacity style={styles.findButton} onPress={() => openWalkingDirections(lat, lon, name)}>
        <Text style={styles.findButtonText}>🧭 Hitta {name}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  map: { flex: 1 },
  personPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  personPinText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  placeEmoji: { fontSize: 30 },
  detailCard: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  detailName: { fontSize: 18, fontWeight: '700', color: '#4C1D95' },
  detailCloseText: { fontSize: 16, color: '#999' },
  detailRow: { fontSize: 15, color: '#444', marginBottom: 4 },
  findButton: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 14, marginTop: 12 },
  findButtonText: { textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '600' },
});
