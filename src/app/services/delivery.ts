import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { API_URL } from '../config';
import {
  API_STATUS_PENDING,
  CustomerRow,
  OrderRow,
  orderIdOf,
  toCustomer,
  toCustomerBody,
  toOrderRecord
} from '../models/api.model';
import { CustomerForm, CustomerInfo } from '../models/customer.model';
import { MAX_BOXES_PER_ORDER, OrderInfo, OrderRecord } from '../models/order.model';
import { JobSheet, RoutePlan, RouteState } from '../models/route.model';

function clampQuantity(quantity: number): number {
  return Math.min(MAX_BOXES_PER_ORDER, Math.max(1, Math.round(quantity)));
}

// error ที่เราตั้งข้อความเองเป็นภาษาไทย (ไม่ใช่ error จาก backend)
class AppError extends Error {}

// แปลง error ของ HTTP ให้เป็นข้อความที่เจ้าของร้านอ่านรู้เรื่อง
function describeError(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'เชื่อมต่อ backend ไม่ได้ — เช็กว่ารัน backend อยู่ และ API_URL ใน src/app/config.ts ถูกต้อง';
    }
    const detail = error.error?.error ?? error.error?.message;
    return typeof detail === 'string' ? `${detail} (HTTP ${error.status})` : `backend ตอบกลับผิดพลาด (HTTP ${error.status})`;
  }
  return 'เกิดข้อผิดพลาดที่ไม่คาดคิด';
}

@Injectable({
  providedIn: 'root'
})
export class DeliveryService {
  private readonly http = inject(HttpClient);

  // ---------- สถานะการคุยกับ backend ----------
  private readonly pending = signal(0);
  readonly loading = computed(() => this.pending() > 0);
  // ข้อความ error ล่าสุด ('' = ไม่มี) ทุกหน้าเอาไปแสดงได้
  readonly error = signal('');

  // รันงานที่คุยกับ backend: นับสถานะ loading, เก็บ error ไว้แสดง, คืน true/false ว่าสำเร็จไหม
  private async call(task: () => Promise<unknown>): Promise<boolean> {
    this.pending.update(n => n + 1);
    this.error.set('');
    try {
      await task();
      return true;
    } catch (error) {
      this.error.set(describeError(error));
      return false;
    } finally {
      this.pending.update(n => n - 1);
    }
  }

  // ---------- ข้อมูลหลัก (ดึงจากฐานข้อมูลผ่าน backend) ----------
  private readonly _customers = signal<CustomerInfo[]>([]);
  readonly customers = this._customers.asReadonly();

  private readonly _orders = signal<OrderRecord[]>([]);

  // ออเดอร์ + ข้อมูลลูกค้า (ชื่อ/เบอร์/พิกัด) -> ถ้าแก้ข้อมูลลูกค้า ออเดอร์จะอัปเดตตามเอง
  readonly orders = computed<OrderInfo[]>(() => {
    const byId = new Map(this._customers().map(c => [c.id, c]));
    return this._orders().flatMap(o => {
      const c = byId.get(o.customerId);
      return c ? [{ ...o, customerName: c.name, phone: c.phone, lat: c.lat, lng: c.lng }] : [];
    });
  });

  // ดึงออเดอร์ (หน้าจัดเส้นทางใช้ตัวนี้)
  getOrders() {
    return this.orders();
  }

  // โหลดลูกค้า + ออเดอร์ล่าสุดจากฐานข้อมูล (ไม่จัดการ error — ให้ตัวที่เรียกจัดการเอง)
  private async load(): Promise<void> {
    const [customerRows, orderRows] = await firstValueFrom(
      forkJoin([
        this.http.get<CustomerRow[]>(`${API_URL}/customers`),
        this.http.get<OrderRow[]>(`${API_URL}/orders`)
      ])
    );

    // ลูกค้าที่ไม่มีพิกัดวางบนแผนที่/คำนวณเส้นทางไม่ได้ จึงข้ามไป
    this._customers.set(
      customerRows.map(toCustomer).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
    );

    // หน้าเว็บนี้ทำงานกับออเดอร์ที่ "รอส่ง" (pending) เท่านั้น เรียงตามรหัสจากเก่าไปใหม่
    this._orders.set(
      orderRows
        .filter(o => o.order_status === API_STATUS_PENDING)
        .sort((a, b) => a.order_id - b.order_id)
        .map(toOrderRecord)
    );
  }

  // โหลดข้อมูลใหม่จากฐานข้อมูล (แต่ละหน้าเรียกตอนเปิดหน้า)
  refresh(): Promise<boolean> {
    return this.call(() => this.load());
  }

  // ---------- ลูกค้า ----------
  addCustomer(data: CustomerForm): Promise<boolean> {
    return this.call(async () => {
      await firstValueFrom(this.http.post(`${API_URL}/customers`, toCustomerBody(data)));
      await this.load();
    });
  }

