import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { APP_NAME } from '../lib/appSettings';

// Två vägar in:
//   - skapa en ny familj (blir förälder, får en inbjudningskod)
//   - gå med i en befintlig familj med kod (barn eller medförälder)
//
// Samma skärm används både före inloggning (då frågar vi också om e-post och
// lösenord) och efter, för ett konto som ännu inte hunnit få någon familj —
// t.ex. när e-postbekräftelsen kom emellan.
export default function SignupScreen({ hasSession, onBack }) {
  const {
    signUpAndCreateFamily,
    signUpAndJoinFamily,
    completeSignupCreateFamily,
    completeSignupJoinFamily,
    reloadProfile,
    signOut,
  } = useAuth();

  const [step, setStep] = useState('choose'); // choose | create | join | done
  const [displayName, setDisplayName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState('child');
  const [busy, setBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  function checkAccountFields() {
    if (!displayName.trim()) {
      Alert.alert('Vad heter du?', 'Skriv namnet som ska synas i appen, t.ex. Pappa eller Vilda.');
      return false;
    }
    if (!hasSession) {
      if (!email.trim() || !email.includes('@')) {
        Alert.alert('Kontrollera e-postadressen', 'Skriv en e-postadress som fungerar.');
        return false;
      }
      if (password.length < 6) {
        Alert.alert('För kort lösenord', 'Lösenordet behöver vara minst 6 tecken.');
        return false;
      }
    }
    return true;
  }

  async function handleCreate() {
    if (!checkAccountFields()) return;
    setBusy(true);
    const result = hasSession
      ? await completeSignupCreateFamily({ displayName, familyName })
      : await signUpAndCreateFamily({
          email: email.trim(),
          password,
          displayName,
          familyName,
        });
    setBusy(false);

    if (result.error) {
      Alert.alert('Kunde inte skapa familjen', result.error.message);
      return;
    }
    setInviteCode(result.family?.invite_code || '');
    setStep('done');
  }

  async function handleJoin() {
    if (!code.trim()) {
      Alert.alert('Skriv koden', 'Du behöver inbjudningskoden från den som bjöd in dig.');
      return;
    }
    if (!checkAccountFields()) return;
    setBusy(true);
    const result = hasSession
      ? await completeSignupJoinFamily({ displayName, code, role })
      : await signUpAndJoinFamily({
          email: email.trim(),
          password,
          displayName,
          code,
          role,
        });
    setBusy(false);

    if (result.error) {
      Alert.alert('Kunde inte gå med', result.error.message);
      return;
    }
    await reloadProfile();
  }

  // ---- Klar: visa koden som ska delas vidare ----
  if (step === 'done') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Klart! 🎉</Text>
        <Text style={styles.subtitle}>
          {familyName.trim() ? familyName.trim() : 'Din familj'} är skapad. Det här är er inbjudningskod:
        </Text>

        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{inviteCode || '—'}</Text>
        </View>

        <Text style={styles.helper}>
          Dela koden med ditt barn och med den andra föräldern. De väljer "Jag har en kod" när de
          skapar sina konton. Koden finns också kvar i appens inställningar.
        </Text>

        <TouchableOpacity style={styles.button} onPress={() => reloadProfile()} disabled={busy}>
          <Text style={styles.buttonText}>Fortsätt</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Välj väg in ----
  if (step === 'choose') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{APP_NAME} 💜</Text>
        <Text style={styles.subtitle}>
          {hasSession
            ? 'Ditt konto behöver kopplas till en familj.'
            : 'Skapa ett konto för att komma igång.'}
        </Text>

        <TouchableOpacity style={styles.choiceCard} onPress={() => setStep('create')}>
          <Text style={styles.choiceTitle}>👨👩👧 Skapa en ny familj</Text>
          <Text style={styles.choiceHelper}>
            Du blir förälder och får en inbjudningskod att dela med resten av familjen.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.choiceCard} onPress={() => setStep('join')}>
          <Text style={styles.choiceTitle}>🔑 Jag har en kod</Text>
          <Text style={styles.choiceHelper}>
            Gå med i en familj som redan finns. Du behöver koden från en förälder.
          </Text>
        </TouchableOpacity>

        {hasSession ? (
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.linkText}>Logga ut</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.linkText}>Tillbaka till inloggningen</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const isCreate = step === 'create';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{isCreate ? '👨👩👧 Ny familj' : '🔑 Gå med'}</Text>
        <Text style={styles.subtitle}>
          {isCreate
            ? 'Du blir förälder i den nya familjen.'
            : 'Fyll i koden du fick av en förälder.'}
        </Text>

        {!isCreate && (
          <>
            <Text style={styles.label}>Inbjudningskod</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="T.ex. K7M2QP"
              autoCapitalize="characters"
              autoCorrect={false}
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
            />

            <Text style={styles.label}>Jag är</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleButton, role === 'child' && styles.roleButtonActive]}
                onPress={() => setRole('child')}
              >
                <Text style={[styles.roleText, role === 'child' && styles.roleTextActive]}>🧒 Barn</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleButton, role === 'parent' && styles.roleButtonActive]}
                onPress={() => setRole('parent')}
              >
                <Text style={[styles.roleText, role === 'parent' && styles.roleTextActive]}>
                  🧑 Förälder
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.label}>Ditt namn i appen</Text>
        <TextInput
          style={styles.input}
          placeholder={isCreate ? 'T.ex. Pappa' : 'T.ex. Vilda'}
          value={displayName}
          onChangeText={setDisplayName}
        />

        {isCreate && (
          <>
            <Text style={styles.label}>Familjens namn (valfritt)</Text>
            <TextInput
              style={styles.input}
              placeholder="Vår familj"
              value={familyName}
              onChangeText={setFamilyName}
            />
          </>
        )}

        {!hasSession && (
          <>
            <Text style={styles.label}>E-post</Text>
            <TextInput
              style={styles.input}
              placeholder="namn@exempel.se"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Lösenord</Text>
            <TextInput
              style={styles.input}
              placeholder="Minst 6 tecken"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={isCreate ? handleCreate : handleJoin}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{isCreate ? 'Skapa familjen' : 'Gå med'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setStep('choose')}>
          <Text style={styles.linkText}>Tillbaka</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', padding: 24, paddingTop: 70 },
  title: { fontSize: 32, fontWeight: '700', color: '#6D28D9', marginBottom: 6 },
  subtitle: { fontSize: 16, color: '#7C3AED', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '700', color: '#4C1D95', marginBottom: 6 },
  helper: { color: '#7C3AED', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  codeInput: { fontSize: 22, letterSpacing: 4, fontWeight: '700', textAlign: 'center' },
  choiceCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#DDD6FE',
  },
  choiceTitle: { fontSize: 17, fontWeight: '700', color: '#4C1D95', marginBottom: 6 },
  choiceHelper: { color: '#7C3AED', fontSize: 14, lineHeight: 19 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  roleButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: '#DDD6FE',
  },
  roleButtonActive: { borderColor: '#7C3AED', backgroundColor: '#EDE9FE' },
  roleText: { textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#7C3AED' },
  roleTextActive: { color: '#4C1D95' },
  button: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 18, marginTop: 6, marginBottom: 14 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 18, fontWeight: '600' },
  linkText: { textAlign: 'center', color: '#7C3AED', fontSize: 15, paddingVertical: 8 },
  codeBox: {
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 26,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#C4B5FD',
  },
  codeText: { fontSize: 38, fontWeight: '800', letterSpacing: 6, color: '#4C1D95' },
});
