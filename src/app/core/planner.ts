import { OrderRow as Order } from './api';

export const PRICE = 65, FOOD_COST = 40, RIDER_BASE = 15, PER_KM_BOX = 2;
export const SPEED_KMH = 30, STOP_MIN = 2, LIMIT_MIN = 60, MAX_ORDERS = 3, DETOUR = 1.3;
export const COLORS = ['#d62828', '#1f9d55', '#1d4ed8', '#f77f00', '#7b2cbf', '#0891b2', '#c2185b', '#6d4c41', '#65a30d', '#e11d48', '#0f766e', '#4338ca'];

export interface P { lat: number; lng: number }
export interface Trip {
  id: number; color: string; stops: Order[]; boxes: number; km: number;
  arrive: number[]; fee: number; profit: number; late: boolean;
}

export const dist = (a: P, b: P) => {
  const r = (x: number) => x * Math.PI / 180, R = 6371;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * DETOUR;
};

const perms = <T>(a: T[]): T[][] => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));

function evalGroup(g: Order[], shop: P) {
  let best: { stops: Order[]; km: number; arrive: number[] } | null = null;
  for (const p of perms(g)) {
    let km = 0, prev: P = shop; const arrive: number[] = [];
    for (const s of p) { km += dist(prev, s); arrive.push(Math.round(km / SPEED_KMH * 60 + STOP_MIN * (arrive.length + 1))); prev = s; }
    if (!best || km < best.km) best = { stops: p, km, arrive };
  }
  const boxes = g.reduce((a, o) => a + o.qty, 0);
  const fee = RIDER_BASE + PER_KM_BOX * boxes * best!.km;
  return { ...best!, boxes, fee, profit: boxes * (PRICE - FOOD_COST) - fee, late: best!.arrive[best!.arrive.length - 1] > LIMIT_MIN };
}

// แบ่งกลุ่ม: 'near' = จับกลุ่มตามความใกล้กัน, ตัวเลข = กวาดตามมุมรอบร้านโดยเริ่มจากมุมนั้น
function group(orders: Order[], shop: P, mode: 'near' | number): Order[][] {
  const out: Order[][] = [];
  if (mode === 'near') {
    const left = [...orders];
    while (left.length) {
      left.sort((a, b) => dist(shop, b) - dist(shop, a));
      const seed = left.shift()!, g = [seed];
      while (g.length < MAX_ORDERS && left.length) { left.sort((a, b) => dist(seed, a) - dist(seed, b)); g.push(left.shift()!); }
      out.push(g);
    }
  } else {
    const ang = (o: Order) => (Math.atan2(o.lat - shop.lat, o.lng - shop.lng) + mode + 4 * Math.PI) % (2 * Math.PI);
    const s = [...orders].sort((a, b) => ang(a) - ang(b));
    for (let i = 0; i < s.length; i += MAX_ORDERS) out.push(s.slice(i, i + MAX_ORDERS));
  }
  return out;
}

const score = (t: Trip[]) => t.reduce((a, x) => a + x.fee + (x.late ? 1000 : 0), 0);

/** สร้างหลายแผน เรียงจากประหยัดสุดไปน้อยสุด (ตัดแผนที่ซ้ำกัน) */
export function candidates(orders: Order[], shop: P, keep = 3): Trip[][] {
  const modes: ('near' | number)[] = ['near', ...Array.from({ length: 24 }, (_, k) => k * Math.PI / 12), ...Array.from({ length: 20 }, () => Math.random() * 2 * Math.PI)];
  const plans = modes.map(m => group(orders, shop, m).map(g => evalGroup(g, shop))
    .sort((a, b) => Math.atan2(a.stops[0].lat - shop.lat, a.stops[0].lng - shop.lng) - Math.atan2(b.stops[0].lat - shop.lat, b.stops[0].lng - shop.lng))
    .map((t, i) => ({ ...t, id: i + 1, color: COLORS[i % COLORS.length] }) as Trip));
  plans.sort((a, b) => score(a) - score(b));
  const seen = new Set<number>();
  return plans.filter(p => { const k = Math.round(score(p)); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, keep);
}

export const START_MIN = 11 * 60 + 30; // ออกจากร้าน 11:30
export const clock = (m: number) => { const t = START_MIN + Math.round(m); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
export const jobCode = (id: number) => `JOB-${String(id).padStart(2, '0')}`;
export const baht = (n: number) => `${Math.round(n).toLocaleString('en-US')} ฿`;
export const signed = (n: number) => `${n >= 0 ? '+' : '-'}${baht(Math.abs(n))}`;
