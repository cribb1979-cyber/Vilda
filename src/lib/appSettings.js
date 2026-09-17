import { supabase } from './supabase';

export async function fetchAppDisplayName() {
  const { data } = await supabase.from('app_settings').select('display_name').eq('id', 1).maybeSingle();
  return data?.display_name || 'Vilda';
}
