import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_URL } from '../config';
import { DeliveryService } from './delivery';
import { RoutePlannerService } from './route-planner';
import { ApiData, customerRow, flushJobsPut, flushLists, orderRow, randomApiData, settle } from '../testing/api-mock';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let planner: RoutePlannerService;
  let http: HttpTestingController;

  // โหลดข้อมูลจากฐานข้อมูล (จำลอง) เข้า service
  const load = async (data: ApiData) => {
    const done = service.refresh();
    flushLists(http, data);
    expect(await done).toBe(true);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DeliveryService);
    planner = TestBed.inject(RoutePlannerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('โหลดข้อมูลจาก backend', () => {
    it('แปลงข้อมูลลูกค้า: รวมชื่อ, พิกัดจาก string เป็นตัวเลข, เก็บที่อยู่', async () => {
      await load({
        customers: [
          { ...customerRow(5, 16.2465, 103.251, 'สมชาย ใจดี'), address_detail: 'หอพัก A ห้อง 203' },
          customerRow(6, 16.2480, 103.2532, 'กิตติ') // ไม่มีนามสกุล = เก็บเป็น "-"
        ],
        orders: []
      });

      expect(service.customers()).toEqual([
        { id: 5, name: 'สมชาย ใจดี', phone: '0810000005', lat: 16.2465, lng: 103.251, address: 'หอพัก A ห้อง 203' },
        { id: 6, name: 'กิตติ', phone: '0810000006', lat: 16.248, lng: 103.2532, address: 'บ้านเลขที่ 6' }
      ]);
    });

    it('ออเดอร์: เอาเฉพาะ pending, ประกอบข้อมูลลูกค้า, เรียงตามรหัส', async () => {
      await load({
        customers: [customerRow(1, 16.2465, 103.251, 'ก ข'), customerRow(2, 16.2480, 103.2532, 'ค ง')],
        orders: [
          orderRow(12, 2, 3),
          orderRow(7, 1, 2),
          orderRow(9, 1, 1, 'delivered'),
          orderRow(10, 2, 1, 'cancelled')
        ]
      });

      expect(service.orders().map(o => [o.id, o.customerName, o.quantity, o.status])).toEqual([
        ['ORD-007', 'ก ข', 2, 'รอจัดเส้นทาง'],
        ['ORD-012', 'ค ง', 3, 'รอจัดเส้นทาง']
      ]);
      expect(service.orders()[0].lat).toBe(16.2465);
    });

    it('ข้ามลูกค้าที่ไม่มีพิกัด (วางบนแผนที่ไม่ได้)', async () => {
      await load({
        customers: [{ ...customerRow(1, 16.2, 103.2), latitude: null }, customerRow(2, 16.2465, 103.251)],
        orders: []
      });

      expect(service.customers().map(c => c.id)).toEqual([2]);
    });

    it('backend ติดต่อไม่ได้ -> เก็บข้อความ error ให้หน้าเว็บแสดง', async () => {
      const done = service.refresh();
      // forkJoin ยกเลิกคำขอที่เหลือเองเมื่อมีตัวใดตัวหนึ่ง error จึงตอบ error แค่ตัวแรกพอ
      http.match(r => r.url === `${API_URL}/customers`).forEach(r => r.error(new ProgressEvent('error')));

      expect(await done).toBe(false);
      expect(service.error()).toContain('เชื่อมต่อ backend ไม่ได้');
      expect(service.loading()).toBe(false);
    });
  });

  describe('ลูกค้า', () => {
    const form = { name: 'สมชาย ใจดี', phone: '0812345678', lat: 16.2465, lng: 103.251, address: 'หอพัก A' };

    it('เพิ่มลูกค้า -> POST แยกชื่อ/นามสกุลตามที่ backend ต้องการ แล้วโหลดรายการใหม่', async () => {
      const done = service.addCustomer(form);

      const post = http.expectOne(r => r.method === 'POST' && r.url === `${API_URL}/customers`);
      expect(post.request.body).toEqual({
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        phone_number: '0812345678',
        latitude: 16.2465,
        longitude: 103.251,
        address_detail: 'หอพัก A'
      });
      post.flush({ affected_row: 1, last_idx: 7 });
      await settle();

      flushLists(http, { customers: [customerRow(7, 16.2465, 103.251, 'สมชาย ใจดี')], orders: [] });
      expect(await done).toBe(true);
      expect(service.customers().map(c => c.id)).toEqual([7]);
    });

    it('ชื่อคำเดียว -> last_name เป็น "-" (backend ไม่ยอมให้ว่าง)', async () => {
      const done = service.addCustomer({ ...form, name: 'กิตติ' });

      const post = http.expectOne(r => r.method === 'POST' && r.url === `${API_URL}/customers`);
      expect(post.request.body).toMatchObject({ first_name: 'กิตติ', last_name: '-' });
      post.flush({ affected_row: 1, last_idx: 8 });
      await settle();
      flushLists(http, { customers: [], orders: [] });
      await done;
    });

    it('แก้ไขลูกค้า -> PUT /customers/:id', async () => {
      const done = service.updateCustomer(7, form);

      const put = http.expectOne(r => r.method === 'PUT' && r.url === `${API_URL}/customers/7`);
      expect(put.request.body).toMatchObject({ first_name: 'สมชาย', last_name: 'ใจดี' });
      put.flush({ affected_row: 1 });
      await settle();
      flushLists(http, { customers: [], orders: [] });
      expect(await done).toBe(true);
    });

    it('ลบลูกค้า -> DELETE /customers/:id', async () => {
      const done = service.removeCustomer(7);

      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/customers/7`).flush({ affected_row: 1 });
      await settle();
      flushLists(http, { customers: [], orders: [] });
      expect(await done).toBe(true);
    });

    it('backend ตอบ error -> คืน false และเก็บข้อความไว้แสดง', async () => {
      const done = service.addCustomer(form);

      http
        .expectOne(r => r.method === 'POST' && r.url === `${API_URL}/customers`)
        .flush({ error: 'Missing required fields' }, { status: 400, statusText: 'Bad Request' });

      expect(await done).toBe(false);
      expect(service.error()).toContain('Missing required fields');
    });
  });

  describe('ออเดอร์', () => {
    const data = (): ApiData => ({
      customers: [customerRow(1, 16.2465, 103.251), customerRow(2, 16.248, 103.2532)],
      orders: [orderRow(12, 1, 2)]
    });

    it('เพิ่มออเดอร์ -> POST /orders (customer_id, quantity)', async () => {
      await load(data());
      const done = service.addOrder(2, 3);

      const post = http.expectOne(r => r.method === 'POST' && r.url === `${API_URL}/orders`);
      expect(post.request.body).toEqual({ customer_id: 2, quantity: 3 });
      post.flush({ affected_row: 1, last_idx: 13 });
      await settle();
      flushLists(http, { ...data(), orders: [orderRow(12, 1, 2), orderRow(13, 2, 3)] });

      expect(await done).toBe(true);
      expect(service.orders().map(o => o.id)).toEqual(['ORD-012', 'ORD-013']);
    });

    it('ลูกค้าที่มีออเดอร์แล้วเพิ่มซ้ำไม่ได้ (ไม่ยิง API)', async () => {
      await load(data());

      expect(await service.addOrder(1, 1)).toBe(false);
      http.expectNone(r => r.method === 'POST');
    });

    it('เปลี่ยนจำนวนกล่อง -> หน้าจออัปเดตทันที แล้ว PUT /orders/:id', async () => {
      await load(data());
      const done = service.updateOrderQuantity('ORD-012', 3);

      expect(service.orders()[0].quantity).toBe(3); // ยังไม่ทันตอบก็เปลี่ยนแล้ว
      const put = http.expectOne(r => r.method === 'PUT' && r.url === `${API_URL}/orders/12`);
      expect(put.request.body).toEqual({ quantity: 3 });
      put.flush({ affected_row: 1 });

      expect(await done).toBe(true);
    });

    it('จำนวนกล่องเกิน 3 ถูกจำกัดไว้ที่ 3', async () => {
      await load(data());
      const done = service.updateOrderQuantity('ORD-012', 9);

      const put = http.expectOne(`${API_URL}/orders/12`);
      expect(put.request.body).toEqual({ quantity: 3 });
      put.flush({ affected_row: 1 });
      await done;
    });

    it('บันทึกจำนวนกล่องไม่สำเร็จ -> ดึงค่าจริงจากฐานข้อมูลกลับมา', async () => {
      await load(data());
      const done = service.updateOrderQuantity('ORD-012', 3);

      http.expectOne(`${API_URL}/orders/12`).flush({ error: 'Internal server error' }, { status: 500, statusText: 'x' });
      await settle();
      flushLists(http, data()); // ค่าจริงในฐานข้อมูลยังเป็น 2

      expect(await done).toBe(false);
      expect(service.orders()[0].quantity).toBe(2);
      expect(service.error()).toContain('500');
    });

    it('ลบออเดอร์ -> DELETE /orders/:id', async () => {
      await load(data());
      const done = service.removeOrder('ORD-012');

      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/orders/12`).flush({ affected_row: 1 });
      await settle();
      flushLists(http, { ...data(), orders: [] });

      expect(await done).toBe(true);
      expect(service.orders()).toEqual([]);
    });

    it('ล้างทั้งหมด -> DELETE /orders', async () => {
      await load(data());
      const done = service.clearOrders();

      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/orders`).flush({ affected_row: 1 });
      await settle();
      // ใบงานชุดเดิมใช้ไม่ได้แล้ว -> ล้างด้วย
      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/jobs`).flush({ affected_row: 3 });
      await settle();
      flushLists(http, { ...data(), orders: [] });

      expect(await done).toBe(true);
      expect(service.orders()).toEqual([]);
    });

    it('สุ่มออเดอร์ -> ล้างของเดิมก่อน แล้ว POST /orders/seed แล้วโหลดใหม่', async () => {
      const done = service.simulateOrders();
      flushLists(http, data()); // เช็กรายชื่อลูกค้าก่อน
      await settle();

      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/orders`).flush({ affected_row: 1 });
      await settle();
      http.expectOne(r => r.method === 'DELETE' && r.url === `${API_URL}/jobs`).flush({ affected_row: 0 });
      await settle();
      http.expectOne(r => r.method === 'POST' && r.url === `${API_URL}/orders/seed`).flush({ affected_row: 25 });
      await settle();
      flushLists(http, randomApiData(25));

      expect(await done).toBe(true);
      expect(service.orders()).toHaveLength(25);
    });

    it('สุ่มออเดอร์ตอนยังไม่มีลูกค้า -> แจ้งเตือน และไม่ล้างออเดอร์เดิม', async () => {
      const done = service.simulateOrders();
      flushLists(http, { customers: [], orders: [] });

      expect(await done).toBe(false);
      expect(service.error()).toContain('ยังไม่มีลูกค้า');
      http.expectNone(r => r.method === 'DELETE');
    });
  });

  describe('ใบงานไรเดอร์ (คำนวณในหน้าเว็บ แล้วเก็บในฐานข้อมูล)', () => {
    // คำนวณแผน แล้วตอบคำขอ PUT /jobs ให้สำเร็จ
    const planAndPublish = async () => {
      const plans = planner.propose(service.orders(), 1);
      const done = service.saveProposals(plans, 1);
      await settle();
      const bodies = flushJobsPut(http);
      expect(await done).toBe(true);
      return { plans, bodies };
    };

    it('คำนวณแล้วส่งใบงานของแผนที่เลือกขึ้น backend (PUT /jobs) และหน้าไรเดอร์เห็นใบงาน', async () => {
      await load(randomApiData());
      const { bodies } = await planAndPublish();

      const plan = service.plan()!;
      expect(bodies).toHaveLength(1);
      expect(bodies[0].jobs.map(j => j.jobCode)).toEqual(plan.routes.map(r => r.jobCode));
      expect(service.publishState()).toBe('saved');

      const jobs = service.getJobs();
      expect(Object.keys(jobs)).toEqual(plan.routes.map(r => r.jobCode));
      const first = plan.routes[0];
      expect(jobs[first.jobCode].boxes).toBe(first.totalBoxes);
      expect(jobs[first.jobCode].stopsCount).toBe(first.stops.length);
      expect(jobs[first.jobCode].stops[0].name).toBe(first.stops[0].name);
    });

    it('เลือกแผนอื่นแล้วส่งใบงานชุดใหม่ขึ้นไปแทน', async () => {
      await load(randomApiData());
      const { plans } = await planAndPublish();

      const last = plans.length - 1;
      const done = service.selectPlan(last);
      await settle();
      const bodies = flushJobsPut(http);
      await done;

      expect(service.plan()).toBe(plans[last]);
      if (last > 0) {
        expect(bodies[0].jobs.map(j => j.jobCode)).toEqual(plans[last].routes.map(r => r.jobCode));
      }
      expect(Object.keys(service.getJobs())).toEqual(plans[last].routes.map(r => r.jobCode));
    });

    it('กดเลือกแผนรัว ๆ -> ส่งทีละคำขอ และแผนที่เลือกล่าสุดเป็นตัวที่ถูกบันทึก', async () => {
      await load(randomApiData());
      // แผน 2 แบบที่ใบงานต่างกันแน่นอน: แบบเต็ม กับแบบที่มีแค่ใบงานแรก
      const full = planner.propose(service.orders(), 1)[0];
      const plans = [full, { ...full, key: 'alt', routes: full.routes.slice(0, 1) }];
      const saved = service.saveProposals(plans, 1);
      await settle();
      flushJobsPut(http);
      await saved;

      void service.selectPlan(1);
      const final = service.selectPlan(0);
      await settle();
      // คำขอแรกยังไม่ตอบ -> คำขอที่สองต้องยังไม่ถูกส่ง
      const first = http.match(r => r.method === 'PUT' && r.url === `${API_URL}/jobs`);
      expect(first).toHaveLength(1);
      first[0].flush({ affected_row: 1 });
      await settle();
      const second = flushJobsPut(http);
      await final;

      expect(second[0].jobs.map(j => j.jobCode)).toEqual(full.routes.map(r => r.jobCode));
      expect(Object.keys(service.getJobs())).toEqual(full.routes.map(r => r.jobCode));
      expect(service.publishState()).toBe('saved');
    });

    it('ส่งใบงานไม่สำเร็จ -> แจ้ง error และกดส่งซ้ำได้', async () => {
      await load(randomApiData());
      const done = service.saveProposals(planner.propose(service.orders(), 1), 1);
      await settle();
      http.expectOne(r => r.method === 'PUT' && r.url === `${API_URL}/jobs`)
        .flush({ error: 'Internal server error' }, { status: 500, statusText: 'Server Error' });

      expect(await done).toBe(false);
      expect(service.publishState()).toBe('error');
      expect(service.getJobs()).toEqual({});

      const retry = service.publishJobs();
      await settle();
      flushJobsPut(http);
      expect(await retry).toBe(true);
      expect(service.publishState()).toBe('saved');
    });

    it('ไรเดอร์เปิดจากมือถืออีกเครื่อง -> ดึงใบงานจาก GET /jobs', async () => {
      const done = service.loadJobs();
      http.expectOne(r => r.method === 'GET' && r.url === `${API_URL}/jobs`).flush([
        { jobCode: 'JOB-01', riderName: 'ไรเดอร์ คนที่ 1', color: '#e53935', boxes: 4, stopsCount: 1,
          distanceKm: 1.2, durationMin: 5, stops: [{ name: 'สมชาย ใจดี', boxes: 4, phone: '0812345678', time: '11:35 น.', lat: 16.25, lng: 103.25 }],
          publishedAt: '2026-10-28T04:31:00.000Z' }
      ]);

      expect(await done).toBe(true);
      expect(service.getJobs()['JOB-01'].stops[0].name).toBe('สมชาย ใจดี');
      expect(service.plan()).toBeNull(); // เครื่องนี้ไม่ได้คำนวณแผนเอง
    });

    it('โหลดข้อมูลซ้ำแล้วออเดอร์เหมือนเดิม -> แผนยังใช้ได้', async () => {
      const data = randomApiData();
      await load(data);
      await planAndPublish();

      await load(data);

      expect(service.planOutdated()).toBe(false);
      expect(service.plan()).not.toBeNull();
    });

    it('ออเดอร์เปลี่ยนหลังคำนวณ -> แผนเดิมถูกทิ้ง ต้องคำนวณใหม่ (ใบงานที่ส่งไปแล้วยังอยู่จนกว่าจะคำนวณใหม่)', async () => {
      const data = randomApiData();
      await load(data);
      await planAndPublish();
      const published = Object.keys(service.getJobs());
      expect(service.planOutdated()).toBe(false);

      await load({ ...data, orders: data.orders.slice(1) }); // มีคนลบออเดอร์แรกในฐานข้อมูล

      expect(service.plan()).toBeNull();
      expect(service.planOutdated()).toBe(true);
      expect(Object.keys(service.getJobs())).toEqual(published);
    });
  });
});
