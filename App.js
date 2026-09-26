import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ParentScreen from './src/screens/ParentScreen';
import ChildScreen from './src/screens/ChildScreen';

function Root() {
  const { session, profile, loading, profileError, reloadProfile, signOut } = useAuth();
  const [showSignup, setShowSignup] = useState(false);

  // Valet "visa registreringen" nollställs så snart man är inloggad. Annars
  // låg det kvar för alltid: efter en utloggning hamnade man i registreringen
  // i stället för i inloggningsrutan.
  useEffect(() => {
    if (session) setShowSignup(false);
  }, [session]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  // Inloggad, men profilen gick inte att läsa. Tidigare visades
  // inloggningsrutan igen utan förklaring — det såg ut som fel lösenord och
  // gick inte att ta sig ur.
  if (session && !profile && profileError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Något gick fel</Text>
        <Text style={styles.errorText}>{profileError}</Text>
        <TouchableOpacity style={styles.button} onPress={reloadProfile}>
          <Text style={styles.buttonText}>Försök igen</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.linkText}>Logga ut</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!session) {
    return showSignup ? (
      <SignupScreen hasSession={false} onBack={() => setShowSignup(false)} />
    ) : (
      <LoginScreen onSignup={() => setShowSignup(true)} />
    );
  }

  // Inloggad men ännu ingen familj — t.ex. när kontot skapades och
  // e-postbekräftelsen kom emellan. Här får man skapa familj eller ange kod.
  if (!profile) {
    return <SignupScreen hasSession onBack={() => setShowSignup(false)} />;
  }

  if (profile.role === 'parent') return <ParentScreen />;
  return <ChildScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#F5F3FF' },
  errorTitle: { fontSize: 22, fontWeight: '700', color: '#6D28D9', marginBottom: 10 },
  errorText: { fontSize: 16, color: '#4C1D95', textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  button: { backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkText: { color: '#7C3AED', fontSize: 15, paddingVertical: 16 },
});
