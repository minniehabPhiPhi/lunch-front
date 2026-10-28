import { CustomerForm, CustomerInfo } from './customer.model';
import { ORDER_STATUS_WAITING, OrderRecord } from './order.model';
import { formatTime } from '../utils/time';

// ---------- แถวข้อมูลที่ backend ส่งมา (ชื่อ field ตามตารางในฐานข้อมูล) ----------
export interface CustomerRow {
  customer_id: number;
  first_name: string;
  last_name: string;
  phone_number: string;
  // MySQL ส่งค่า DECIMAL มาเป็นข้อความ เช่น "16.246500" จึงต้องแปลงเป็นตัวเลขก่อนใช้
  latitude: string | number | null;
  longitude: string | number | null;
  address_detail: string;
}

// GET /api/orders ส่งมาเป็นออเดอร์ + ข้อมูลลูกค้า (join แล้ว)
export interface OrderRow {
  order_id: number;
  quantity: number;
  order_status: string;
  created_at: string | null;
  customer_id: number;
}

// สถานะออเดอร์ในฐานข้อมูลที่หน้าเว็บนี้ใช้งาน (pending = รอจัดเส้นทาง)
export const API_STATUS_PENDING = 'pending';

// ---------- ชื่อ: หน้าเว็บมีช่องเดียว แต่ฐานข้อมูลแยก first_name / last_name ----------
// backend บังคับให้ last_name ห้ามว่าง ถ้าลูกค้าไม่มีนามสกุลจะเก็บเป็น "-"
export const NO_LAST_NAME = '-';

export function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  const first = parts.shift() ?? '';
  return { first_name: first, last_name: parts.join(' ') || NO_LAST_NAME };
}

export function joinName(first: string | null, last: string | null): string {
  const lastName = (last ?? '').trim();
  const firstName = (first ?? '').trim();
  return lastName && lastName !== NO_LAST_NAME ? `${firstName} ${lastName}`.trim() : firstName;
}

// ---------- แปลงข้อมูลระหว่างหน้าเว็บ <-> backend ----------
function toNumber(value: string | number | null): number {
  return value === null || value === '' ? NaN : Number(value);
}

export function toCustomer(row: CustomerRow): CustomerInfo {
  return {
    id: row.customer_id,
    name: joinName(row.first_name, row.last_name),
    phone: row.phone_number ?? '',
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    address: row.address_detail ?? ''
  };
}

// body ของ POST/PUT /api/customers
export function toCustomerBody(form: CustomerForm) {
  return {
    ...splitName(form.name),
    phone_number: form.phone,
    latitude: form.lat,
    longitude: form.lng,
    address_detail: form.address
  };
}

// รหัสออเดอร์ที่แสดงบนหน้าเว็บ: order_id 12 <-> "ORD-012"
export function orderCode(orderId: number): string {
  return `ORD-${String(orderId).padStart(3, '0')}`;
}

export function orderIdOf(code: string): number {
  return Number(code.replace(/\D/g, ''));
}

// created_at (เวลาที่ฐานข้อมูลบันทึก) -> "11:15 น."
function orderTime(createdAt: string | null): string {
  if (!createdAt) {
    return '-';
  }
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '-' : formatTime(date.getHours() * 60 + date.getMinutes());
}

export function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: orderCode(row.order_id),
    customerId: row.customer_id,
    quantity: Number(row.quantity),
    status: ORDER_STATUS_WAITING,
    time: orderTime(row.created_at)
  };
}
