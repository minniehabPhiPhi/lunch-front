import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Order } from './order';
import { API_URL } from '../../config';
import { flushLists, randomApiData, settle } from '../../testing/api-mock';

describe('Order', () => {
  let component: Order;
  let fixture: ComponentFixture<Order>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Order],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Order);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('เปิดหน้าแล้วแสดงออเดอร์จากฐานข้อมูล พร้อมสรุปยอด', async () => {
    const data = randomApiData(5);
    flushLists(http, data);
    await fixture.whenStable();

    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    const boxes = data.orders.reduce((sum, o) => sum + o.quantity, 0);
    expect(component.totalBoxes()).toBe(boxes);
    expect(component.totalProfit()).toBe(boxes * (65 - 40));
  });

  it('กดสุ่มออเดอร์ -> ล้างของเดิม แล้วให้ backend สุ่มใหม่ และแสดงในตาราง', async () => {
    const data = randomApiData(25);
    flushLists(http, { customers: data.customers, orders: [] }); // มีลูกค้า ยังไม่มีออเดอร์
    await fixture.whenStable();

    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    await settle();
    flushLists(http, { customers: data.customers, orders: [] }); // simulateOrders เช็กรายชื่อลูกค้าก่อน
    await settle();
    http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/orders`).flush({ affected_row: 0 });
    await settle();
    http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/jobs`).flush({ affected_row: 0 }); // ล้างใบงานเดิม
    await settle();
    http.expectOne(r => r.method === 'POST' && r.url === `${API_URL}/orders/seed`).flush({ affected_row: 25 });
    await settle();
    flushLists(http, data);
    await settle(); // รอให้ service เก็บข้อมูลที่โหลดมาเสร็จก่อนค่อยรอหน้าจอวาด
    await fixture.whenStable();

    expect(el.querySelectorAll('tbody tr').length).toBe(25);
  });

  it('กดปุ่ม + จำนวนกล่อง -> เปลี่ยนทันที แล้วบันทึกลงฐานข้อมูล', async () => {
    const data = randomApiData(3); // ออเดอร์แรกมี 1 กล่อง
    flushLists(http, data);
    await fixture.whenStable();

    const plus = el.querySelectorAll<HTMLButtonElement>('tbody tr')[0].querySelectorAll<HTMLButtonElement>('.step')[1];
    plus.click();
    await settle();

    const put = http.expectOne(r => r.method === 'PUT' && r.url === `${API_URL}/orders/1`);
    expect(put.request.body).toEqual({ quantity: 2 });
    put.flush({ affected_row: 1 });
    await settle();
    await fixture.whenStable();

    expect(el.querySelector('tbody tr .qty-num')?.textContent).toContain('2');
  });
});