  updateCustomer(id: number, data: CustomerForm): Promise<boolean> {
    return this.call(async () => {
      await firstValueFrom(this.http.put(`${API_URL}/customers/${id}`, toCustomerBody(data)));
      await this.load();
    });
  }

  // backend ลบออเดอร์ของลูกค้าคนนั้นให้เองด้วย
  removeCustomer(id: number): Promise<boolean> {
    return this.call(async () => {
      await firstValueFrom(this.http.delete(`${API_URL}/customers/${id}`));
      await this.load();
    });
  }

  // ---------- ออเดอร์ ----------
  // เพิ่มออเดอร์ (ลูกค้า 1 คน = 1 ออเดอร์ ถ้าอยากเปลี่ยนจำนวนให้แก้ออเดอร์เดิม)
  addOrder(customerId: number, quantity: number): Promise<boolean> {
    const customerExists = this._customers().some(c => c.id === customerId);
    const alreadyOrdered = this._orders().some(o => o.customerId === customerId);
    if (!customerExists || alreadyOrdered) {
      return Promise.resolve(false);
    }
    return this.call(async () => {
      await firstValueFrom(
        this.http.post(`${API_URL}/orders`, { customer_id: customerId, quantity: clampQuantity(quantity) })
      );
      await this.load();
    });
  }

  // เปลี่ยนจำนวนกล่อง: อัปเดตหน้าจอทันที (กดรัว ๆ ได้) แล้วค่อยบันทึกลงฐานข้อมูล
  async updateOrderQuantity(code: string, quantity: number): Promise<boolean> {
    const q = clampQuantity(quantity);
    this._orders.update(list => list.map(o => (o.id === code ? { ...o, quantity: q } : o)));

    const ok = await this.call(() =>
      firstValueFrom(this.http.put(`${API_URL}/orders/${orderIdOf(code)}`, { quantity: q }))
    );
    if (!ok) {
      // บันทึกไม่สำเร็จ -> ดึงค่าจริงจากฐานข้อมูลกลับมาแสดง (เก็บข้อความ error ไว้)
      await this.load().catch(() => undefined);
    }
    return ok;
  }

  removeOrder(code: string): Promise<boolean> {
    return this.call(async () => {
      await firstValueFrom(this.http.delete(`${API_URL}/orders/${orderIdOf(code)}`));
      await this.load();
    });
  }

  // ล้างออเดอร์ทั้งหมดในฐานข้อมูล (ลูกค้ายังอยู่)
  // ใบงานชุดเดิมอ้างอิงออเดอร์ที่ถูกลบไปแล้ว จึงล้างใบงานด้วย
  clearOrders(): Promise<boolean> {
    return this.call(async () => {
      await firstValueFrom(this.http.delete(`${API_URL}/orders`));
      await this.clearPublishedJobs();
      await this.load();
    });
  }

  // สุ่มออเดอร์ 20-30 รายการ (backend สุ่มจากลูกค้าที่มีอยู่ในฐานข้อมูล ออเดอร์ละ 1-3 กล่อง)
  // ออเดอร์ชุดเดิมจะถูกล้างก่อน = แทนที่ด้วยชุดใหม่
  simulateOrders(): Promise<boolean> {
    return this.call(async () => {
      await this.load(); // เช็กรายชื่อลูกค้าล่าสุดก่อน จะได้ไม่ล้างออเดอร์ทิ้งฟรี ๆ
      if (this._customers().length === 0) {
        throw new AppError('ยังไม่มีลูกค้าในฐานข้อมูล กรุณาเพิ่มลูกค้าที่หน้า "1. ข้อมูลลูกค้า" ก่อนสุ่มออเดอร์ครับ');
      }
      await firstValueFrom(this.http.delete(`${API_URL}/orders`));
      await this.clearPublishedJobs();
      await firstValueFrom(this.http.post(`${API_URL}/orders/seed`, {}));
      await this.load();
    });
  }

  // ---------- แผนจัดเส้นทาง / ใบงาน ----------
  private readonly _routeState = signal<RouteState | null>(null);

  // ลายเซ็นของออเดอร์ตอนนี้ (รวมชื่อ/เบอร์/พิกัดลูกค้า) ใช้เช็คว่าแผนที่คำนวณไว้ยังตรงกับออเดอร์อยู่ไหม
  private readonly ordersSignature = computed(() =>
    this.orders()
      .map(o => [o.id, o.customerId, o.quantity, o.customerName, o.phone, o.lat, o.lng].join('|'))
      .join(';')
  );

  // ชุดแผนที่เสนอไว้ -> ถ้าออเดอร์เปลี่ยนไปหลังคำนวณ แผนเก่าจะใช้ไม่ได้ (เป็น null) ต้องคำนวณใหม่
  readonly routeState = computed(() => {
    const state = this._routeState();
    return state && state.signature === this.ordersSignature() ? state : null;
  });

