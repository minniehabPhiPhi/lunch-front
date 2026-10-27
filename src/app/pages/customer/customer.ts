import { Component, ElementRef, ViewChild, AfterViewInit, computed, inject, signal } from '@angular/core';
import { Api, CustomerRow, firstName, fullName, splitName, toBody, val } from '../../core/api';
import { Store } from '../../core/store';
import { around, baseLayer, esc, makeMap, ok } from '../../core/map';
declare const L: any;

@Component({
  selector: 'app-customer',
  standalone: true,
  templateUrl: './customer.html',
  styleUrl: './customer.css',
})
export class Customer implements AfterViewInit {
  private api = inject(Api); private store = inject(Store);
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLElement>;
  v = val; nm = fullName;
  rows = signal<CustomerRow[]>([]); ordered = signal(new Set<number>());
  loading = signal(true); busy = signal(false); error = signal('');
  name = signal(''); phone = signal(''); lat = signal(''); lng = signal('');
  valid = computed(() => this.name().trim() !== '' && this.lat().trim() !== '' && this.lng().trim() !== '' && ok(+this.lat(), +this.lng()));
  private map: any; private layer: any; private base: any; private pick: any; private markers = new Map<number, any>();

  ngAfterViewInit() {
    this.map = makeMap(this.mapEl.nativeElement, this.store.shop());
    this.map.fitBounds(around(this.store.shop()));
    this.layer = L.layerGroup().addTo(this.map);
    this.drawBase();
    this.map.on('click', (e: any) => { this.lat.set(e.latlng.lat.toFixed(6)); this.lng.set(e.latlng.lng.toFixed(6)); this.drawPick(); });
    this.load();
    this.api.orders().subscribe({ next: r => { this.ordered.set(new Set(r.map(o => o.customer_id))); this.draw(); }, error: () => { /* แผนที่ยังใช้ได้ แค่ไม่แยกสีตามออเดอร์ */ } });
  }

  load() {
    this.api.customers().subscribe({
      next: r => { this.rows.set(r); this.loading.set(false); this.draw(); },
      error: () => { this.loading.set(false); this.error.set('โหลดรายชื่อลูกค้าไม่ได้ ตรวจว่า API บน Render ยังทำงานอยู่ แล้วรีเฟรชหน้านี้'); },
    });
  }

  private drawBase() {
    this.base?.remove();
    this.base = baseLayer(this.store.shop(), p => { this.store.setShop(p); this.drawBase(); }).addTo(this.map);
  }

  private draw() {
    this.layer.clearLayers(); this.markers.clear();
    for (const c of this.rows()) {
      const la = +c.latitude, ln = +c.longitude;
      if (!ok(la, ln)) continue;
      const on = this.ordered().has(c.customer_id);
      const m = L.marker([la, ln], { icon: L.divIcon({ className: 'cm' + (on ? ' on' : ''), html: `<i></i><b>${esc(firstName(c.first_name))}</b>`, iconSize: [0, 0] }) })
        .bindPopup(`<b>${esc(fullName(c))}</b><br>${esc(c.phone_number)}`).addTo(this.layer);
      this.markers.set(c.customer_id, m);
    }
  }

  drawPick() {
    this.pick?.remove(); this.pick = null;
    if (this.lat().trim() === '' || this.lng().trim() === '' || !ok(+this.lat(), +this.lng())) return;
    this.pick = L.circleMarker([+this.lat(), +this.lng()], { radius: 10, color: '#dc2626', weight: 3, fill: false }).addTo(this.map);
  }

  coord(c: CustomerRow) { return `${(+c.latitude).toFixed(4)}, ${(+c.longitude).toFixed(4)}`; }
  show(c: CustomerRow) { if (ok(+c.latitude, +c.longitude)) { this.map.setView([+c.latitude, +c.longitude], 16); this.markers.get(c.customer_id)?.openPopup(); } }

  add() {
    this.busy.set(true); this.error.set('');
    this.api.addCustomer({ ...splitName(this.name()), phone_number: this.phone().trim(), latitude: +this.lat(), longitude: +this.lng(), address_detail: '' }).subscribe({
      next: () => { this.busy.set(false); this.name.set(''); this.phone.set(''); this.lat.set(''); this.lng.set(''); this.drawPick(); this.load(); },
      error: () => { this.busy.set(false); this.error.set('เพิ่มลูกค้าไม่ได้ ตรวจข้อมูลแล้วลองอีกครั้ง'); },
    });
  }

  rename(c: CustomerRow, e: Event) {
    const n = splitName(val(e));
    if (!n.first_name) { this.load(); return; }
    this.save(c, n);
  }
  rephone(c: CustomerRow, e: Event) { this.save(c, { phone_number: val(e).trim() }); }
  private save(c: CustomerRow, patch: Partial<ReturnType<typeof toBody>>) {
    this.error.set('');
    this.api.editCustomer(c.customer_id, toBody(c, patch)).subscribe({ next: () => this.load(), error: () => this.error.set('บันทึกข้อมูลลูกค้าไม่ได้ ลองอีกครั้ง') });
  }

  remove(c: CustomerRow) {
    if (!confirm(`ลบลูกค้า ${fullName(c)} ?`)) return;
    this.error.set('');
    this.api.delCustomer(c.customer_id).subscribe({ next: () => this.load(), error: () => this.error.set('ลบลูกค้าไม่ได้ ลูกค้าคนนี้อาจยังมีออเดอร์อยู่ ให้ลบออเดอร์ก่อน') });
  }
}
