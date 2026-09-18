import React, { useState, useEffect } from 'react';
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
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { openInMaps } from '../lib/maps';

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
}) {
  const [marker, setMarker] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [address, setAddress] = useState('');
  const [friendName, setFriendName] = useState('');
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setFriendName('');
      setExistingId(null);
      loadInitial();
    }
  }, [visible]);

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

  async function handleSearch() {
    if (!address.trim()) return;
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(address.trim());
      if (!results.length) {
        Alert.alert('Hittade ingen plats', 'Prova en mer specifik adress.');
        return;
      }
      const { latitude, longitude } = results[0];
      setMarker({ latitude, longitude });
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
    setMarker({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  async function handleSave() {
    if (!marker) return;
    if (allowMultiple && !friendName.trim()) {
      Alert.alert('Namn saknas', 'Skriv ett namn på vännen först.');
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

        <Text style={styles.helper}>Sök adress nedan, eller använd din nuvarande position.</Text>

        {allowMultiple && (
          <TextInput
            style={[styles.searchInput, { marginRight: 0, marginBottom: 12 }]}
            placeholder="Namn på vännen, t.ex. Emma"
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
            <View style={styles.previewCard}>
              <Text style={styles.previewLabel}>Vald plats</Text>
              <Text style={styles.previewCoords}>
                {marker.latitude.toFixed(5)}, {marker.longitude.toFixed(5)}
              </Text>
              <TouchableOpacity
                style={styles.previewButton}
                onPress={() => openInMaps(marker.latitude, marker.longitude, name)}
              >
                <Text style={styles.previewButtonText}>🔍 Förhandsgranska på karta</Text>
              </TouchableOpacity>
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
  previewCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewLabel: { color: '#7C3AED', fontSize: 14 },
  previewCoords: { fontSize: 16, fontWeight: '600', color: '#4C1D95', marginTop: 4, marginBottom: 16 },
  previewButton: { backgroundColor: '#EDE9FE', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  previewButtonText: { fontSize: 15, fontWeight: '600', color: '#6D28D9' },
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
