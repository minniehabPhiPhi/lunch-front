import { Component, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { Api, CustomerRow, OrderRow, fullName } from '../../core/api';
import { FOOD_COST, MAX_ORDERS, PRICE, baht } from '../../core/planner';

@Component({
  selector: 'app-order',
  standalone: true,
  templateUrl: './order.html',
  styleUrl: './order.css',
})
export class Order {
  private api = inject(Api);
  nm = fullName; baht = baht; max = MAX_ORDERS; price = PRICE; cost = FOOD_COST; opts = [1, 2, 3];
  rows = signal<OrderRow[]>([]); customers = signal<CustomerRow[]>([]);
  cid = signal(0); qty = signal(1); loading = signal(true); busy = signal(false); error = signal('');
  boxes = computed(() => this.rows().reduce((a, o) => a + o.qty, 0));
  riders = computed(() => Math.ceil(this.rows().length / MAX_ORDERS));

  constructor() {
    this.load();
    this.api.customers().subscribe({
      next: c => { this.customers.set(c); if (!this.cid() && c.length) this.cid.set(c[0].customer_id); },
      error: () => this.error.set('โหลดรายชื่อลูกค้าไม่ได้ จึงเพิ่มออเดอร์ใหม่ไม่ได้'),
    });
  }

  load() {
    this.api.orders().subscribe({
      next: r => { this.rows.set(r); this.loading.set(false); },
      error: () => { this.loading.set(false); this.error.set('โหลดออเดอร์ไม่ได้ ตรวจว่า API บน Render ยังทำงานอยู่ แล้วรีเฟรชหน้านี้'); },
    });
  }

  private run(obs: Observable<unknown>, msg: string) {
    this.busy.set(true); this.error.set('');
    obs.subscribe({ next: () => { this.busy.set(false); this.load(); }, error: () => { this.busy.set(false); this.error.set(msg); this.load(); } });
  }

  add() { this.run(this.api.addOrder(this.cid(), this.qty()), 'เพิ่มออเดอร์ไม่ได้ ลองอีกครั้ง'); }
  setQty(o: OrderRow, q: number) { this.run(this.api.editOrder(o.id, q), 'แก้ไขจำนวนกล่องไม่ได้ ลองอีกครั้ง'); }
  remove(o: OrderRow) { this.run(this.api.delOrder(o.id), 'ลบออเดอร์ไม่ได้ ลองอีกครั้ง'); }
  seed() { this.run(this.api.reseedOrders(), 'สุ่มออเดอร์จำลองไม่ได้ ลองอีกครั้ง'); }
  clear() { if (confirm('ลบออเดอร์ทั้งหมด ?')) this.run(this.api.clearOrders(), 'ล้างออเดอร์ไม่ได้ ลองอีกครั้ง'); }
}
