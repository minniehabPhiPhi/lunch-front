import { TestBed } from '@angular/core/testing';
import { MIN_CHANGE_RATIO, RoutePlannerService, changeRatio } from './route-planner';
import { OrderInfo } from '../models/order.model';
import { DEADLINE_MINUTES, DEPARTURE_MINUTES, MAX_ORDERS_PER_RIDER } from '../models/route.model';
import { DELIVERY_RADIUS_KM, SHOP_LOCATION, distanceKm, randomPointInRadius } from '../utils/geo';

// ออเดอร์ทดสอบ (วางพิกัดเป็น กม. ทางทิศเหนือของร้าน)
function orderAt(no: number, quantity: number, km: { north: number; east?: number }): OrderInfo {
  return {
    id: `ORD-${String(no).padStart(3, '0')}`,
    customerId: no,
    customerName: `ลูกค้า ${no}`,
    phone: '0812345678',
    quantity,
    status: 'รอจัดเส้นทาง',
    time: '11:00 น.',
    lat: SHOP_LOCATION.lat + km.north / 111.32,
    lng: SHOP_LOCATION.lng + (km.east ?? 0) / (111.32 * Math.cos((SHOP_LOCATION.lat * Math.PI) / 180))
  };
}

function randomOrders(count: number): OrderInfo[] {
  return Array.from({ length: count }, (_, i) => {
    const p = randomPointInRadius(SHOP_LOCATION, DELIVERY_RADIUS_KM);
    return { ...orderAt(i + 1, (i % 3) + 1, { north: 0 }), lat: p.lat, lng: p.lng };
  });
}

