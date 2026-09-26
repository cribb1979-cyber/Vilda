import { supabase } from './supabase';

// Produktnamnet som visas innan man loggat in. Familjens eget namn finns
// per familj och kan bara läsas när man vet vilken familj man tillhör.
// Ändra gärna den här raden om appen ska heta något annat utåt.
export const APP_NAME = 'Trygghetsappen';

export async function fetchFamilySettings(familyId) {
  if (!familyId) return null;
  const { data } = await supabase
    .from('app_settings')
    .select('display_name, ai_chat_enabled')
    .eq('family_id', familyId)
    .maybeSingle();
  return data || null;
}

export async function fetchAppDisplayName(familyId) {
  const settings = await fetchFamilySettings(familyId);
  return settings?.display_name || APP_NAME;
}

export async function fetchAiChatEnabled(familyId) {
  const settings = await fetchFamilySettings(familyId);
  return settings?.ai_chat_enabled || false;
}
