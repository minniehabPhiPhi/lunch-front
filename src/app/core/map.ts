import { P } from './planner';
declare const L: any;

export const ok = (lat: number, lng: number) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);
export const around = (c: P) => L.latLng(c.lat, c.lng).toBounds(6400); // กรอบรัศมี ~3 กม.

export function makeMap(el: HTMLElement, c: P) {
  const m = L.map(el).setView([c.lat, c.lng], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'soft' }).addTo(m);
  return m;
}

/** วงรัศมี 1-3 กม. + หมุดร้าน (ส่ง onMove เพื่อให้ลากย้ายร้านได้) */
export function baseLayer(shop: P, onMove?: (p: P) => void) {
  const g = L.layerGroup(), kmLng = 111.32 * Math.cos(shop.lat * Math.PI / 180);
  for (const km of [1, 2, 3]) {
    L.circle([shop.lat, shop.lng], { radius: km * 1000, color: '#a9b5a0', weight: 1, dashArray: '3 6', fill: false, interactive: false }).addTo(g);
    if (km > 1) L.marker([shop.lat, shop.lng + km / kmLng], { interactive: false, icon: L.divIcon({ className: 'ringlab', html: `${km} กม.`, iconSize: [0, 0] }) }).addTo(g);
  }
  const m = L.marker([shop.lat, shop.lng], { draggable: !!onMove, zIndexOffset: 1000, icon: L.divIcon({ className: 'shopm', html: '<i>🍱</i><b>ร้าน</b>', iconSize: [0, 0] }) }).addTo(g);
  if (onMove) m.on('dragend', () => { const p = m.getLatLng(); onMove({ lat: p.lat, lng: p.lng }); });
  return g;
}
