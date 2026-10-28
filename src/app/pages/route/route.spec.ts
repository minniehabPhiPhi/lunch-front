import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Route } from './route';
import { DeliveryService } from '../../services/delivery';
import { API_URL } from '../../config';
import { ApiData, customerRow, flushJobsPut, flushLists, orderRow, randomApiData, settle } from '../../testing/api-mock';
import { LatLng, SHOP_LOCATION, distanceKm } from '../../utils/geo';
import { RoadNetworkService } from '../../services/road-network';

describe('Route', () => {
  let component: Route;
  let fixture: ComponentFixture<Route>;
  let service: DeliveryService;
  let http: HttpTestingController;
  let el: HTMLElement;

  // บริการแผนที่จำลอง (เทสต์ไม่ออกอินเทอร์เน็ต): ถนนอ้อมกว่าเส้นตรง 30% / roadsDown = บริการใช้ไม่ได้
  let roadsDown = false;
  const fakeRoads = {
    roadDistances: async () => (roadsDown ? null : (a: LatLng, b: LatLng) => distanceKm(a, b) * 1.3),
    roadPath: async (points: LatLng[]) => points.map(p => [p.lat, p.lng] as [number, number]),
    hasPath: () => true
  };

  // หน้านี้ดึงข้อมูลจากฐานข้อมูลตอนเปิด -> ตอบด้วยข้อมูลจำลองแล้วรอให้หน้าจอวาดเสร็จ
  const loadData = async (data: ApiData) => {
    flushLists(http, data);
    await fixture.whenStable();
  };

  // กดคำนวณ -> หน้าเว็บส่งใบงานขึ้น backend (PUT /jobs) -> ตอบว่าสำเร็จ
  const calculate = async () => {
    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    await settle();
    flushJobsPut(http);
    await settle();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Route],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: RoadNetworkService, useValue: fakeRoads }],
    }).compileComponents();

    roadsDown = false;
    service = TestBed.inject(DeliveryService);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Route);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ยังไม่มีออเดอร์ -> กดคำนวณแล้วแจ้งให้ไปสุ่มออเดอร์ก่อน', async () => {
    await loadData({ customers: [], orders: [] });
    await calculate();

    expect(el.querySelector('.error')?.textContent).toContain('ออเดอร์');
    expect(service.plan()).toBeNull();
  });

  it('คำนวณแล้วแสดงใบงานครบทุกไรเดอร์ พร้อมสรุปกำไร (ไม่มีส่วนทางเลือกเส้นทาง)', async () => {
    await loadData(randomApiData());
    await calculate();

    const plan = service.plan()!;
    expect(plan).not.toBeNull();
    expect(el.querySelectorAll('.job').length).toBe(plan.routes.length);
    expect(el.querySelectorAll('.summary .sum-cell').length).toBe(6);
    expect(el.querySelector('.alts')).toBeNull();
    expect(el.textContent).not.toContain('ทางเลือกเส้นทางที่ระบบเสนอ');
    expect(el.querySelector('.map')?.classList).toContain('large');
  });

  it('กดคำนวณใหม่ -> เป็นชุดที่ 2 และปุ่มเปลี่ยนข้อความ', async () => {
    await loadData(randomApiData());
    await calculate();
    expect(component.round()).toBe(1);

    await calculate();
    expect(component.round()).toBe(2);
    expect(el.querySelector('.btn-primary')?.textContent).toContain('คำนวณใหม่');
  });

  it('เตือนเมื่อแผนขาดทุน (ลูกค้า 1 กล่อง ไกล 10 กม.)', async () => {
    await loadData({
      customers: [customerRow(1, SHOP_LOCATION.lat + 10 / 111.32, SHOP_LOCATION.lng, 'ลูกค้าไกล')],
      orders: [orderRow(1, 1, 1)]
    });
    await calculate();

    expect(service.plan()!.summary.profit).toBeLessThan(0);
    expect(el.textContent).toContain('ขาดทุน');
  });

  it('ออเดอร์เปลี่ยนหลังคำนวณ -> แจ้งให้คำนวณใหม่', async () => {
    const data = randomApiData();
    await loadData(data);
    await calculate();

    // มีคนลบออเดอร์แรกในฐานข้อมูล แล้วหน้าเว็บโหลดข้อมูลใหม่
    const done = service.refresh();
    flushLists(http, { ...data, orders: data.orders.slice(1) });
    await done;
    await fixture.whenStable();

    expect(el.querySelectorAll('.job').length).toBe(0);
    expect(el.querySelector('.warn')?.textContent).toContain('คำนวณจัดเส้นทางใหม่');
  });

  it('คำนวณแล้วบอกว่าส่งใบงานให้ไรเดอร์แล้ว', async () => {
    await loadData(randomApiData());
    await calculate();

    expect(el.querySelector('.publish')?.textContent).toContain(`ส่งใบงานให้ไรเดอร์แล้ว ${service.plan()!.routes.length} ใบ`);
  });

  it('ส่งใบงานไม่สำเร็จ -> แจ้งเตือน และกดส่งอีกครั้งได้', async () => {
    await loadData(randomApiData());
    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    await settle();
    http.expectOne(r => r.method === 'PUT' && r.url === `${API_URL}/jobs`)
      .flush({ error: 'Internal server error' }, { status: 500, statusText: 'Server Error' });
    await settle();
    await fixture.whenStable();

    expect(el.textContent).toContain('ส่งใบงานให้ไรเดอร์ไม่สำเร็จ');

    (el.querySelector('.btn-retry') as HTMLButtonElement).click();
    await settle();
    expect(flushJobsPut(http)).toHaveLength(1);
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('.publish')?.textContent).toContain('ส่งใบงานให้ไรเดอร์แล้ว');
  });

  it('คำนวณด้วยระยะทางตามถนนจริง และบอกบนหน้าจอ', async () => {
    await loadData(randomApiData());
    await calculate();

    const plan = service.plan()!;
    expect(plan.distanceMode).toBe('road');
    expect(el.querySelector('.distance-source')?.textContent).toContain('ถนนจริง');
    expect(el.textContent).not.toContain('เชื่อมต่อบริการแผนที่ (OSRM) ไม่ได้');
  });

  it('บริการแผนที่ใช้ไม่ได้ -> คำนวณด้วยระยะเส้นตรงแทน และแจ้งเตือน', async () => {
    roadsDown = true;
    await loadData(randomApiData());
    await calculate();

    expect(service.plan()!.distanceMode).toBe('straight');
    expect(el.querySelector('.distance-source')?.textContent).toContain('เส้นตรง');
    expect(el.textContent).toContain('เชื่อมต่อบริการแผนที่ (OSRM) ไม่ได้');
  });

  it('เปิดหน้าแล้วโหลดข้อมูลจากฐานข้อมูล และแสดงข้อความเมื่อ backend ติดต่อไม่ได้', async () => {
    http.match(`${API_URL}/customers`).forEach(r => r.error(new ProgressEvent('error')));
    await settle();
    await fixture.whenStable();

    expect(el.querySelector('.error')?.textContent).toContain('เชื่อมต่อ backend ไม่ได้');
  });
});
