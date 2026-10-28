import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryService } from '../../services/delivery';
import { CustomerForm, CustomerInfo } from '../../models/customer.model';
import { DELIVERY_RADIUS_KM, SHOP_LOCATION, distanceKm } from '../../utils/geo';
import { PIN_ICON, SHOP_ICON } from '../../utils/map-icons';

declare let L: any; // Leaflet (โหลดจาก index.html)

// กัน HTML แทรกในชื่อลูกค้าตอนแสดง popup บนแผนที่
function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, ch => map[ch] ?? ch);
}

@Component({
  selector: 'app-customer',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './customer.html',
  styleUrl: './customer.css'
})
export class Customer {
  private readonly deliveryService = inject(DeliveryService);

  readonly radiusKm = DELIVERY_RADIUS_KM;

  // ฟอร์มรับข้อมูล
  readonly name = signal('');
  readonly phone = signal('');
  readonly address = signal('');
  readonly lat = signal(String(SHOP_LOCATION.lat));
  readonly lng = signal(String(SHOP_LOCATION.lng));

  // null = โหมดเพิ่มลูกค้าใหม่, มีค่า = กำลังแก้ไขลูกค้าคนนั้น
  readonly editingId = signal<number | null>(null);
  readonly errorMsg = signal('');

  // สถานะการคุยกับ backend (แสดงในหน้าจอ)
  readonly apiError = this.deliveryService.error;
  readonly loading = this.deliveryService.loading;

  // รายการลูกค้า (มาจาก Service) พร้อมระยะห่างจากร้าน
  readonly customers = computed(() =>
    this.deliveryService.customers().map(c => ({
      ...c,
      distance: distanceKm(SHOP_LOCATION, c)
    }))
  );

  // ---------- แผนที่ ----------
  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('mapEl');
  private readonly mapReady = signal(false);
  private map: any;
  private pin: any;
  private customerLayer: any;
  private markers = new Map<number, any>();

