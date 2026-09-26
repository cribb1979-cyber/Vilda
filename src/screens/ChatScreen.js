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
import { callNumber } from '../lib/maps';

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

function sortByTime(a, b) {
  return new Date(a.created_at) - new Date(b.created_at);
}

// Lägger till nya rader utan att skriva dubbletter: realtimen skickar även
// tillbaka våra egna meddelanden, och en omladdning kan komma ikapp samma rad.
function mergeMessages(prev, incoming) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(sortByTime);
}

// threadId === null är familjechatten. Annars är det tråden mellan mig och
// den personen. Ett meddelande hör till exakt en tråd.
function belongsToThread(message, threadId, myId) {
  if (threadId === null) return !message.recipient_id;
  return (
    (message.sender_id === myId && message.recipient_id === threadId) ||
    (message.sender_id === threadId && message.recipient_id === myId)
  );
}

export default function ChatScreen({ visible, onClose }) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [threadId, setThreadId] = useState(null); // null = familjechatten
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parentContact, setParentContact] = useState(null);
  const listRef = useRef(null);

  const myId = profile?.id;

  useEffect(() => {
    if (!visible) return;
    loadMembers();
    setThreadId(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    loadMessages(threadId);

    const channel = supabase
      .channel('chat-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (!active) return;
          // Realtimen levererar bara rader vi får se (reglerna i databasen
          // gäller även här), men vi visar bara den tråd som är öppen.
          if (!belongsToThread(payload.new, threadId, myId)) return;
          setMessages((prev) => mergeMessages(prev, [payload.new]));
        }
      )
      .subscribe((status) => {
        // Tappar vi realtimen (viloläge, dålig täckning, nystartad app) kommer
        // inga nya meddelanden alls. Hämta om i stället för att lita på att
        // prenumerationen lever.
        if (!active) return;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          loadMessages(threadId);
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [visible, threadId, myId]);

  async function loadMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, role')
      .neq('id', myId);
    setMembers(data || []);
  }

  // Ordningen är fallande med flit: stigande ordning + limit(100) ger de
  // ÄLDSTA hundra raderna, och så fort en tråd vuxit förbi 100 meddelanden
  // skulle nya meddelanden aldrig mer gå att hämta hem.
  async function loadMessages(currentThread) {
    let query = supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (currentThread === null) {
      query = query.is('recipient_id', null);
    } else {
      query = query.or(
        `and(sender_id.eq.${myId},recipient_id.eq.${currentThread}),` +
          `and(sender_id.eq.${currentThread},recipient_id.eq.${myId})`
      );
    }

    const { data, error } = await query;
    if (error) return;
    setMessages((data || []).slice().reverse());
  }

  function memberName(id) {
    return members.find((m) => m.id === id)?.display_name || 'Någon';
  }

  async function handleCallParent() {
    // Namnet hämtas i stället för att skriva "pappa" rakt av — i en annan
    // familj kan föräldern heta något helt annat.
    let contact = parentContact;
    if (!contact) {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, phone_number')
        .eq('role', 'parent')
        .not('phone_number', 'is', null)
        .limit(1)
        .maybeSingle();
      contact = data;
      if (contact) setParentContact(contact);
    }

    if (!contact?.phone_number) {
      Alert.alert('Inget nummer sparat', 'Föräldern har inte lagt in sitt telefonnummer än.');
      return;
    }
    callNumber(contact.phone_number);
  }

  async function sendText() {
    if (!text.trim()) return;
    await sendMessage(text.trim());
    setText('');
  }

  async function sendMessage(content) {
    setSending(true);
    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_id: myId,
        recipient_id: threadId, // null = familjechatten
        content,
        message_type: 'text',
      })
      .select()
      .single();
    setSending(false);
    if (error) {
      Alert.alert('Kunde inte skicka', error.message);
      return;
    }
    // Visa meddelandet direkt i stället för att vänta på att realtimen ekar
    // tillbaka det.
    if (data) setMessages((prev) => mergeMessages(prev, [data]));
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
      Alert.alert('Ingen åtkomst', 'Appen behöver behörighet för att göra detta.');
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
      // En mapp per familj — det är så åtkomsten avgränsas i databasen.
      // Filnamnet är slumpat: bucketen är publik, och ett namn som går att
      // gissa (en tidsstämpel) räcker för att någon ska kunna hämta bilden
      // utan inloggning om de får tag i familjens id.
      const randomPart =
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const path = `${profile.family_id}/${randomPart}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('chat-images').getPublicUrl(path);

      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          sender_id: myId,
          recipient_id: threadId,
          content: publicUrl,
          message_type: 'image',
        })
        .select()
        .single();
      if (insertError) throw insertError;
      if (data) setMessages((prev) => mergeMessages(prev, [data]));
    } catch (error) {
      Alert.alert('Kunde inte skicka bilden', error.message);
    } finally {
      setUploading(false);
    }
  }

  const activeName = threadId === null ? 'Familjen' : memberName(threadId);

  return (
    <Modal visible={visible} animationType="slide">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={60}
      >
        <View style={styles.header}>
          <Text style={styles.title}>💬 {activeName}</Text>
          <View style={styles.headerButtons}>
            {profile?.role === 'child' && (
              <TouchableOpacity onPress={handleCallParent}>
                <Text style={styles.callText}>
                  📞 Ring {parentContact?.display_name || 'förälder'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>Stäng</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.threadRow}>
          <TouchableOpacity
            style={[styles.threadChip, threadId === null && styles.threadChipActive]}
            onPress={() => setThreadId(null)}
          >
            <Text style={[styles.threadChipText, threadId === null && styles.threadChipTextActive]}>
              👨👩👧 Familjen
            </Text>
          </TouchableOpacity>
          {members.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.threadChip, threadId === m.id && styles.threadChipActive]}
              onPress={() => setThreadId(m.id)}
            >
              <Text style={[styles.threadChipText, threadId === m.id && styles.threadChipTextActive]}>
                {m.role === 'child' ? '🧒' : '🧑'} {m.display_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {threadId !== null && (
          <Text style={styles.privateHint}>
            🔒 Bara du och {memberName(threadId)} ser den här tråden.
          </Text>
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              isMine={item.sender_id === myId}
              senderName={item.sender_id === myId ? null : memberName(item.sender_id)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
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
            placeholder={threadId === null ? 'Skriv till familjen...' : `Skriv till ${activeName}...`}
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

function MessageBubble({ item, isMine, senderName }) {
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
        {senderName && <Text style={styles.senderName}>{senderName}</Text>}
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
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  callText: { color: '#7C3AED', fontSize: 14, fontWeight: '600' },
  closeText: { color: '#7C3AED', fontSize: 14 },
  threadRow: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  threadChip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  threadChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  threadChipText: { fontSize: 13, fontWeight: '600', color: '#6D28D9' },
  threadChipTextActive: { color: '#fff' },
  privateHint: {
    fontSize: 12,
    color: '#7C3AED',
    textAlign: 'center',
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  bubbleRow: { paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, padding: 12 },
  bubbleMine: { backgroundColor: '#7C3AED' },
  bubbleTheirs: { backgroundColor: '#fff' },
  senderName: { fontSize: 12, fontWeight: '700', color: '#7C3AED', marginBottom: 4 },
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
