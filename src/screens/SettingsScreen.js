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
  Share,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { startBackgroundLocationTracking, stopBackgroundLocationTracking } from '../lib/backgroundLocation';
import { registerForPushNotifications } from '../lib/pushNotifications';

export default function SettingsScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [todayNote, setTodayNote] = useState('');
  const [appDisplayName, setAppDisplayName] = useState('');
  const [locationSharing, setLocationSharing] = useState(false);
  const [aiChatEnabled, setAiChatEnabled] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [pushGranted, setPushGranted] = useState(true);

  const familyId = profile?.family_id;

  useEffect(() => {
    if (visible) loadSettings();
  }, [visible]);

  async function loadSettings() {
    checkPushPermission();

    // Utan familj finns inga familjerader att hämta, och .eq('family_id',
    // undefined) blir en ogiltig fråga som bara svarar med fel.
    if (!familyId) return;

    const { data: freshProfile, error: profileError } = await supabase
      .from('profiles')
      .select('phone_number, location_sharing_enabled')
      .eq('id', profile.id)
      .maybeSingle();

    // Bara skriv över fälten om läsningen faktiskt gick igenom. Annars ser det
    // ut som att numret är borta och nästa "Spara" raderar det på riktigt.
    if (profileError) {
      Alert.alert('Kunde inte hämta inställningarna', profileError.message);
    } else if (freshProfile) {
      setPhoneNumber(freshProfile.phone_number || '');
      setLocationSharing(freshProfile.location_sharing_enabled || false);
    }

    // Samma regel för noteringen och appnamnet: ett misslyckat svar får inte
    // tömmas i fältet, för då raderar nästa "Spara" det som stod där.
    const { data: note, error: noteError } = await supabase
      .from('today_note')
      .select('content')
      .eq('family_id', familyId)
      .maybeSingle();
    if (!noteError) setTodayNote(note?.content || '');

    const { data: appSettings, error: settingsError } = await supabase
      .from('app_settings')
      .select('display_name, ai_chat_enabled')
      .eq('family_id', familyId)
      .maybeSingle();
    if (!settingsError) {
      setAppDisplayName(appSettings?.display_name || '');
      setAiChatEnabled(appSettings?.ai_chat_enabled || false);
    }

    const { data: family, error: familyError } = await supabase
      .from('families')
      .select('name, invite_code')
      .eq('id', familyId)
      .maybeSingle();
    if (!familyError) {
      setFamilyName(family?.name || '');
      setInviteCode(family?.invite_code || '');
    }
  }

  async function checkPushPermission() {
    const { status } = await Notifications.getPermissionsAsync();
    setPushGranted(status === 'granted');
  }

  // Notiserna är hela poängen med appen. Är de avstängda i telefonen ska det
  // stå här, inte vara tyst.
  async function handleEnablePush() {
    const result = await registerForPushNotifications(profile.id);
    await checkPushPermission();
    if (!result.ok) {
      Alert.alert(
        'Notiser är fortfarande av',
        result.reason === 'permission_denied'
          ? 'Slå på notiser för appen i telefonens inställningar (Inställningar → Aviseringar).'
          : 'Kunde inte slå på notiser just nu. Kontrollera anslutningen och försök igen.'
      );
    }
  }

  async function shareCode() {
    if (!inviteCode) return;
    try {
      await Share.share({
        message:
          `Hej! Vi använder Trygghetsappen för att hålla koll när barnen åker buss. ` +
          `Ladda ner appen och välj "Jag har en kod" när du skapar konto. Koden är: ${inviteCode}`,
      });
    } catch (error) {
      Alert.alert('Kunde inte dela', error.message);
    }
  }

  function confirmRotate() {
    Alert.alert(
      'Skapa ny kod?',
      'Den gamla koden slutar fungera direkt. Den som redan är med i familjen påverkas inte.',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Ny kod', style: 'destructive', onPress: rotateCode },
      ]
    );
  }

  async function rotateCode() {
    setRotating(true);
    const { data, error } = await supabase.rpc('rotate_invite_code');
    setRotating(false);
    if (error) {
      Alert.alert('Kunde inte skapa ny kod', error.message);
      return;
    }
    // rotate_invite_code() svarar med själva koden som en textsträng.
    setInviteCode(typeof data === 'string' ? data : '');
    Alert.alert('Klart!', 'En ny kod är skapad. Dela den med den som ska gå med.');
  }

  async function handleToggleAiChat(value) {
    setAiChatEnabled(value);
    const { error } = await supabase.from('app_settings').upsert({
      family_id: familyId,
      ai_chat_enabled: value,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setAiChatEnabled(!value);
      Alert.alert('Kunde inte ändra', error.message);
    }
  }

  async function handleSaveAppName() {
    // Ett tomt namn är inte ett namn. Utan spärren kunde ett misslyckat
    // uppslag (fältet blev tomt) sparas rakt över familjens riktiga namn.
    if (!appDisplayName.trim()) {
      Alert.alert('Namnet är tomt', 'Skriv ett namn som ska synas i appen, t.ex. familjens namn.');
      return;
    }
    setSavingName(true);
    const { error } = await supabase.from('app_settings').upsert({
      family_id: familyId,
      display_name: appDisplayName.trim(),
      updated_at: new Date().toISOString(),
    });
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
    const { error } = await supabase.from('today_note').upsert({
      family_id: familyId,
      content: todayNote.trim(),
      updated_at: new Date().toISOString(),
    });
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
        {!pushGranted && (
          <TouchableOpacity style={styles.pushWarning} onPress={handleEnablePush}>
            <Text style={styles.pushWarningTitle}>🔔 Notiserna är avstängda</Text>
            <Text style={styles.pushWarningText}>
              Då får du inget när barnet kommer fram eller larmar. Tryck här för att slå på dem.
            </Text>
          </TouchableOpacity>
        )}

        {profile?.role === 'parent' && (
          <>
            <Text style={styles.sectionLabel}>🔑 Inbjudningskod</Text>
            <Text style={styles.helper}>
              Den här koden ger nya personer plats i {familyName || 'familjen'}. Dela den bara med
              dem du litar på.
            </Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{inviteCode || '—'}</Text>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.halfButton} onPress={shareCode} disabled={!inviteCode}>
                <Text style={styles.halfButtonText}>Dela koden</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.halfButton, styles.halfButtonGhost]}
                onPress={confirmRotate}
                disabled={rotating}
              >
                <Text style={styles.halfButtonGhostText}>
                  {rotating ? 'Skapar...' : 'Ny kod'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { marginTop: 30 }]}>Namn i appen</Text>
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
        <Text style={styles.helper}>Används för "Ring"-knappen i barnets app.</Text>
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
        <Text style={styles.helper}>Visas överst i barnets app, t.ex. "Mormor hämtar dig idag".</Text>
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
            <Text style={styles.helper}>Visar dig på familjekartan.</Text>
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
            <Text style={styles.helper}>Släpper in AI-knappen i appen. Av som standard.</Text>
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
  pushWarning: {
    backgroundColor: '#FEE2E2',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  pushWarningTitle: { color: '#991B1B', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  pushWarningText: { color: '#991B1B', fontSize: 13, lineHeight: 18 },
  codeBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  codeText: { fontSize: 30, fontWeight: '800', letterSpacing: 6, color: '#4C1D95' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  halfButton: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    padding: 14,
  },
  halfButtonText: { textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '600' },
  halfButtonGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4B5FD' },
  halfButtonGhostText: { textAlign: 'center', color: '#6D28D9', fontSize: 15, fontWeight: '600' },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 30,
  },
});
