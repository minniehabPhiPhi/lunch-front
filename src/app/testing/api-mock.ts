import { HttpTestingController } from '@angular/common/http/testing';
import { API_URL } from '../config';
import { CustomerRow, OrderRow } from '../models/api.model';
import { DELIVERY_RADIUS_KM, SHOP_LOCATION, randomPointInRadius } from '../utils/geo';

// ข้อมูลจำลองหน้าตาเหมือนที่ backend ส่งมาจริง (พิกัดเป็น string เพราะ MySQL ส่ง DECIMAL มาแบบนั้น)
export interface ApiData {
  customers: CustomerRow[];
  orders: OrderRow[];
}

export function customerRow(id: number, lat: number, lng: number, name = `ลูกค้า ${id}`): CustomerRow {
  const [first, ...rest] = name.split(' ');
  return {
    customer_id: id,
    first_name: first ?? '',
    last_name: rest.join(' ') || '-',
    phone_number: `08${String(10000000 + id)}`,
    latitude: lat.toFixed(6),
    longitude: lng.toFixed(6),
    address_detail: `บ้านเลขที่ ${id}`
  };
}

export function orderRow(id: number, customerId: number, quantity = 1, status = 'pending'): OrderRow {
  return {
    order_id: id,
    quantity,
    order_status: status,
    created_at: '2026-10-27T03:30:00.000Z',
    customer_id: customerId
  };
}

// ลูกค้า count คน กระจายในรัศมี 3 กม. คนละ 1 ออเดอร์ (1-3 กล่อง)
export function randomApiData(count = 24): ApiData {
  const customers = Array.from({ length: count }, (_, i) => {
    const p = randomPointInRadius(SHOP_LOCATION, DELIVERY_RADIUS_KM * 0.98);
    return customerRow(i + 1, p.lat, p.lng);
  });
  const orders = customers.map((c, i) => orderRow(i + 1, c.customer_id, (i % 3) + 1));
  return { customers, orders };
}

const isGet = (path: string) => (req: { method: string; url: string }) =>
  req.method === 'GET' && req.url === `${API_URL}${path}`;

// ตอบทุกคำขอ GET /customers และ GET /orders ที่ค้างอยู่ด้วยข้อมูลจำลอง
export function flushLists(http: HttpTestingController, data: ApiData) {
  http.match(isGet('/customers')).forEach(r => r.flush(data.customers));
  http.match(isGet('/orders')).forEach(r => r.flush(data.orders));
}

// ---------- ใบงานไรเดอร์ (/jobs) ----------
const isJobs = (method: string) => (req: { method: string; url: string }) =>
  req.method === method && req.url === `${API_URL}/jobs`;

// ตอบคำขอ GET /jobs ที่ค้างอยู่ (ไรเดอร์เปิดหน้า / กดโหลดใหม่)
export function flushJobsGet(http: HttpTestingController, jobs: unknown[] = []) {
  http.match(isJobs('GET')).forEach(r => r.flush(jobs));
}

// ตอบคำขอ PUT /jobs (ส่งใบงาน) ที่ค้างอยู่ทั้งหมด คืน body ที่หน้าเว็บส่งมา
export function flushJobsPut(http: HttpTestingController): { jobs: { jobCode: string }[] }[] {
  return http.match(isJobs('PUT')).map(r => {
    r.flush({ affected_row: r.request.body.jobs.length });
    return r.request.body;
  });
}

// ตอบคำขอ DELETE /jobs (ล้างใบงาน) ที่ค้างอยู่
export function flushJobsDelete(http: HttpTestingController) {
  http.match(isJobs('DELETE')).forEach(r => r.flush({ affected_row: 0 }));
}

// รอให้ promise ที่ค้างอยู่ทำงานต่อ (หลังตอบคำขอ HTTP แล้วจะมีคำขอถัดไปตามมา)
export const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
