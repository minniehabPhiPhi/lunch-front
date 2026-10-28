import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Route } from './route';
import { DeliveryService } from '../../services/delivery';
import { API_URL } from '../../config';
import { ApiData, customerRow, flushJobsPut, flushLists, orderRow, randomApiData, settle } from '../../testing/api-mock';
import { SHOP_LOCATION } from '../../utils/geo';

describe('Route', () => {
  let component: Route;
  let fixture: ComponentFixture<Route>;
  let service: DeliveryService;
  let http: HttpTestingController;
  let el: HTMLElement;

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
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

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

  it('คำนวณแล้วแสดงใบงานครบทุกไรเดอร์ พร้อมสรุปกำไรและทางเลือก', async () => {
    await loadData(randomApiData());
    await calculate();

    const plan = service.plan()!;
    expect(plan).not.toBeNull();
    expect(el.querySelectorAll('.job').length).toBe(plan.routes.length);
    expect(el.querySelectorAll('.summary .sum-cell').length).toBe(6);
    expect(el.querySelectorAll('.alt').length).toBe(component.proposals().length);
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

  it('เลือกทางเลือกอื่นแล้วใบงานที่แสดงเปลี่ยนตาม', async () => {
    await loadData(randomApiData());
    await calculate();

    const alts = Array.from(el.querySelectorAll<HTMLButtonElement>('.alt'));
    const last = alts.length - 1;
    alts[last].click();
    await settle();
    flushJobsPut(http);
    await settle();
    await fixture.whenStable();

    expect(service.routeState()?.selected).toBe(last);
    expect(el.querySelectorAll('.job').length).toBe(service.plan()!.routes.length);
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

  it('เปิดหน้าแล้วโหลดข้อมูลจากฐานข้อมูล และแสดงข้อความเมื่อ backend ติดต่อไม่ได้', async () => {
    http.match(`${API_URL}/customers`).forEach(r => r.error(new ProgressEvent('error')));
    await settle();
    await fixture.whenStable();

    expect(el.querySelector('.error')?.textContent).toContain('เชื่อมต่อ backend ไม่ได้');
  });
});
