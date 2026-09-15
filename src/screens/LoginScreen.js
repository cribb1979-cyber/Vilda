import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) Alert.alert('Kunde inte logga in', error.message);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vilda 💜</Text>
      <Text style={styles.subtitle}>Trygghet, alltid nära</Text>

      <TextInput
        style={styles.input}
        placeholder="E-post"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Lösenord"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Loggar in...' : 'Logga in'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F5F3FF' },
  title: { fontSize: 40, fontWeight: '700', textAlign: 'center', color: '#6D28D9' },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#7C3AED', marginBottom: 40 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  button: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    padding: 18,
    marginTop: 10,
  },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 18, fontWeight: '600' },
});
