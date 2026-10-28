import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Rider } from './rider';
import { API_URL } from '../../config';
import { flushJobsGet, flushJobsPut, flushLists, randomApiData, settle } from '../../testing/api-mock';
import { DeliveryService } from '../../services/delivery';
import { RoutePlannerService } from '../../services/route-planner';

describe('Rider', () => {
  let component: Rider;
  let fixture: ComponentFixture<Rider>;
  let service: DeliveryService;
  let http: HttpTestingController;
  let el: HTMLElement;

  // จัดเส้นทางจากออเดอร์สุ่มให้เหมือนที่เจ้าของร้านกดในหน้า 3
  let data = randomApiData();
  const planRoutes = async () => {
    const done = service.refresh();
    flushLists(http, data);
    await done;
    const saved = service.saveProposals(TestBed.inject(RoutePlannerService).propose(service.orders(), 1), 1);
    await settle();
    flushJobsPut(http);
    await saved;
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Rider],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    data = randomApiData();
    service = TestBed.inject(DeliveryService);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Rider);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    flushJobsGet(http, []); // เปิดหน้าแล้วดึงใบงานจากฐานข้อมูล (ยังไม่มี)
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ยังไม่มีใบงาน -> บอกให้รอเจ้าของร้านจัดเส้นทาง', () => {
    expect(el.querySelector('.empty')?.textContent).toContain('ยังไม่มีใบงาน');
    expect(el.querySelectorAll('.chip').length).toBe(0);
  });

  it('มีใบงานแล้วแต่ยังไม่กรอก -> บอกให้กรอกรหัส และมีปุ่มเลือกใบงานครบ', async () => {
    await planRoutes();

    expect(el.querySelector('.empty')?.textContent).toContain('รหัสใบงาน');
    expect(el.querySelectorAll('.chip').length).toBe(service.plan()!.routes.length);
  });

  it('กรอกรหัสแล้วเห็นจำนวนกล่อง และลำดับจุดส่งตามแผน', async () => {
    await planRoutes();
    const route = service.plan()!.routes[0];

    component.selectedJobId.set(route.jobCode);
    await fixture.whenStable();

    expect(el.querySelector('.tile h3')?.textContent).toContain(`${route.totalBoxes} กล่อง`);
    const steps = Array.from(el.querySelectorAll('.step strong')).map(s => s.textContent);
    expect(steps).toHaveLength(route.stops.length);
    expect(steps[0]).toContain('จุดที่ 1');
    expect(steps[0]).toContain(route.stops[0].name);
  });

  it('พิมพ์รหัสแบบสั้น (1, job-1, JOB 01) ก็เจอใบงานเดียวกัน', async () => {
    await planRoutes();

    for (const text of ['1', '01', 'job-1', ' JOB 01 ']) {
      component.selectedJobId.set(text);
      expect(component.currentJob()?.jobCode).toBe('JOB-01');
    }
  });

  it('รหัสที่ไม่มีอยู่ -> แจ้งว่าไม่พบใบงาน', async () => {
    await planRoutes();

    component.selectedJobId.set('JOB-99');
    await fixture.whenStable();

    expect(component.currentJob()).toBeNull();
    expect(el.querySelector('.empty')?.textContent).toContain('ไม่พบใบงาน');
  });

  it('ปุ่มแผนที่เป็นลิงก์ Google Maps ผ่านทุกจุดส่งตามลำดับ', async () => {
    await planRoutes();
    const route = service.plan()!.routes.find(r => r.stops.length === 3) ?? service.plan()!.routes[0];

    component.selectedJobId.set(route.jobCode);
    await fixture.whenStable();

    const link = el.querySelector<HTMLAnchorElement>('.btn-map')!;
    const url = new URL(link.href);
    const last = route.stops[route.stops.length - 1];
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('destination')).toBe(`${last.lat},${last.lng}`);
    expect(url.searchParams.get('waypoints')).toBe(
      route.stops.slice(0, -1).map(s => `${s.lat},${s.lng}`).join('|') || null
    );
    expect(link.target).toBe('_blank');
  });

  it('เปิดจากมือถืออีกเครื่อง -> กดโหลดใบงานล่าสุด แล้วเห็นใบงานที่เจ้าของร้านส่งมา', async () => {
    const button = el.querySelector<HTMLButtonElement>('.btn-reload')!;
    expect(button.textContent).toContain('โหลดใบงานล่าสุด');

    button.click();
    await settle();
    flushJobsGet(http, [
      {
        jobCode: 'JOB-01', riderName: 'ไรเดอร์ คนที่ 1', color: '#e53935', boxes: 5, stopsCount: 2,
        distanceKm: 2.4, durationMin: 11, publishedAt: '2026-10-28T04:31:00.000Z',
        stops: [
          { name: 'สมชาย ใจดี', boxes: 3, phone: '0812345678', time: '11:36 น.', lat: 16.25, lng: 103.25 },
          { name: 'สมหญิง รักดี', boxes: 2, phone: '0898765432', time: '11:41 น.', lat: 16.252, lng: 103.248 }
        ]
      }
    ]);
    await settle();
    await fixture.whenStable();

    component.selectedJobId.set('1');
    await fixture.whenStable();

    expect(el.querySelector('.tile h3')?.textContent).toContain('5 กล่อง');
    expect(el.querySelector('.updated')?.textContent).toContain('น.');
    const steps = Array.from(el.querySelectorAll('.step strong')).map(s => s.textContent);
    expect(steps[0]).toContain('สมชาย ใจดี');
    expect(steps[1]).toContain('สมหญิง รักดี');
  });

  it('backend ติดต่อไม่ได้ -> แสดงข้อความ error', async () => {
    el.querySelector<HTMLButtonElement>('.btn-reload')!.click();
    await settle();
    http.match(r => r.method === 'GET' && r.url === `${API_URL}/jobs`).forEach(r => r.error(new ProgressEvent('error')));
    await settle();
    await fixture.whenStable();

    expect(el.querySelector('.error')?.textContent).toContain('เชื่อมต่อ backend ไม่ได้');
  });
});
