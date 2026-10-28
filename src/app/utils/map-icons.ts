// หมุดบนแผนที่ Leaflet (วาดด้วย SVG แทนอีโมจิ)
// ใช้กับ L.divIcon({ html, className: '', iconSize, iconAnchor })

// ร้าน: สี่เหลี่ยมมุมมนสีน้ำตาลเข้ม มีรูปหน้าร้าน (จุดยึด = กึ่งกลาง)
export const SHOP_ICON = {
  html:
    '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">' +
    '<rect x="1" y="1" width="28" height="28" rx="7" fill="#4E342E" stroke="#fff" stroke-width="2"/>' +
    '<path d="M8 13.5 9.5 9h11l1.5 4.5M8 13.5h14M9.5 13.5V21h11v-7.5M13 21v-4h4v4" ' +
    'fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>',
  size: [30, 30] as [number, number],
  anchor: [15, 15] as [number, number]
};

// หมุดเลือกตำแหน่งบ้านลูกค้า: หยดน้ำสีแดง (จุดยึด = ปลายแหลมด้านล่าง)
export const PIN_ICON = {
  html:
    '<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true">' +
    '<path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.5 14 37 14 37s13-13.5 13-23.2C27 6.7 21.2 1 14 1Z" ' +
    'fill="#D32F2F" stroke="#fff" stroke-width="2"/>' +
    '<circle cx="14" cy="14" r="5" fill="#fff"/>' +
    '</svg>',
  size: [28, 38] as [number, number],
  anchor: [14, 37] as [number, number]
};