describe('RoutePlannerService', () => {
  let planner: RoutePlannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    planner = TestBed.inject(RoutePlannerService);
  });

  it('ไม่มีออเดอร์ = ไม่มีแผน', () => {
    expect(planner.propose([])).toEqual([]);
  });

  it('คิดค่าไรเดอร์ตามโจทย์: 6 กล่อง วิ่ง 2 กม. = ค่าเรียก 15 + (2 x 6 x 2 = 24) = 39 บาท', () => {
    const [plan] = planner.propose([orderAt(1, 6, { north: 2 })]);
    const route = plan.routes[0];

    expect(route.distanceKm).toBeCloseTo(2, 2);
    expect(route.tripFee).toBe(15);
    expect(route.distanceFee).toBe(24);
    expect(route.cost).toBe(39);
  });

  it('ทุกออเดอร์ถูกจัดให้ไรเดอร์ครบ คนละครั้งเดียว และไรเดอร์ไม่เกินคนละ 3 จุด', () => {
    const orders = randomOrders(27);

    for (const plan of planner.propose(orders)) {
      const assigned = plan.routes.flatMap(r => r.stops.map(s => s.orderId));
      expect([...assigned].sort()).toEqual(orders.map(o => o.id).sort());
      for (const route of plan.routes) {
        expect(route.stops.length).toBeGreaterThan(0);
        expect(route.stops.length).toBeLessThanOrEqual(MAX_ORDERS_PER_RIDER);
        expect(route.totalBoxes).toBe(route.stops.reduce((sum, s) => sum + s.boxes, 0));
      }
    }
  });

  it('เวลาถึงเรียงตามลำดับจุดส่ง เริ่มหลัง 11:30 และส่งทันก่อน 12:30 เมื่อลูกค้าอยู่ในรัศมี 3 กม.', () => {
    for (const plan of planner.propose(randomOrders(30))) {
      expect(plan.summary.allOnTime).toBe(true);
      for (const route of plan.routes) {
        const times = route.stops.map(s => s.arrivalMin);
        expect(times[0]).toBeGreaterThan(DEPARTURE_MINUTES - 1);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(times[times.length - 1]).toBeLessThanOrEqual(DEADLINE_MINUTES);
      }
    }
  });

  it('สรุปกำไร = รายได้ - ต้นทุนข้าว - ค่าไรเดอร์', () => {
    for (const plan of planner.propose(randomOrders(24))) {
      const s = plan.summary;
      expect(s.revenue).toBe(s.boxes * 65);
      expect(s.foodCost).toBe(s.boxes * 40);
      expect(s.riderCost).toBe(plan.routes.reduce((sum, r) => sum + r.cost, 0));
      expect(s.profit).toBe(s.revenue - s.foodCost - s.riderCost);
    }
  });

  it('เลือกลำดับจุดส่งที่ระยะสั้นกว่า (ไม่วิ่งกลับไปกลับมา)', () => {
    // ลูกค้า 3 คนอยู่แนวเดียวกัน 1, 2, 3 กม. ส่งใส่ลำดับสลับกัน -> ต้องส่งจากใกล้ไปไกล = วิ่งรวม 3 กม.
    const orders = [orderAt(1, 1, { north: 3 }), orderAt(2, 1, { north: 1 }), orderAt(3, 1, { north: 2 })];
    const [plan] = planner.propose(orders);

    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].stops.map(s => s.orderId)).toEqual(['ORD-002', 'ORD-003', 'ORD-001']);
    expect(plan.routes[0].distanceKm).toBeCloseTo(3, 2);
  });

  it('แจ้งขาดทุนเมื่อค่าไรเดอร์สูงกว่ากำไรต่อกล่อง (1 กล่อง ไกล 10 กม.)', () => {
    const [plan] = planner.propose([orderAt(1, 1, { north: 10 })]);

    // รายได้ 65 - ข้าว 40 - (15 + 2 x 1 x 10) = -10
    expect(plan.summary.profit).toBe(-10);
  });

  it('แจ้งว่าส่งไม่ทันเมื่อถึงหลัง 12:30', () => {
    const [plan] = planner.propose([orderAt(1, 1, { north: 40 })]); // 40 กม. ที่ 30 กม./ชม. = 80 นาที

    expect(plan.summary.allOnTime).toBe(false);
    expect(plan.summary.lateStops).toBe(1);
    expect(plan.routes[0].onTime).toBe(false);
  });

  it('คำนวณซ้ำด้วยข้อมูลเดิมได้ผลเดิม', () => {
    const orders = randomOrders(25);
    const keys = (round: number) => planner.propose(orders, round).map(p => p.key);

    expect(keys(1)).toEqual(keys(1));
    expect(keys(2)).toEqual(keys(2));
  });

  it('กดคำนวณใหม่ได้แผนที่ต่างจากที่เคยเสนอแล้ว', () => {
    const orders = randomOrders(25);
    const first = planner.propose(orders, 1);
    const seen = first.map(p => p.key);
    const second = planner.propose(orders, 2, seen);

    expect(second.some(p => !seen.includes(p.key))).toBe(true);
  });

  it('เสนอหลายแบบ แผนที่ส่งทันและกำไรสูงสุดอยู่ก่อน', () => {
    const plans = planner.propose(randomOrders(26));

    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].summary.profit).toBeGreaterThanOrEqual(plans[i].summary.profit);
    }
  });

  it('ไม่ส่งระยะทางตามถนนมา = ใช้ระยะเส้นตรง', () => {
    const plans = planner.propose(randomOrders(9));
    expect(plans.every(p => p.distanceMode === 'straight')).toBe(true);
  });

  it('ส่งระยะทางตามถนนมา -> ระยะทาง เวลา และค่าไรเดอร์คิดจากถนน', () => {
    const orders = randomOrders(9);
    const road = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => distanceKm(a, b) * 1.4; // ถนนอ้อมกว่าเส้นตรง 40%
    const plan = planner.propose(orders, 1, [], road)[0];

    expect(plan.distanceMode).toBe('road');
    for (const r of plan.routes) {
      // ระยะทางของไรเดอร์ = ผลรวมระยะตามถนน ร้าน -> จุดที่ 1 -> ... -> จุดสุดท้าย
      const expected = r.stops.reduce(
        (sum, s, i) => sum + road(i === 0 ? SHOP_LOCATION : r.stops[i - 1], s),
        0
      );
      expect(r.distanceKm).toBeCloseTo(expected, 6);
      expect(r.distanceFee).toBe(Math.round(2 * r.totalBoxes * expected));
    }
  });

  describe('กด "คำนวณใหม่"', () => {
    // ออเดอร์วางเป็นเกลียวรอบร้าน (ตำแหน่งตายตัว ผลทดสอบไม่สุ่ม)
    const spiralOrders = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const r = 0.4 + (2.5 * (i + 1)) / count;
        const a = i * 2.39996; // มุมทองคำ กระจายทั่ววง
        return orderAt(i + 1, (i % 3) + 1, { north: r * Math.cos(a), east: r * Math.sin(a) });
      });
    const groupsOf = (plan: { routes: { stops: { orderId: string }[] }[] }) =>
      plan.routes.map(r => r.stops.map(s => s.orderId));

    it('วัดสัดส่วนออเดอร์ที่ย้ายกลุ่มได้ถูกต้อง', () => {
      expect(changeRatio([['A', 'B'], ['C', 'D']], [['B', 'A'], ['D', 'C']])).toBe(0); // แค่สลับลำดับส่ง = ไม่เปลี่ยน
      expect(changeRatio([['A', 'B'], ['C', 'D']], [['A', 'C'], ['B', 'D']])).toBe(1);
      expect(changeRatio([['A', 'B'], ['C'], ['D']], [['A', 'B'], ['C', 'D']])).toBe(0.5);
    });

    for (const count of [14, 28]) {
      it(`${count} ออเดอร์: แผนใหม่ต่างจากแผนที่เพิ่งเห็นอย่างน้อย ${MIN_CHANGE_RATIO * 100}% และยังส่งทันทุกจุด`, () => {
        const orders = spiralOrders(count);
        let previous = planner.propose(orders, 1)[0];
        const seen = [previous.key];
        for (let round = 2; round <= 4; round++) {
          const next = planner.propose(orders, round, seen, null, previous)[0];
          expect(changeRatio(groupsOf(previous), groupsOf(next))).toBeGreaterThanOrEqual(MIN_CHANGE_RATIO);
          expect(next.summary.allOnTime).toBe(true);
          seen.push(next.key);
          previous = next;
        }
      });
    }

    it('เส้นทางที่ส่งบ้านชุดเดิม ใช้เลขใบงานและสีเดิม ส่วนที่เปลี่ยนถูกทำเครื่องหมาย', () => {
      const orders = spiralOrders(14);
      const previous = planner.propose(orders, 1)[0];
      const next = planner.propose(orders, 2, [previous.key], null, previous)[0];

      const before = new Map(previous.routes.map(r => [r.stops.map(s => s.orderId).sort().join(','), r]));
      for (const r of next.routes) {
        const same = before.get(r.stops.map(s => s.orderId).sort().join(','));
        if (same) {
          expect(r.jobCode).toBe(same.jobCode);
          expect(r.color).toBe(same.color);
          expect(r.changed).toBe(false);
        } else {
          expect(r.changed).toBe(true);
        }
      }
      expect(next.routes.some(r => r.changed)).toBe(true);
      expect(new Set(next.routes.map(r => r.jobCode)).size).toBe(next.routes.length); // รหัสใบงานไม่ซ้ำกัน
    });
  });
});
