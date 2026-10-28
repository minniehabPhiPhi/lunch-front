import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customer } from './customer';
import { API_URL } from '../../config';
import { customerRow, flushLists, settle } from '../../testing/api-mock';
import { SHOP_LOCATION } from '../../utils/geo';

describe('Customer', () => {
  let component: Customer;
  let fixture: ComponentFixture<Customer>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const isPost = (r: { method: string; url: string }) => r.method === 'POST' && r.url === `${API_URL}/customers`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Customer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Customer);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('เปิดหน้าแล้วแสดงรายชื่อลูกค้าจากฐานข้อมูล พร้อมที่อยู่', async () => {
    flushLists(http, {
      customers: [{ ...customerRow(1, SHOP_LOCATION.lat, SHOP_LOCATION.lng, 'สมชาย ใจดี'), address_detail: 'หอพัก A' }],
      orders: []
    });
    await fixture.whenStable();

    expect(el.querySelectorAll('.row').length).toBe(1);
    expect(el.querySelector('.row')?.textContent).toContain('สมชาย ใจดี');
    expect(el.querySelector('.row')?.textContent).toContain('หอพัก A');
  });

  it('ไม่กรอกที่อยู่ -> แจ้งเตือน และไม่ส่งข้อมูลไป backend', async () => {
    flushLists(http, { customers: [], orders: [] });
    await fixture.whenStable();

    component.name.set('สมชาย ใจดี');
    component.phone.set('0812345678');
    await component.saveCustomer();

    http.expectNone(isPost);
    expect(component.errorMsg()).toContain('ที่อยู่');
  });

  it('กรอกครบ -> POST ไป backend แล้วล้างฟอร์ม และเห็นลูกค้าใหม่ในรายการ', async () => {
    flushLists(http, { customers: [], orders: [] });
    await fixture.whenStable();

    component.name.set('สมชาย ใจดี');
    component.phone.set('0812-345-678');
    component.address.set('หอพัก A ห้อง 203');
    const done = component.saveCustomer();

    const post = http.expectOne(isPost);
    expect(post.request.body).toMatchObject({
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      phone_number: '0812345678',
      address_detail: 'หอพัก A ห้อง 203'
    });
    post.flush({ affected_row: 1, last_idx: 1 });
    await settle();
    flushLists(http, { customers: [customerRow(1, SHOP_LOCATION.lat, SHOP_LOCATION.lng, 'สมชาย ใจดี')], orders: [] });
    await done;
    await fixture.whenStable();

    expect(component.name()).toBe('');
    expect(component.address()).toBe('');
    expect(el.querySelectorAll('.row').length).toBe(1);
  });

  it('backend ปฏิเสธ -> ไม่ล้างฟอร์ม และแสดงข้อความ error', async () => {
    flushLists(http, { customers: [], orders: [] });
    await fixture.whenStable();

    component.name.set('สมชาย ใจดี');
    component.phone.set('0812345678');
    component.address.set('หอพัก A');
    const done = component.saveCustomer();
    http.expectOne(isPost).flush({ error: 'Internal server error' }, { status: 500, statusText: 'Error' });
    await done;
    await fixture.whenStable();

    expect(component.name()).toBe('สมชาย ใจดี');
    expect(el.querySelector('.error')?.textContent).toContain('500');
  });
});
