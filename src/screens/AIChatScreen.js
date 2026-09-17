import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

const MODES = [
  { key: 'larMig', icon: '🧠', label: 'Lär mig', greeting: 'Hej! Vad vill du lära dig mer om idag?' },
  {
    key: 'orolig',
    icon: '💛',
    label: 'Jag känner mig orolig',
    greeting: 'Hej. Det är okej att känna så. Vill du berätta vad som känns jobbigt?',
  },
  {
    key: 'skolan',
    icon: '📚',
    label: 'Hjälp med skolan',
    greeting: 'Hej! Skicka gärna en bild på uppgiften eller berätta vad du behöver hjälp med.',
  },
  { key: 'prata', icon: '💬', label: 'Jag vill prata', greeting: 'Hej! Vad har du på hjärtat?' },
  {
    key: 'video',
    icon: '🎬',
    label: 'Videotips',
    greeting: 'Hej! Vill du ha tips på hur du klipper video, eller hjälp att komma på en idé att filma?',
  },
];

export default function AIChatScreen({ visible, onClose, onEmergency, appName }) {
  const [mode, setMode] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [notActivated, setNotActivated] = useState(false);
  const listRef = useRef(null);

  function reset() {
    setMode(null);
    setMessages([]);
    setText('');
    setNotActivated(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function selectMode(m) {
    if (m.key === 'help') {
      handleClose();
      onEmergency?.();
      return;
    }
    setMode(m);
    setMessages([{ role: 'assistant', content: m.greeting }]);
  }

  async function sendMessage(imageBase64) {
    if (!text.trim() && !imageBase64) return;
    const userText = text.trim() || 'Titta på bilden jag skickade.';
    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setText('');
    setSending(true);

    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { mode: mode.key, messages: newMessages, imageBase64 },
    });

    setSending(false);

    if (error || data?.error === 'not_activated') {
      setNotActivated(true);
      return;
    }
    if (error || !data?.text) {
      Alert.alert('Kunde inte svara', 'Något gick fel, försök igen.');
      return;
    }

    setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);
  }

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Ingen åtkomst', 'Behöver tillgång till dina bilder.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (result.canceled || !result.assets?.length) return;

    setUploadingImage(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: 'base64' });
      await sendMessage(base64);
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={60}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🤖 {appName || 'Vilda'} AI</Text>
          <TouchableOpacity onPress={handleClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        {!mode ? (
          <View style={styles.modeList}>
            <Text style={styles.modeHelper}>Vad vill du göra?</Text>
            {MODES.map((m) => (
              <TouchableOpacity key={m.key} style={styles.modeButton} onPress={() => selectMode(m)}>
                <Text style={styles.modeButtonText}>
                  {m.icon} {m.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modeButton, styles.helpModeButton]}
              onPress={() => selectMode({ key: 'help' })}
            >
              <Text style={[styles.modeButtonText, styles.helpModeButtonText]}>🆘 Jag behöver hjälp</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => <Bubble item={item} />}
              contentContainerStyle={{ paddingVertical: 12 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            />

            {notActivated && (
              <View style={styles.notActivatedBanner}>
                <Text style={styles.notActivatedText}>
                  AI-hjälpen är inte aktiverad än. Prata med en vuxen eller prova en annan knapp i appen
                  istället.
                </Text>
              </View>
            )}

            <View style={styles.inputRow}>
              {mode.key === 'skolan' && (
                <TouchableOpacity style={styles.imageButton} onPress={handlePickImage} disabled={uploadingImage}>
                  {uploadingImage ? (
                    <ActivityIndicator size="small" color="#7C3AED" />
                  ) : (
                    <Text style={styles.imageButtonText}>📷</Text>
                  )}
                </TouchableOpacity>
              )}
              <TextInput
                style={styles.textInput}
                placeholder="Skriv här..."
                value={text}
                onChangeText={setText}
                multiline
              />
              <TouchableOpacity
                style={styles.sendButton}
                onPress={() => sendMessage()}
                disabled={sending || !text.trim()}
              >
                {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendButtonText}>➤</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Bubble({ item }) {
  const isMine = item.role === 'user';
  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{item.content}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F3FF', paddingTop: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#6D28D9' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  modeList: { padding: 20 },
  modeHelper: { color: '#7C3AED', fontSize: 15, marginBottom: 16 },
  modeButton: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 12 },
  modeButtonText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#6D28D9' },
  helpModeButton: { backgroundColor: '#FEE2E2', marginTop: 8 },
  helpModeButtonText: { color: '#DC2626' },
  bubbleRow: { paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, padding: 12 },
  bubbleMine: { backgroundColor: '#7C3AED' },
  bubbleTheirs: { backgroundColor: '#fff' },
  bubbleText: { fontSize: 15, color: '#333' },
  bubbleTextMine: { color: '#fff' },
  notActivatedBanner: { backgroundColor: '#FEF3C7', marginHorizontal: 16, borderRadius: 12, padding: 12 },
  notActivatedText: { color: '#92400E', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#DDD6FE',
    backgroundColor: '#F5F3FF',
  },
  imageButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  imageButtonText: { fontSize: 20 },
  textInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
