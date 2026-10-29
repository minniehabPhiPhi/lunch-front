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
  untracked,
  viewChild
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DeliveryService } from '../../services/delivery';
import { RoutePlannerService } from '../../services/route-planner';
import { RoadNetworkService } from '../../services/road-network';
import { OrderInfo } from '../../models/order.model';
import {
  DEADLINE_MINUTES,
  MAX_ORDERS_PER_RIDER,
  RoutePlan
} from '../../models/route.model';
import { DELIVERY_RADIUS_KM, SHOP_LOCATION } from '../../utils/geo';
import { SHOP_ICON } from '../../utils/map-icons';

declare let L: any; // Leaflet (โหลดจาก index.html)

// เว้นระยะระหว่างคำขอเส้นทางไปเซิร์ฟเวอร์แผนที่ฟรี (ไม่ยิงถี่เกินไป)
const PATH_REQUEST_GAP_MS = 1000;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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
  private readonly roads = inject(RoadNetworkService);
  private readonly injector = inject(Injector);

  readonly maxOrders = MAX_ORDERS_PER_RIDER;
  readonly deadlineMin = DEADLINE_MINUTES;
  readonly abs = Math.abs;

  // ข้อมูลมาจาก Service (ออเดอร์จากหน้า 2, แผนที่เลือกไปใช้ต่อที่หน้าไรเดอร์)
  readonly orders = this.deliveryService.orders;
  readonly plan = this.deliveryService.plan;
  readonly planOutdated = this.deliveryService.planOutdated;
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

  // ---------- เส้นทางตามถนนจริง ----------
  // กำลังขอระยะทางจากบริการแผนที่ + คำนวณ (ปุ่มกดไม่ได้ระหว่างนี้)
  readonly computing = signal(false);
  // เส้นทางตามถนนของแต่ละใบงาน: "<แผน>|<รหัสใบงาน>" -> พิกัดตามถนน
  private readonly roadPaths = signal<Record<string, [number, number][]>>({});
  // ความคืบหน้าการโหลดเส้นทางตามถนนมาวาดบนแผนที่
  readonly pathProgress = signal({ done: 0, total: 0 });
  private pathRun = 0; // เลขรอบการโหลด (เปลี่ยนแผนแล้ว รอบเก่าจะหยุดเอง)

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

    // ออเดอร์ / แผนที่เลือก / ใบงานที่เน้น / เส้นทางตามถนน เปลี่ยน -> วาดแผนที่ใหม่
    effect(() => {
      const plan = this.plan();
      const orders = this.orders();
      const highlight = this.highlight();
      const paths = this.roadPaths();
      if (this.mapReady()) {
        this.draw(plan, orders, highlight, paths);
      }
    });

    // ได้แผนที่คำนวณด้วยระยะทางตามถนน -> โหลดเส้นทางตามถนนมาวาดแทนเส้นตรง
    effect(() => {
      const plan = this.plan();
      untracked(() => {
        if (plan?.distanceMode === 'road') {
          void this.loadRoadPaths(plan);
        } else {
          this.pathRun++; // หยุดการโหลดรอบก่อน (ถ้ามี)
          this.pathProgress.set({ done: 0, total: 0 });
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.pathRun++;
      this.map?.remove();
    });
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
    // ให้เครดิตบริการเส้นทาง (ตามเงื่อนไขการใช้งานของ OSRM)
    this.map.attributionControl.addAttribution('เส้นทาง © <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>');
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

  private draw(
    plan: RoutePlan | null,
    orders: OrderInfo[],
    highlight: string | null,
    paths: Record<string, [number, number][]>
  ) {
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
        // มีเส้นทางตามถนนแล้ววาดตามถนน ยังไม่มีวาดเส้นตรง (เส้นประ = กำลังโหลดเส้นทางตามถนน)
        const roadPath = paths[`${plan.key}|${route.jobCode}`];
        const line = roadPath ?? [[SHOP_LOCATION.lat, SHOP_LOCATION.lng], ...route.stops.map(s => [s.lat, s.lng])];
        const waiting = !roadPath && plan.distanceMode === 'road';

        L.polyline(line, {
          color: route.color,
          weight: highlight === route.jobCode ? 7 : 4,
          opacity: dim ? 0.2 : waiting ? 0.5 : 0.85,
          dashArray: waiting ? '6 8' : undefined
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

  // โหลดเส้นทางตามถนนของทุกใบงานในแผน ทีละใบ (เว้นระยะระหว่างคำขอ) แล้ววาดแทนเส้นตรง
  private async loadRoadPaths(plan: RoutePlan) {
    const run = ++this.pathRun;
    const total = plan.routes.length;
    let done = 0;
    let requested = false;
    this.pathProgress.set({ done, total });

    for (const route of plan.routes) {
      const key = `${plan.key}|${route.jobCode}`;
      const points = [SHOP_LOCATION, ...route.stops];
      if (!this.roadPaths()[key]) {
        const cached = this.roads.hasPath(points);
        if (requested && !cached) {
          await sleep(PATH_REQUEST_GAP_MS);
        }
        if (run !== this.pathRun) {
          return; // เปลี่ยนแผน / ออกจากหน้าไปแล้ว
        }
        const path = await this.roads.roadPath(points);
        if (run !== this.pathRun) {
          return;
        }
        requested ||= !cached;
        if (path) {
          this.roadPaths.update(all => ({ ...all, [key]: path }));
        }
      }
      done++;
      this.pathProgress.set({ done, total });
    }
  }

  // ---------- ฟังก์ชันกดปุ่ม ----------
  // ครั้งแรก = คำนวณ, ครั้งต่อไป = คำนวณใหม่ (เสนอเส้นทางอื่นให้ดู)
  async calculateRoutes() {
    const orders = this.orders();

    if (orders.length === 0) {
      this.errorMsg.set('กรุณาไปที่หน้า "2. ออเดอร์" แล้วกดสุ่มออเดอร์ก่อนครับ!');
      this.notice.set('');
      return;
    }

    this.computing.set(true);
    // ขอระยะทางขับรถตามถนนจริงระหว่างร้านกับทุกบ้าน (ได้ null = บริการแผนที่ใช้ไม่ได้ -> ใช้เส้นตรง)
    const roadLeg = await this.roads.roadDistances([SHOP_LOCATION, ...orders]);

    const state = this.deliveryService.routeState();
    const round = (state?.round ?? 0) + 1;
    const seen = new Set(state?.seenKeys ?? []);

    // แผนที่เห็นอยู่ตอนนี้: แผนใหม่ต้องต่างจากแผนนี้ และเส้นทางที่ไม่เปลี่ยนจะใช้เลขใบงาน/สีเดิม
    const previous = this.plan();
    const plans = this.planner.propose(orders, round, [...seen], roadLeg, previous);
    void this.deliveryService.saveProposals(plans, round); // บันทึกแผน + ส่งใบงานให้ไรเดอร์
    this.computing.set(false);

    this.highlight.set(null);
    this.errorMsg.set('');
    const notes = [];
    if (!roadLeg) {
      notes.push('เชื่อมต่อบริการแผนที่ (OSRM) ไม่ได้ ระบบจึงคำนวณด้วยระยะทางเส้นตรงแทน ลองกดคำนวณใหม่อีกครั้งภายหลัง');
    }
    if (round > 1 && plans.every(p => seen.has(p.key))) {
      notes.push('ลองคำนวณใหม่แล้ว แต่ไม่พบเส้นทางอื่นที่ต่างจากเดิม (ออเดอร์อาจน้อยเกินไป หรือแบบเดิมดีที่สุดแล้ว)');
    }
    this.notice.set(notes.join(' · '));
  }

  // ส่งใบงานไม่สำเร็จ -> กดส่งซ้ำ
  retryPublish() {
    void this.deliveryService.publishJobs();
  }

  toggleHighlight(jobCode: string) {
    this.highlight.update(current => (current === jobCode ? null : jobCode));
  }
}
