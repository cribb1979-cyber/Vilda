import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';

const STOCKHOLM = { latitude: 59.3293, longitude: 18.0686 };

export default function SavedPlaceScreen({
  visible,
  onClose,
  onSaved,
  label,
  icon,
  title,
  name,
  allowMultiple = false,
  editingPlace = null,
}) {
  const [marker, setMarker] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [address, setAddress] = useState('');
  const [friendName, setFriendName] = useState('');
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    if (visible) {
      if (editingPlace) {
        setMarker({ latitude: editingPlace.latitude, longitude: editingPlace.longitude });
        setExistingId(editingPlace.id);
        setFriendName(editingPlace.name || '');
        setAddress('');
        setLoadingInitial(false);
        return;
      }
      setFriendName('');
      setExistingId(null);
      setAddress('');
      loadInitial();
    }
  }, [visible, editingPlace]);

  async function loadInitial() {
    setLoadingInitial(true);

    if (!allowMultiple) {
      const { data: place } = await supabase
        .from('saved_places')
        .select('*')
        .eq('label', label)
        .maybeSingle();

      if (place) {
        setMarker({ latitude: place.latitude, longitude: place.longitude });
        setExistingId(place.id);
        setLoadingInitial(false);
        return;
      }
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      setMarker({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } else {
      setMarker(STOCKHOLM);
    }
    setLoadingInitial(false);
  }

  function moveTo(latitude, longitude) {
    setMarker({ latitude, longitude });
    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400
    );
  }

  async function handleSearch() {
    if (!address.trim()) return;
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(address.trim());
      if (!results.length) {
        Alert.alert('Hittade ingen plats', 'Prova en mer specifik adress, eller dra nålen till rätt ställe på kartan.');
        return;
      }
      moveTo(results[0].latitude, results[0].longitude);
    } catch (e) {
      Alert.alert('Kunde inte söka', 'Något gick fel, försök igen.');
    } finally {
      setSearching(false);
    }
  }

  async function handleUseCurrentLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Ingen åtkomst till plats', 'Vilda behöver tillgång till din position.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    moveTo(loc.coords.latitude, loc.coords.longitude);
  }

  async function handleSave() {
    if (!marker) return;
    if (allowMultiple && !friendName.trim()) {
      Alert.alert('Namn saknas', 'Skriv ett namn på platsen först.');
      return;
    }

    setSaving(true);
    const placeName = allowMultiple ? friendName.trim() : name;
    const row = { label, name: placeName, latitude: marker.latitude, longitude: marker.longitude };

    const { error } = existingId
      ? await supabase.from('saved_places').update(row).eq('id', existingId)
      : await supabase.from('saved_places').insert(row);

    setSaving(false);
    if (error) {
      Alert.alert('Kunde inte spara', error.message);
      return;
    }
    Alert.alert('Klart!', `${placeName} är sparad.`);
    onSaved?.();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {icon} {title}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.helper}>Sök adress, använd nuvarande position, eller dra nålen till exakt rätt ställe.</Text>

        {allowMultiple && (
          <TextInput
            style={[styles.searchInput, { marginRight: 0, marginBottom: 12 }]}
            placeholder="Namn på platsen, t.ex. Hållplats B eller Kompis Emma"
            value={friendName}
            onChangeText={setFriendName}
          />
        )}

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Sök adress..."
            value={address}
            onChangeText={setAddress}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={searching}>
            <Text style={styles.searchButtonText}>{searching ? '...' : 'Sök'}</Text>
          </TouchableOpacity>
        </View>

        {loadingInitial ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
        ) : (
          marker && (
            <View style={styles.mapWrap}>
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={{
                  latitude: marker.latitude,
                  longitude: marker.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                onPress={(e) => setMarker(e.nativeEvent.coordinate)}
              >
                <Marker
                  coordinate={marker}
                  draggable
                  onDragEnd={(e) => setMarker(e.nativeEvent.coordinate)}
                />
              </MapView>
              <Text style={styles.mapHint}>👆 Tryck eller dra nålen för att pricka in exakt rätt ställe</Text>
            </View>
          )
        )}

        <TouchableOpacity style={styles.locationButton} onPress={handleUseCurrentLocation}>
          <Text style={styles.locationButtonText}>📍 Använd min nuvarande position</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, !marker && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!marker || saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Sparar...' : `💜 Spara som ${name.toLowerCase()}`}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  helper: { color: '#7C3AED', marginBottom: 14, fontSize: 14 },
  searchRow: { flexDirection: 'row', marginBottom: 14 },
  searchInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    marginRight: 8,
  },
  searchButton: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontWeight: '600' },
  mapLoading: { flex: 1, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  mapWrap: { flex: 1, marginBottom: 14, borderRadius: 16, overflow: 'hidden' },
  map: { flex: 1 },
  mapHint: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    padding: 8,
    fontSize: 12,
    textAlign: 'center',
    color: '#4C1D95',
  },
  locationButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  locationButtonText: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#6D28D9' },
  saveButton: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 18 },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#fff' },
});
