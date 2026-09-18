import { supabase } from './supabase';

export async function fetchAppDisplayName() {
  const { data } = await supabase.from('app_settings').select('display_name').eq('id', 1).maybeSingle();
  return data?.display_name || 'Vilda';
}

export async function fetchAiChatEnabled() {
  const { data } = await supabase.from('app_settings').select('ai_chat_enabled').eq('id', 1).maybeSingle();
  return data?.ai_chat_enabled || false;
}
