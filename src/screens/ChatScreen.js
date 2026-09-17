import React, { useEffect, useRef, useState } from 'react';
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
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const PARENT_QUICK_MESSAGES = [
  '👀 Jag ser dig',
  '🎉 Bra jobbat, du är framme!',
  '❤️ Älskar dig',
  '📞 Ring mig när du kan',
  '🚗 Kommer snart',
  '📍 Vart är du?',
  '📞 Ring mig, viktigt!',
];

const CHILD_QUICK_MESSAGES = [
  '😊 Allt bra!',
  '🏠 Är snart hemma',
  '❤️ Puss och kram',
  '🍽️ Vad blir det till mat?',
];

export default function ChatScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    loadMessages();

    const channel = supabase
      .channel('chat-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [visible]);

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);
    setMessages(data || []);
  }

  async function sendText() {
    if (!text.trim()) return;
    await sendMessage(text.trim());
    setText('');
  }

  async function sendMessage(content) {
    setSending(true);
    const { error } = await supabase.from('messages').insert({
      sender_id: profile.id,
      content,
      message_type: 'text',
    });
    setSending(false);
    if (error) {
      Alert.alert('Kunde inte skicka', error.message);
    }
  }

  function pickImage() {
    Alert.alert('Skicka bild', 'Vad vill du göra?', [
      { text: 'Ta en bild', onPress: () => captureAndSend(true) },
      { text: 'Välj från bibliotek', onPress: () => captureAndSend(false) },
      { text: 'Avbryt', style: 'cancel' },
    ]);
  }

  async function captureAndSend(fromCamera) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== 'granted') {
      Alert.alert('Ingen åtkomst', 'Vilda behöver behörighet för att göra detta.');
      return;
    }

    const options = { mediaTypes: ['images'], quality: 0.5 };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    await uploadAndSendImage(result.assets[0].uri);
  }

  async function uploadAndSendImage(uri) {
    setUploading(true);
    try {
      const file = new File(uri);
      const arrayBuffer = await file.arrayBuffer();
      const path = `${profile.id}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('chat-images').getPublicUrl(path);

      const { error: insertError } = await supabase.from('messages').insert({
        sender_id: profile.id,
        content: publicUrl,
        message_type: 'image',
      });
      if (insertError) throw insertError;
    } catch (error) {
      Alert.alert('Kunde inte skicka bilden', error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={60}
      >
        <View style={styles.header}>
          <Text style={styles.title}>💬 Chatt</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeText}>Stäng</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble item={item} isMine={item.sender_id === profile?.id} />}
          contentContainerStyle={{ paddingVertical: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        {profile?.role && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickRow}
          >
            {(profile.role === 'parent' ? PARENT_QUICK_MESSAGES : CHILD_QUICK_MESSAGES).map((msg) => (
              <TouchableOpacity
                key={msg}
                style={styles.quickButton}
                onPress={() => sendMessage(msg)}
                disabled={sending}
              >
                <Text style={styles.quickButtonText}>{msg}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.imageButton} onPress={pickImage} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color="#7C3AED" />
            ) : (
              <Text style={styles.imageButtonText}>📷</Text>
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            placeholder="Skriv ett meddelande..."
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendText} disabled={sending || !text.trim()}>
            <Text style={styles.sendButtonText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MessageBubble({ item, isMine }) {
  if (item.message_type === 'arrived') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>✅ {item.content}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {item.message_type === 'image' ? (
          <Image source={{ uri: item.content }} style={styles.bubbleImage} />
        ) : (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{item.content}</Text>
        )}
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
  bubbleRow: { paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, padding: 12 },
  bubbleMine: { backgroundColor: '#7C3AED' },
  bubbleTheirs: { backgroundColor: '#fff' },
  bubbleText: { fontSize: 15, color: '#333' },
  bubbleTextMine: { color: '#fff' },
  bubbleImage: { width: 200, height: 200, borderRadius: 10 },
  systemRow: { alignItems: 'center', marginBottom: 8, paddingHorizontal: 16 },
  systemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4C1D95',
    backgroundColor: '#EDE9FE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
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
  quickRow: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  quickButton: {
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickButtonText: { fontSize: 13, fontWeight: '600', color: '#6D28D9' },
});