  constructor() {
    // เปิดหน้าแล้วดึงรายชื่อลูกค้าล่าสุดจากฐานข้อมูล
    void this.deliveryService.refresh();

    // สร้างแผนที่หลังจาก template ถูกวาดลงหน้าเว็บแล้ว
    afterNextRender(() => this.initMap());

    // ลูกค้าเปลี่ยน (เพิ่ม/แก้/ลบ) -> วาดหมุดบนแผนที่ใหม่
    effect(() => {
      const list = this.customers();
      if (this.mapReady()) {
        this.drawCustomers(list);
      }
    });

    // พิมพ์ละติจูด/ลองจิจูดในฟอร์ม -> ย้ายหมุดเลือกตำแหน่งตาม
    effect(() => {
      const lat = this.parseCoord(this.lat());
      const lng = this.parseCoord(this.lng());
      if (this.mapReady() && Number.isFinite(lat) && Number.isFinite(lng)) {
        this.pin.setLatLng([lat, lng]);
      }
    });

    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private initMap() {
    if (typeof L === 'undefined') {
      return; // Leaflet ไม่ถูกโหลด (เช่นตอนรันเทสต์)
    }

    const shop = [SHOP_LOCATION.lat, SHOP_LOCATION.lng];
    this.map = L.map(this.mapEl().nativeElement);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // วงรัศมีจัดส่ง 3 กม. (ขอบเขตของวงคำนวณจากพิกัดร้านโดยตรง เพราะแผนที่ยังไม่มีมุมมองตอนนี้)
    L.circle(shop, {
      radius: DELIVERY_RADIUS_KM * 1000,
      color: '#e65100',
      weight: 1,
      dashArray: '6',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(this.map);
    this.map.fitBounds(L.latLng(shop).toBounds(DELIVERY_RADIUS_KM * 2000));

    L.marker(shop, { icon: this.icon(SHOP_ICON) })
      .addTo(this.map)
      .bindPopup('<b>ร้านข้าวกล่องส่งด่วน</b>');

    this.customerLayer = L.layerGroup().addTo(this.map);

    // หมุดเลือกตำแหน่งบ้านลูกค้า (ลากได้)
    this.pin = L.marker(shop, { draggable: true, icon: this.icon(PIN_ICON) }).addTo(this.map);
    this.pin.on('dragend', () => {
      const p = this.pin.getLatLng();
      this.setPosition(p.lat, p.lng);
    });
    this.map.on('click', (e: any) => this.setPosition(e.latlng.lat, e.latlng.lng));

    this.mapReady.set(true);
  }

  private icon(marker: typeof SHOP_ICON) {
    return L.divIcon({ html: marker.html, className: '', iconSize: marker.size, iconAnchor: marker.anchor });
  }

  private drawCustomers(list: CustomerInfo[]) {
    this.customerLayer.clearLayers();
    this.markers.clear();

    for (const c of list) {
      const marker = L.circleMarker([c.lat, c.lng], {
        color: '#e65100',
        fillColor: '#e65100',
        fillOpacity: 0.8,
        radius: 8,
        bubblingMouseEvents: false // คลิกหมุดลูกค้าแล้วไม่ให้หมุดเลือกตำแหน่งย้ายตาม
      })
        .bindPopup(`<b>${escapeHtml(c.name)}</b><br>โทร ${escapeHtml(c.phone)}`)
        .addTo(this.customerLayer);
      this.markers.set(c.id, marker);
    }
  }

  // คลิกแผนที่ / ลากหมุด -> กรอกพิกัดลงฟอร์มให้อัตโนมัติ
  private setPosition(lat: number, lng: number) {
    this.lat.set(lat.toFixed(6));
    this.lng.set(lng.toFixed(6));
    this.errorMsg.set('');
  }

  // ---------- ฟังก์ชันกดปุ่ม ----------
  async saveCustomer() {
    const data = this.validate();
    if (!data) {
      return;
    }

    const id = this.editingId();
    const ok =
      id === null
        ? await this.deliveryService.addCustomer(data)
        : await this.deliveryService.updateCustomer(id, data);
    if (!ok) {
      return; // บันทึกไม่สำเร็จ: เก็บข้อมูลในฟอร์มไว้ ข้อความ error แสดงอยู่ด้านบน
    }

    if (id !== null) {
      this.lat.set(String(SHOP_LOCATION.lat));
      this.lng.set(String(SHOP_LOCATION.lng));
    }

    // ล้างค่าฟอร์ม
    this.name.set('');
    this.phone.set('');
    this.address.set('');
    this.editingId.set(null);
    this.errorMsg.set('');
  }

  startEdit(c: CustomerInfo) {
    this.editingId.set(c.id);
    this.name.set(c.name);
    this.phone.set(c.phone);
    this.address.set(c.address);
    this.lat.set(String(c.lat));
    this.lng.set(String(c.lng));
    this.errorMsg.set('');
    this.focusOn(c);
  }

  cancelEdit() {
    this.editingId.set(null);
    this.name.set('');
    this.phone.set('');
    this.address.set('');
    this.lat.set(String(SHOP_LOCATION.lat));
    this.lng.set(String(SHOP_LOCATION.lng));
    this.errorMsg.set('');
  }

  async removeCustomer(c: CustomerInfo) {
    if (!confirm(`ลบลูกค้า "${c.name}" ใช่หรือไม่? (ออเดอร์ของลูกค้าคนนี้จะถูกลบด้วย)`)) {
      return;
    }
    const ok = await this.deliveryService.removeCustomer(c.id);
    if (ok && this.editingId() === c.id) {
      this.cancelEdit();
    }
  }

  // กดพิกัดในรายการ -> แผนที่ซูมไปที่บ้านลูกค้าและเปิด popup
  focusOn(c: CustomerInfo) {
    if (!this.map) {
      return;
    }
    this.map.flyTo([c.lat, c.lng], Math.max(this.map.getZoom(), 15));
    this.markers.get(c.id)?.openPopup();
  }

  // ---------- ตรวจสอบข้อมูลฟอร์ม ----------
  private validate(): CustomerForm | null {
    const name = this.name().trim();
    const phone = this.phone().replace(/[\s-]/g, '');
    const address = this.address().trim();
    const lat = this.parseCoord(this.lat());
    const lng = this.parseCoord(this.lng());

    if (!name || !phone || !address) {
      this.errorMsg.set('กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบถ้วนครับ');
      return null;
    }
    if (!/^0\d{8,9}$/.test(phone)) {
      this.errorMsg.set('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)');
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      this.errorMsg.set('พิกัดไม่ถูกต้อง กรุณาคลิกเลือกตำแหน่งบนแผนที่ หรือกรอกตัวเลขละติจูด/ลองจิจูด');
      return null;
    }
    const dist = distanceKm(SHOP_LOCATION, { lat, lng });
    if (dist > DELIVERY_RADIUS_KM) {
      this.errorMsg.set(`บ้านลูกค้าอยู่ห่างร้าน ${dist.toFixed(1)} กม. เกินรัศมีจัดส่ง ${DELIVERY_RADIUS_KM} กม.`);
      return null;
    }

    return { name, phone, lat, lng, address };
  }

  private parseCoord(value: string): number {
    return value.trim() === '' ? NaN : Number(value);
  }
}
