import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DeliveryService } from '../../services/delivery';
import { RoutePlannerService } from '../../services/route-planner';
import { OrderInfo } from '../../models/order.model';
import {
  DEADLINE_MINUTES,
  MAX_ORDERS_PER_RIDER,
  RoutePlan,
  STRATEGY_HINTS,
  STRATEGY_LABELS
} from '../../models/route.model';
import { DELIVERY_RADIUS_KM, SHOP_LOCATION } from '../../utils/geo';
import { SHOP_ICON } from '../../utils/map-icons';

declare let L: any; // Leaflet (โหลดจาก index.html)

// กัน HTML แทรกในชื่อลูกค้าตอนแสดง popup บนแผนที่
function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, ch => map[ch] ?? ch);
}

@Component({
  selector: 'app-route',
  imports: [DecimalPipe],
  templateUrl: './route.html',
  styleUrl: './route.css'
})
export class Route {
  private readonly deliveryService = inject(DeliveryService);
  private readonly planner = inject(RoutePlannerService);
  private readonly injector = inject(Injector);

  readonly maxOrders = MAX_ORDERS_PER_RIDER;
  readonly deadlineMin = DEADLINE_MINUTES;
  readonly abs = Math.abs;

  // ข้อมูลมาจาก Service (ออเดอร์จากหน้า 2, แผนที่เลือกไปใช้ต่อที่หน้าไรเดอร์)
  readonly orders = this.deliveryService.orders;
  readonly plan = this.deliveryService.plan;
  readonly planOutdated = this.deliveryService.planOutdated;
  readonly proposals = computed(() => this.deliveryService.routeState()?.plans ?? []);
  readonly selectedIndex = computed(() => this.deliveryService.routeState()?.selected ?? 0);
  readonly round = computed(() => this.deliveryService.routeState()?.round ?? 0);
  readonly totalBoxes = computed(() => this.orders().reduce((sum, o) => sum + o.quantity, 0));

  readonly errorMsg = signal('');
  readonly apiError = this.deliveryService.error; // error จากการคุยกับ backend
  readonly notice = signal('');
  // สถานะการส่งใบงานให้ไรเดอร์ (บันทึกลงฐานข้อมูล ไรเดอร์เปิดจากมือถือได้)
  readonly publishState = this.deliveryService.publishState;
  readonly publishedCount = this.deliveryService.publishedCount;
  // ใบงานที่กำลังเน้นบนแผนที่ (null = แสดงทุกเส้นเท่ากัน)
  readonly highlight = signal<string | null>(null);

  // ---------- แผนที่ ----------
  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('mapEl');
  private readonly mapReady = signal(false);
  private map: any;
  private layer: any;
  private radiusBounds: any;
  private fitKey = '';

