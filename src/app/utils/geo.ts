export interface LatLng {
  lat: number;
  lng: number;
}

// พิกัดร้านข้าวกล่อง (โซน มมส.) และรัศมีจัดส่งสูงสุดตามโจทย์
export const SHOP_LOCATION: LatLng = { lat: 16.2452, lng: 103.2501 };
export const DELIVERY_RADIUS_KM = 3;

// ระยะทางเส้นตรงระหว่าง 2 พิกัด (กิโลเมตร) - สูตร Haversine
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// สุ่มพิกัดภายในวงกลมรัศมี radiusKm รอบ center (กระจายสม่ำเสมอทั้งวง)
export function randomPointInRadius(center: LatLng, radiusKm: number): LatLng {
  const r = radiusKm * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  return {
    lat: Number((center.lat + (r * Math.cos(theta)) / kmPerDegLat).toFixed(6)),
    lng: Number((center.lng + (r * Math.sin(theta)) / kmPerDegLng).toFixed(6))
  };
}
