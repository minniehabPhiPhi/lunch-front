import { Injectable, signal } from '@angular/core';
import { P, Trip, clock, jobCode } from './planner';

export interface Job { code: string; color: string; boxes: number; km: number; stops: { name: string; phone: string; qty: number; lat: number; lng: number; eta: string }[]; }

const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** สถานะที่ใช้ร่วมกันระหว่างหน้า: ตำแหน่งร้าน และใบงานล่าสุดที่จัดไว้ (เก็บในเบราว์เซอร์) */
@Injectable({ providedIn: 'root' })
export class Store {
  shop = signal<P>(read('lunch.shop', { lat: 16.243, lng: 103.2583 })); // ลากหมุด "ร้าน" ในหน้าลูกค้าเพื่อแก้
  jobs = signal<Job[]>(read('lunch.jobs', []));
  setShop(p: P) { this.shop.set(p); write('lunch.shop', p); }
  setJobs(trips: Trip[]) {
    const jobs: Job[] = trips.map(t => ({
      code: jobCode(t.id), color: t.color, boxes: t.boxes, km: t.km,
      stops: t.stops.map((s, i) => ({ name: s.name, phone: s.phone, qty: s.qty, lat: s.lat, lng: s.lng, eta: clock(t.arrive[i]) })),
    }));
    this.jobs.set(jobs); write('lunch.jobs', jobs);
  }
}