  constructor() {
    // เปิดหน้าแล้วดึงออเดอร์ล่าสุดจากฐานข้อมูล (ถ้าออเดอร์เปลี่ยน แผนเดิมจะถูกทิ้งเอง)
    void this.deliveryService.refresh();

    // สร้างแผนที่หลังจาก template ถูกวาดลงหน้าเว็บแล้ว
    afterNextRender(() => this.initMap());

    // ออเดอร์ / แผนที่เลือก / ใบงานที่เน้น เปลี่ยน -> วาดแผนที่ใหม่
    effect(() => {
      const plan = this.plan();
      const orders = this.orders();
      const highlight = this.highlight();
      if (this.mapReady()) {
        this.draw(plan, orders, highlight);
      }
    });

    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private initMap() {
    if (typeof L === 'undefined') {
      return; // Leaflet ไม่ถูกโหลด (เช่นตอนรันเทสต์)
    }

    const shop = [SHOP_LOCATION.lat, SHOP_LOCATION.lng];
    this.map = L.map(this.mapEl().nativeElement, { zoomSnap: 0.25 }); // ซูมเป็นเศษส่วนได้ แผนที่จะพอดีกับเส้นทางมากขึ้น
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // วงรัศมีจัดส่ง 3 กม. (ขอบเขตของวงคำนวณจากพิกัดร้านโดยตรง เพราะแผนที่ยังไม่มีมุมมองตอนนี้)
    this.radiusBounds = L.latLng(shop).toBounds(DELIVERY_RADIUS_KM * 2000);
    L.circle(shop, {
      radius: DELIVERY_RADIUS_KM * 1000,
      color: '#2e7d5b',
      weight: 1,
      dashArray: '6',
      fillOpacity: 0.05,
      interactive: false
    }).addTo(this.map);
    this.map.fitBounds(this.radiusBounds);

    L.marker(shop, { icon: L.divIcon({ html: SHOP_ICON.html, className: '', iconSize: SHOP_ICON.size, iconAnchor: SHOP_ICON.anchor }), zIndexOffset: 1000 })
      .addTo(this.map)
      .bindPopup('<b>ร้านข้าวกล่องส่งด่วน</b><br>จุดออกเดินทาง 11:30 น.');

    this.layer = L.layerGroup().addTo(this.map);
    this.mapReady.set(true);
  }

  // หมุดตัวเลขลำดับจุดส่ง สีเดียวกับเส้นทางของไรเดอร์
  private numberIcon(no: number, color: string, dim: boolean) {
    return L.divIcon({
      html:
        `<div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;` +
        `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;` +
        `justify-content:center;font:bold 12px sans-serif;opacity:${dim ? 0.35 : 1}">${no}</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  private draw(plan: RoutePlan | null, orders: OrderInfo[], highlight: string | null) {
    this.layer.clearLayers();
    const points: number[][] = [[SHOP_LOCATION.lat, SHOP_LOCATION.lng]];

    if (!plan) {
      // ยังไม่คำนวณ: แสดงจุดออเดอร์ที่รอจัดเส้นทาง
      for (const o of orders) {
        points.push([o.lat, o.lng]);
        L.circleMarker([o.lat, o.lng], { color: '#6b8f7e', fillColor: '#6b8f7e', fillOpacity: 0.7, radius: 6 })
          .bindPopup(`<b>${escapeHtml(o.customerName)}</b><br>${o.quantity} กล่อง · รอจัดเส้นทาง`)
          .addTo(this.layer);
      }
    } else {
      for (const route of plan.routes) {
        const dim = highlight !== null && highlight !== route.jobCode;
        const line = [[SHOP_LOCATION.lat, SHOP_LOCATION.lng], ...route.stops.map(s => [s.lat, s.lng])];

        L.polyline(line, {
          color: route.color,
          weight: highlight === route.jobCode ? 7 : 4,
          opacity: dim ? 0.2 : 0.85
        })
          .on('click', () => this.toggleHighlight(route.jobCode))
          .addTo(this.layer);

        route.stops.forEach((stop, idx) => {
          points.push([stop.lat, stop.lng]);
          L.marker([stop.lat, stop.lng], { icon: this.numberIcon(idx + 1, route.color, dim) })
            .bindPopup(
              `<b>${route.jobCode} - จุดที่ ${idx + 1}</b><br>${escapeHtml(stop.name)}<br>` +
                `ส่ง ${stop.boxes} กล่อง · ถึง ${stop.time}`
            )
            .addTo(this.layer);
        });
      }
    }

    // เปลี่ยนแผน/ออเดอร์ -> ปรับมุมมองแผนที่ (เน้นใบงานเฉย ๆ ไม่ต้องขยับ)
    const key = plan ? `plan:${plan.key}` : `orders:${orders.length}`;
    if (key !== this.fitKey) {
      this.fitKey = key;
      // รอให้กล่องแผนที่ขยายใหญ่เสร็จก่อนค่อยคำนวณขอบเขต
      afterNextRender(
        () => {
          this.map.invalidateSize();
          this.map.fitBounds(plan ? L.latLngBounds(points).pad(0.1) : this.radiusBounds, { animate: false });
        },
        { injector: this.injector }
      );
    }
  }

  // ---------- ฟังก์ชันกดปุ่ม ----------
  // ครั้งแรก = คำนวณ, ครั้งต่อไป = คำนวณใหม่ (เสนอเส้นทางอื่นให้ดู)
  calculateRoutes() {
    const orders = this.orders();

    if (orders.length === 0) {
      this.errorMsg.set('กรุณาไปที่หน้า "2. ออเดอร์" แล้วกดสุ่มออเดอร์ก่อนครับ!');
      this.notice.set('');
      return;
    }

    const state = this.deliveryService.routeState();
    const round = (state?.round ?? 0) + 1;
    const seen = new Set(state?.seenKeys ?? []);

    const plans = this.planner.propose(orders, round, [...seen]);
    void this.deliveryService.saveProposals(plans, round); // บันทึกแผน + ส่งใบงานให้ไรเดอร์

    this.highlight.set(null);
    this.errorMsg.set('');
    this.notice.set(
      round > 1 && plans.every(p => seen.has(p.key))
        ? 'ลองคำนวณใหม่แล้ว แต่ไม่พบเส้นทางอื่นที่ต่างจากเดิม (ออเดอร์อาจน้อยเกินไป หรือแบบเดิมดีที่สุดแล้ว)'
        : ''
    );
  }

  selectPlan(index: number) {
    void this.deliveryService.selectPlan(index);
    this.highlight.set(null);
  }

  // ส่งใบงานไม่สำเร็จ -> กดส่งซ้ำ
  retryPublish() {
    void this.deliveryService.publishJobs();
  }

  toggleHighlight(jobCode: string) {
    this.highlight.update(current => (current === jobCode ? null : jobCode));
  }

  strategyLabel(plan: RoutePlan): string {
    return plan.strategies.map(s => STRATEGY_LABELS[s]).join(' · ');
  }

  strategyHint(plan: RoutePlan): string {
    return plan.strategies.map(s => STRATEGY_HINTS[s]).join(' / ');
  }
}
