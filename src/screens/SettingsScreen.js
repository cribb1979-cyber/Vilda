import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { startBackgroundLocationTracking, stopBackgroundLocationTracking } from '../lib/backgroundLocation';
import { startGeofencing } from '../lib/geofencing';

export default function SettingsScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [todayNote, setTodayNote] = useState('');
  const [appDisplayName, setAppDisplayName] = useState('');
  const [locationSharing, setLocationSharing] = useState(false);
  const [aiChatEnabled, setAiChatEnabled] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (visible) loadSettings();
  }, [visible]);

  async function loadSettings() {
    const { data: freshProfile } = await supabase
      .from('profiles')
      .select('phone_number, location_sharing_enabled')
      .eq('id', profile.id)
      .maybeSingle();
    setPhoneNumber(freshProfile?.phone_number || '');
    setLocationSharing(freshProfile?.location_sharing_enabled || false);

    const { data } = await supabase.from('today_note').select('*').eq('id', 1).maybeSingle();
    setTodayNote(data?.content || '');

    const { data: appSettings } = await supabase
      .from('app_settings')
      .select('display_name, ai_chat_enabled')
      .eq('id', 1)
      .maybeSingle();
    setAppDisplayName(appSettings?.display_name || 'Vilda');
    setAiChatEnabled(appSettings?.ai_chat_enabled || false);
  }

  async function handleToggleAiChat(value) {
    setAiChatEnabled(value);
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, ai_chat_enabled: value, updated_at: new Date().toISOString() });
    if (error) {
      setAiChatEnabled(!value);
      Alert.alert('Kunde inte ändra', error.message);
    }
  }

  async function handleSaveAppName() {
    if (!appDisplayName.trim()) return;
    setSavingName(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, display_name: appDisplayName.trim(), updated_at: new Date().toISOString() });
    setSavingName(false);
    if (error) {
      Alert.alert('Kunde inte spara', error.message);
      return;
    }
    Alert.alert('Klart!', 'Namnet är sparat.');
  }

  async function handleToggleLocationSharing(value) {
    setLocationSharing(value);
    const { error } = await supabase
      .from('profiles')
      .update({ location_sharing_enabled: value })
      .eq('id', profile.id);

    if (error) {
      setLocationSharing(!value);
      Alert.alert('Kunde inte ändra', error.message);
      return;
    }

    if (value) {
      startBackgroundLocationTracking();
      const { data: home } = await supabase.from('saved_places').select('*').eq('label', 'hem').maybeSingle();
      if (home) startGeofencing([home]);
    } else {
      stopBackgroundLocationTracking();
    }
  }

  async function handleSavePhone() {
    setSavingPhone(true);
    const { error } = await supabase
      .from('profiles')
      .update({ phone_number: phoneNumber.trim() })
      .eq('id', profile.id);
    setSavingPhone(false);
    if (error) {
      Alert.alert('Kunde inte spara', error.message);
      return;
    }
    Alert.alert('Klart!', 'Telefonnumret är sparat.');
  }

  async function handleSaveNote() {
    setSavingNote(true);
    const { error } = await supabase
      .from('today_note')
      .upsert({ id: 1, content: todayNote.trim(), updated_at: new Date().toISOString() });
    setSavingNote(false);
    if (error) {
      Alert.alert('Kunde inte spara', error.message);
      return;
    }
    Alert.alert('Klart!', 'Dagens notering är sparad.');
  }

  return (
    <Modal visible={visible} animationType="slide">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>⚙️ Inställningar</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
        <Text style={styles.sectionLabel}>Namn i appen</Text>
        <Text style={styles.helper}>Visas högst upp, t.ex. barnets namn eller ett familjenamn.</Text>
        <TextInput
          style={styles.input}
          placeholder="Vilda"
          value={appDisplayName}
          onChangeText={setAppDisplayName}
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveAppName} disabled={savingName}>
          <Text style={styles.saveButtonText}>{savingName ? 'Sparar...' : 'Spara namn'}</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { marginTop: 30 }]}>Mitt telefonnummer</Text>
        <Text style={styles.helper}>Används för "Ring pappa"-knappen i Vildas app.</Text>
        <TextInput
          style={styles.input}
          placeholder="070-123 45 67"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSavePhone} disabled={savingPhone}>
          <Text style={styles.saveButtonText}>{savingPhone ? 'Sparar...' : 'Spara nummer'}</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { marginTop: 30 }]}>📅 Idag</Text>
        <Text style={styles.helper}>Visas överst i Vildas app, t.ex. "Mormor hämtar dig idag".</Text>
        <TextInput
          style={[styles.input, styles.noteInput]}
          placeholder="Skriv dagens notering..."
          value={todayNote}
          onChangeText={setTodayNote}
          multiline
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveNote} disabled={savingNote}>
          <Text style={styles.saveButtonText}>{savingNote ? 'Sparar...' : 'Spara notering'}</Text>
        </TouchableOpacity>

        <View style={styles.shareRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>📍 Dela min position</Text>
            <Text style={styles.helper}>Visar dig på Vildas familjekarta.</Text>
          </View>
          <Switch
            value={locationSharing}
            onValueChange={handleToggleLocationSharing}
            trackColor={{ true: '#7C3AED' }}
          />
        </View>

        <View style={styles.shareRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>🤖 Tillåt AI-chatt</Text>
            <Text style={styles.helper}>Släpper in "Vilda AI"-knappen i appen. Av som standard.</Text>
          </View>
          <Switch
            value={aiChatEnabled}
            onValueChange={handleToggleAiChat}
            trackColor={{ true: '#7C3AED' }}
          />
        </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: '#4C1D95', marginBottom: 4 },
  helper: { color: '#7C3AED', fontSize: 13, marginBottom: 10 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    marginBottom: 12,
  },
  noteInput: { minHeight: 90, textAlignVertical: 'top' },
  saveButton: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 16 },
  saveButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#fff' },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 30,
  },
});
