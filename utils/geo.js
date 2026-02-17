/**
 * Расчёт дистанции между двумя точками (Haversine), метры.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} расстояние в метрах
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // радиус Земли в метрах
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_SPIN_DISTANCE_M = 200;

function isWithinSpinRadius(clubLat, clubLon, userLat, userLon) {
  if (
    clubLat == null ||
    clubLon == null ||
    userLat == null ||
    userLon == null ||
    Number.isNaN(Number(userLat)) ||
    Number.isNaN(Number(userLon))
  ) {
    return false;
  }
  const dist = distanceMeters(
    Number(clubLat),
    Number(clubLon),
    Number(userLat),
    Number(userLon)
  );
  return dist <= MAX_SPIN_DISTANCE_M;
}

module.exports = {
  distanceMeters,
  MAX_SPIN_DISTANCE_M,
  isWithinSpinRadius,
};
