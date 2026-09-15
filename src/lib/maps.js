import { Linking, Alert } from 'react-native';

export async function openInMaps(latitude, longitude, label = 'Plats') {
  const url = `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(label)}`;
  try {
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert('Kunde inte öppna Kartor', 'Något gick fel.');
  }
}
