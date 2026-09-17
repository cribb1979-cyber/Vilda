import { Linking, Alert } from 'react-native';

export async function openInMaps(latitude, longitude, label = 'Plats') {
  const url = `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(label)}`;
  try {
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert('Kunde inte öppna Kartor', 'Något gick fel.');
  }
}

export async function openWalkingDirections(latitude, longitude, label = 'Plats') {
  const url = `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w&t=m`;
  try {
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert('Kunde inte öppna vägbeskrivning', 'Något gick fel.');
  }
}

export async function callNumber(phoneNumber) {
  const sanitized = phoneNumber.replace(/[^\d+]/g, '');
  try {
    await Linking.openURL(`tel:${sanitized}`);
  } catch (e) {
    Alert.alert('Kunde inte ringa', 'Något gick fel.');
  }
}
