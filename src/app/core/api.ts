import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, switchMap } from 'rxjs';
export const API = 'https://lunch-delivery-api-0f1k.onrender.com/api';

export interface CustomerRow { customer_id: number; first_name: string; last_name: string; phone_number: string; latitude: string; longitude: string; address_detail: string; }
export interface CustomerBody { first_name: string; last_name: string; phone_number: string; latitude: number; longitude: number; address_detail: string; }
export interface OrderRow { id: number; customer_id: number; name: string; phone: string; lat: number; lng: number; qty: number; status: string; }

export const val = (e: Event) => (e.target as HTMLInputElement).value;
export const fullName = (c: { first_name: string; last_name: string }) => [c.first_name, c.last_name].filter(Boolean).join(' ');
export const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';
export const splitName = (n: string) => { const [f, ...r] = n.trim().split(/\s+/); return { first_name: f ?? '', last_name: r.join(' ') }; };
export const toBody = (c: CustomerRow, patch: Partial<CustomerBody> = {}): CustomerBody => ({
  first_name: c.first_name, last_name: c.last_name, phone_number: c.phone_number ?? '',
  latitude: +c.latitude, longitude: +c.longitude, address_detail: c.address_detail ?? '', ...patch,
});

const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null) return o[k]; return null; };

// ชื่อ field ของ /api/orders ยังไม่ยืนยัน -> รองรับหลายชื่อ แก้ตรงนี้ที่เดียวถ้าไม่ตรง
export function toOrder(o: any): OrderRow {
  const c = o.customer ?? o;
  return {
    id: Number(pick(o, 'order_id', 'id')),
    customer_id: Number(pick(o, 'customer_id') ?? pick(c, 'customer_id')),
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || String(pick(c, 'customer_name', 'name') ?? '-'),
    phone: String(pick(c, 'phone_number', 'phone') ?? ''),
    lat: Number(pick(c, 'latitude', 'lat')),
    lng: Number(pick(c, 'longitude', 'lng')),
    qty: Number(pick(o, 'quantity', 'qty', 'boxes', 'total_boxes', 'box_count', 'amount') ?? 1),
    status: String(pick(o, 'order_status', 'status') ?? 'pending'),
  };
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  customers(search = '') { return this.http.get<CustomerRow[]>(`${API}/customers`, { params: search ? { search } : {} }); }
  addCustomer(b: CustomerBody) { return this.http.post(`${API}/customers`, b); }
  editCustomer(id: number, b: CustomerBody) { return this.http.put(`${API}/customers/${id}`, b); }
  delCustomer(id: number) { return this.http.delete(`${API}/customers/${id}`); }
  orders() { return this.http.get<any>(`${API}/orders`).pipe(map(r => (Array.isArray(r) ? r : r.data ?? []).map(toOrder) as OrderRow[])); }
  addOrder(customer_id: number, quantity: number) { return this.http.post(`${API}/orders`, { quantity, customer_id }); }
  editOrder(id: number, quantity: number) { return this.http.put(`${API}/orders/${id}`, { quantity }); }
  delOrder(id: number) { return this.http.delete(`${API}/orders/${id}`); }
  clearOrders() { return this.http.delete(`${API}/orders`); }
  /** ล้างของเดิมก่อนแล้วสุ่มใหม่ เพื่อให้ผลเท่ากันไม่ว่า seed จะเพิ่มต่อหรือแทนที่ */
  reseedOrders() { return this.clearOrders().pipe(switchMap(() => this.http.post(`${API}/orders/seed`, {}))); }
}
