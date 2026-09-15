export function staticMapUrl(latitude, longitude, { zoom = 15, width = 600, height = 300 } = {}) {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik&markers=${latitude},${longitude},red-pushpin`;
}
