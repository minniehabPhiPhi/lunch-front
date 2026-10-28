// กติกาการจัดส่งตามโจทย์
export const MAX_ORDERS_PER_RIDER = 3; // ไรเดอร์รับไม่เกินคนละ 3 ออเดอร์
export const RIDER_TRIP_FEE = 15; // ค่าเรียกไรเดอร์ 15 บาท/เที่ยว
export const RIDER_RATE_PER_KM_BOX = 2; // ค่าระยะทาง กม.ละ 2 บาท ต่อ 1 กล่อง ที่ไรเดอร์ถือไป
export const RIDER_SPEED_KMH = 30; // ไรเดอร์ขับเฉลี่ย 30 กม./ชม.
export const DROP_OFF_MINUTES = 2; // เวลายื่นของให้ลูกค้าต่อ 1 จุด (ค่าสมมติ)
export const DEPARTURE_MINUTES = 11 * 60 + 30; // ไรเดอร์ออกจากร้าน 11:30 น.
export const DEADLINE_MINUTES = 12 * 60 + 30; // ต้องถึงมือลูกค้าไม่เกิน 12:30 น.

// สีเส้นทางไรเดอร์: คนที่ 1 แดง, 2 เขียว, 3 น้ำเงิน ตามตัวอย่างในโจทย์ แล้วเป็นสีอื่นที่แยกกันชัด ๆ
export const ROUTE_COLORS = [
  '#e53935', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#00897b',
  '#d81b60', '#6d4c41', '#3949ab', '#827717', '#00acc1', '#546e7a'
];

// วิธีจัดเส้นทางที่ระบบเสนอ
export type RouteStrategy = 'cheapest' | 'shortest' | 'fastest';

export const STRATEGY_LABELS: Record<RouteStrategy, string> = {
  cheapest: '💰 ประหยัดสุด',
  shortest: '📏 ระยะทางรวมสั้นสุด',
  fastest: '⚡ ส่งไวสุด'
};

export const STRATEGY_HINTS: Record<RouteStrategy, string> = {
  cheapest: 'ค่าไรเดอร์รวมต่ำสุด (กำไรสูงสุด)',
  shortest: 'ระยะทางที่ไรเดอร์ทุกคนวิ่งรวมกันสั้นสุด',
  fastest: 'ลูกค้ารอรวมกันสั้นสุด'
};

// จุดส่ง 1 จุด (1 ออเดอร์)
export interface RouteStop {
  orderId: string;
  name: string;
  phone: string;
  boxes: number;
  lat: number;
  lng: number;
  legKm: number; // ระยะจากจุดก่อนหน้า (จุดแรก = วัดจากร้าน)
  arrivalMin: number; // เวลาถึง (นาทีนับจากเที่ยงคืน)
  time: string; // เวลาถึงแบบอ่านง่าย เช่น "11:41 น."
}

// ใบงานของไรเดอร์ 1 คน
export interface RiderRoute {
  jobCode: string;
  riderName: string;
  color: string;
  totalBoxes: number;
  distanceKm: number; // ร้าน -> จุดที่ 1 -> ... -> จุดสุดท้าย
  durationMin: number; // ออกจากร้าน 11:30 จนส่งจุดสุดท้ายเสร็จ
  tripFee: number; // ค่าเรียกไรเดอร์
  distanceFee: number; // ค่าระยะทาง (2 บาท x กล่อง x กม.)
  cost: number; // ค่าไรเดอร์รวม = tripFee + distanceFee
  onTime: boolean; // ทุกจุดถึงไม่เกิน 12:30 หรือไม่
  stops: RouteStop[];
}

// สรุปภาพรวมของแผน (ใช้ดูกำไร/ขาดทุน และเวลา)
export interface PlanSummary {
  riders: number;
  orders: number;
  boxes: number;
  distanceKm: number;
  revenue: number;
  foodCost: number;
  tripFees: number;
  distanceFees: number;
  riderCost: number;
  profit: number; // ติดลบ = ขาดทุน
  longestMin: number; // ไรเดอร์ที่ใช้เวลานานสุด (นาที)
  lastArrivalTime: string; // เวลาที่ลูกค้าคนสุดท้ายได้รับของ
  lateStops: number; // จำนวนจุดที่ถึงหลัง 12:30
  allOnTime: boolean;
}

// แผนจัดเส้นทาง 1 แบบ
export interface RoutePlan {
  key: string; // ใช้เทียบว่าเป็นแผนเดียวกันหรือไม่
  strategies: RouteStrategy[]; // วิธีที่ให้ผลลัพธ์แผนนี้ (อาจตรงกันหลายวิธี)
  routes: RiderRoute[];
  summary: PlanSummary;
}

// ชุดข้อเสนอที่เก็บไว้ใน DeliveryService
export interface RouteState {
  signature: string; // ลายเซ็นของออเดอร์ตอนคำนวณ (ถ้าออเดอร์เปลี่ยนแผนนี้จะถูกทิ้ง)
  round: number; // คำนวณครั้งที่เท่าไหร่ (กดคำนวณใหม่แล้วเพิ่มขึ้น)
  plans: RoutePlan[];
  selected: number; // แผนที่เจ้าของร้านเลือกใช้
  seenKeys: string[]; // แผนที่เคยเสนอไปแล้ว (คำนวณใหม่จะเลี่ยงแผนซ้ำ)
}

// ใบงานที่หน้าไรเดอร์เปิดดู (รหัสใบงาน -> รายละเอียด)
export interface JobStop {
  name: string;
  boxes: number;
  phone: string;
  time: string;
  lat: number;
  lng: number;
}

export interface JobSheet {
  jobCode: string;
  riderName: string;
  color: string;
  boxes: number;
  stopsCount: number;
  distanceKm: number;
  durationMin: number;
  stops: JobStop[];
  publishedAt?: string; // เวลาที่เจ้าของร้านส่งใบงาน (backend ใส่ให้)
}
