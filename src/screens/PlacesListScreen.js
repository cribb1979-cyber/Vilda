import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import SavedPlaceScreen from './SavedPlaceScreen';

const LABEL_ICONS = { hem: '🏠', skola: '🏫' };
const LABEL_TITLES = { hem: 'Ställ in hem', skola: 'Ställ in skola' };

export default function PlacesListScreen({ visible, onClose }) {
  const [places, setPlaces] = useState([]);
  const [editingPlace, setEditingPlace] = useState(null);

  useEffect(() => {
    if (visible) loadPlaces();
  }, [visible]);

  async function loadPlaces() {
    const { data } = await supabase.from('saved_places').select('*').order('created_at', { ascending: true });
    setPlaces(data || []);
  }

  function handleDelete(place) {
    Alert.alert('Radera plats?', `Vill du radera "${place.name}"?`, [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Radera',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('saved_places').delete().eq('id', place.id);
          if (error) {
            Alert.alert('Kunde inte radera', error.message);
            return;
          }
          setPlaces((prev) => prev.filter((p) => p.id !== place.id));
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>📍 Mina platser</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={places}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.empty}>Inga platser sparade än.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowIcon}>{LABEL_ICONS[item.label] || '📍'}</Text>
              <Text style={styles.rowName}>{item.name}</Text>
              <TouchableOpacity style={styles.rowButton} onPress={() => setEditingPlace(item)}>
                <Text style={styles.rowButtonText}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rowButton} onPress={() => handleDelete(item)}>
                <Text style={styles.rowButtonText}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
        />

        {editingPlace && (
          <SavedPlaceScreen
            visible={!!editingPlace}
            onClose={() => setEditingPlace(null)}
            onSaved={loadPlaces}
            editingPlace={editingPlace}
            label={editingPlace.label}
            icon={LABEL_ICONS[editingPlace.label] || '📍'}
            title={LABEL_TITLES[editingPlace.label] || 'Redigera plats'}
            name={editingPlace.name}
            allowMultiple={editingPlace.label !== 'hem' && editingPlace.label !== 'skola'}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  empty: { textAlign: 'center', color: '#7C3AED', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  rowIcon: { fontSize: 22, marginRight: 12 },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#4C1D95' },
  rowButton: { padding: 8, marginLeft: 4 },
  rowButtonText: { fontSize: 18 },
});