  // true = เคยจัดเส้นทางไว้แล้ว แต่ออเดอร์เปลี่ยนจนแผนเดิมใช้ไม่ได้
  readonly planOutdated = computed(() => this._routeState() !== null && this.routeState() === null);

  // แผนที่เลือกใช้อยู่ตอนนี้
  readonly plan = computed<RoutePlan | null>(() => {
    const state = this.routeState();
    return state ? (state.plans[state.selected] ?? null) : null;
  });

  // บันทึกชุดแผนที่ระบบเสนอ (แผนแรก = กำไรสูงสุด ถูกเลือกไว้ให้ก่อน) แล้วส่งใบงานให้ไรเดอร์ทันที
  saveProposals(plans: RoutePlan[], round: number): Promise<boolean> {
    const seen = new Set(this.routeState()?.seenKeys ?? []);
    plans.forEach(p => seen.add(p.key));
    this._routeState.set({
      signature: this.ordersSignature(),
      round,
      plans,
      selected: 0,
      seenKeys: [...seen]
    });
    return this.publishJobs();
  }

  // เจ้าของร้านเลือกแผนอื่นจากที่ระบบเสนอ -> ใบงานของไรเดอร์เปลี่ยนตามแผนที่เลือก
  selectPlan(index: number): Promise<boolean> {
    const state = this._routeState();
    if (!state || index < 0 || index >= state.plans.length || index === state.selected) {
      return Promise.resolve(false);
    }
    this._routeState.set({ ...state, selected: index });
    return this.publishJobs();
  }

  // ---------- ใบงานไรเดอร์ (เก็บในฐานข้อมูล ไรเดอร์เปิดดูจากมือถือของตัวเองได้) ----------
  private readonly _publishedJobs = signal<JobSheet[]>([]);

  // สถานะการส่งใบงานขึ้น backend (หน้าจัดเส้นทางแสดงให้เจ้าของร้านเห็น)
  readonly publishState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly publishedCount = computed(() => this._publishedJobs().length);

  // ใบงานของไรเดอร์ รหัสใบงาน -> รายละเอียด (หน้าไรเดอร์ใช้ตัวนี้)
  readonly jobs = computed<Record<string, JobSheet>>(() =>
    Object.fromEntries(this._publishedJobs().map(job => [job.jobCode, job]))
  );

  // ดึงใบงาน
  getJobs() {
    return this.jobs();
  }

  // แปลงแผนที่เลือกเป็นใบงาน (เก็บเฉพาะที่ไรเดอร์ต้องใช้)
  private toJobSheets(plan: RoutePlan): JobSheet[] {
    return plan.routes.map(r => ({
      jobCode: r.jobCode,
      riderName: r.riderName,
      color: r.color,
      boxes: r.totalBoxes,
      stopsCount: r.stops.length,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      stops: r.stops.map(s => ({ name: s.name, boxes: s.boxes, phone: s.phone, time: s.time, lat: s.lat, lng: s.lng }))
    }));
  }

  // ส่งใบงานของแผนที่เลือกขึ้น backend (แทนที่ใบงานชุดเดิมทั้งหมด) หน้าจัดเส้นทางกดส่งซ้ำได้ถ้าไม่สำเร็จ
  // ส่งทีละคำขอตามลำดับ: ถ้าเจ้าของร้านกดเลือกแผนรัว ๆ แผนที่เลือกล่าสุดจะเป็นตัวที่ถูกบันทึกเสมอ
  private publishQueue: Promise<unknown> = Promise.resolve();

  publishJobs(): Promise<boolean> {
    const run = this.publishQueue.then(() => this.sendJobs());
    this.publishQueue = run.catch(() => undefined);
    return run;
  }

  private async sendJobs(): Promise<boolean> {
    const plan = this.plan();
    if (!plan) {
      return false;
    }
    const sheets = this.toJobSheets(plan);
    this.publishState.set('saving');
    const ok = await this.call(() => firstValueFrom(this.http.put(`${API_URL}/jobs`, { jobs: sheets })));
    // ถ้าระหว่างรอ เจ้าของร้านเลือกแผนอื่นไปแล้ว คำขอถัดไปในคิวจะเป็นตัวกำหนดสถานะ
    if (this.plan() === plan) {
      this.publishState.set(ok ? 'saved' : 'error');
      if (ok) {
        this._publishedJobs.set(sheets);
      }
    }
    return ok;
  }

  // โหลดใบงานล่าสุดจากฐานข้อมูล (หน้าไรเดอร์เรียกตอนเปิดหน้า / กดรีเฟรช)
  loadJobs(): Promise<boolean> {
    return this.call(async () => {
      this._publishedJobs.set(await firstValueFrom(this.http.get<JobSheet[]>(`${API_URL}/jobs`)));
    });
  }

  private async clearPublishedJobs(): Promise<void> {
    await firstValueFrom(this.http.delete(`${API_URL}/jobs`));
    this._publishedJobs.set([]);
    this.publishState.set('idle');
  }
}
