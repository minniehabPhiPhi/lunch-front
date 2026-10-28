import { Injectable } from '@angular/core';
import { BOX_COST, BOX_PRICE, OrderInfo } from '../models/order.model';
import {
  DEADLINE_MINUTES,
  DEPARTURE_MINUTES,
  DROP_OFF_MINUTES,
  MAX_ORDERS_PER_RIDER,
  PlanSummary,
  RIDER_RATE_PER_KM_BOX,
  RIDER_SPEED_KMH,
  RIDER_TRIP_FEE,
  ROUTE_COLORS,
  RiderRoute,
  RoutePlan,
  RouteStrategy
} from '../models/route.model';
import { LatLng, SHOP_LOCATION, distanceKm } from '../utils/geo';
import { LegDistance } from './road-network';
import { formatTime } from '../utils/time';

// วิธีจัดเส้นทางที่ระบบจะเสนอให้เลือกทุกครั้ง
const STRATEGIES: RouteStrategy[] = ['cheapest', 'shortest', 'fastest'];

// โทษต่อ 1 นาทีที่ส่งเลย 12:30 (ใหญ่มาก = ระบบจะเลี่ยงแผนที่ส่งไม่ทันเสมอ)
const LATE_PENALTY = 10_000;

// ---------- ตัวช่วยเล็ก ๆ ----------

// ตัวสุ่มที่กำหนด seed ได้ (mulberry32) -> ผลคำนวณซ้ำได้ ทดสอบง่าย
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest])
  );
}

// ---------- คำนวณเส้นทางของไรเดอร์ 1 คน ----------

// ค่าเรียก 15 บาท + 2 บาท x จำนวนกล่อง x ระยะทางที่ขับทั้งรอบ
function riderFees(boxes: number, distance: number) {
  const distanceFee = RIDER_RATE_PER_KM_BOX * boxes * distance;
  return { tripFee: RIDER_TRIP_FEE, distanceFee, cost: RIDER_TRIP_FEE + distanceFee };
}

// วัดระยะทางและเวลาถึงของแต่ละจุด เมื่อไรเดอร์ออกจากร้าน 11:30 แล้วส่งตามลำดับ seq
// leg = ระยะทางระหว่าง 2 จุด (ตามถนนจริง หรือเส้นตรงถ้าเรียกบริการแผนที่ไม่ได้)
function measure(seq: readonly OrderInfo[], leg: LegDistance) {
  const legs: number[] = [];
  const arrivals: number[] = [];
  let prev: LatLng = SHOP_LOCATION;
  let total = 0;

  seq.forEach((order, i) => {
    const km = leg(prev, order);
    legs.push(km);
    total += km;
    // เวลาถึง = ออกเดินทาง + เวลาขับ + เวลายื่นของที่จุดก่อนหน้า (ปัดขึ้นเป็นนาที)
    arrivals.push(Math.ceil(DEPARTURE_MINUTES + (total / RIDER_SPEED_KMH) * 60 + DROP_OFF_MINUTES * i));
    prev = order;
  });

  return { legs, arrivals, distance: total };
}

function sumBoxes(seq: readonly OrderInfo[]): number {
  return seq.reduce((sum, o) => sum + o.quantity, 0);
}

// ค่าที่ต้องการให้ต่ำที่สุดของไรเดอร์ 1 คน ตามวิธีที่เลือก
function valueOf(seq: readonly OrderInfo[], strategy: RouteStrategy, leg: LegDistance): number {
  const m = measure(seq, leg);
  const late = m.arrivals.reduce((sum, t) => sum + Math.max(0, t - DEADLINE_MINUTES), 0);

  let base: number;
  if (strategy === 'cheapest') {
    base = riderFees(sumBoxes(seq), m.distance).cost;
  } else if (strategy === 'shortest') {
    base = m.distance;
  } else {
    base = m.arrivals.reduce((sum, t) => sum + (t - DEPARTURE_MINUTES), 0); // เวลาที่ลูกค้ารอรวมกัน
  }
  return base + LATE_PENALTY * late;
}

interface GroupSolution {
  seq: OrderInfo[]; // ลำดับจุดส่งที่ดีที่สุดของกลุ่มนี้
  value: number;
}

// หาลำดับส่งที่ดีที่สุดของกลุ่ม (กลุ่มละไม่เกิน 3 ออเดอร์ = ลองครบทุกลำดับได้เลย) พร้อมจำผลไว้
function createSolver(strategy: RouteStrategy, leg: LegDistance) {
  const cache = new Map<string, GroupSolution>();

  return (group: readonly OrderInfo[]): GroupSolution => {
    if (group.length === 0) {
      return { seq: [], value: 0 };
    }
    const key = group.map(o => o.id).sort().join(',');
    let solution = cache.get(key);
    if (!solution) {
      for (const seq of permutations(group)) {
        const value = valueOf(seq, strategy, leg);
        if (!solution || value < solution.value - 1e-9) {
          solution = { seq, value };
        }
      }
      cache.set(key, solution!);
    }
    return solution!;
  };
}

// ---------- แบ่งออเดอร์เป็นกลุ่ม (1 กลุ่ม = ไรเดอร์ 1 คน) ----------

function balancedSizes(total: number, groups: number): number[] {
  const base = Math.floor(total / groups);
  const extra = total % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

function splitBySizes<T>(items: readonly T[], sizes: readonly number[]): T[][] {
  let start = 0;
  return sizes.map(size => {
    const part = items.slice(start, start + size);
    start += size;
    return part;
  });
}

// เริ่มต้นแบบกวาดรอบร้าน: เรียงตามทิศทางจากร้านแล้วตัดทีละกลุ่ม
function sweepStart(orders: readonly OrderInfo[], groups: number): OrderInfo[][] {
  const cosLat = Math.cos((SHOP_LOCATION.lat * Math.PI) / 180);
  const angle = (o: OrderInfo) => Math.atan2(o.lat - SHOP_LOCATION.lat, (o.lng - SHOP_LOCATION.lng) * cosLat);
  const sorted = [...orders].sort((a, b) => angle(a) - angle(b));
  return splitBySizes(sorted, balancedSizes(orders.length, groups));
}

// เริ่มต้นแบบเกาะกลุ่ม: เอาออเดอร์ที่ไกลร้านสุดเป็นหัวกลุ่ม แล้วดึงออเดอร์ที่อยู่ใกล้ที่สุดมาร่วมทาง
function clusterStart(orders: readonly OrderInfo[], groups: number, leg: LegDistance): OrderInfo[][] {
  const remaining = [...orders];
  const sizes = balancedSizes(orders.length, groups).sort((a, b) => b - a);

  return sizes.map(size => {
    remaining.sort((a, b) => leg(SHOP_LOCATION, b) - leg(SHOP_LOCATION, a));
    const seed = remaining.shift()!;
    const group = [seed];
    while (group.length < size) {
      remaining.sort((a, b) => leg(seed, a) - leg(seed, b));
      group.push(remaining.shift()!);
    }
    return group;
  });
}

function randomStart(orders: readonly OrderInfo[], groups: number, random: () => number): OrderInfo[][] {
  return splitBySizes(shuffle(orders, random), balancedSizes(orders.length, groups));
}

// ---------- ปรับกลุ่มให้ดีขึ้นเรื่อย ๆ (ย้าย / แยก / สลับออเดอร์ระหว่างไรเดอร์) ----------

// หาการปรับที่ทำให้ค่ารวมลดลง 1 อย่าง แล้วทำเลย คืน true ถ้าปรับได้
// flexible = true: เพิ่ม/ลดจำนวนไรเดอร์ได้ (ใช้กับวิธี "ประหยัดสุด" ที่ต้องชั่งค่าเรียก 15 บาทกับค่าระยะทาง)
function applyImprovement(
  groups: OrderInfo[][],
  value: (group: readonly OrderInfo[]) => number,
  flexible: boolean
): boolean {
  const EPS = 1e-9;

  for (let a = 0; a < groups.length; a++) {
    for (let i = 0; i < groups[a].length; i++) {
      const order = groups[a][i];
      const rest = groups[a].filter((_, k) => k !== i);
      const before = value(groups[a]);

      // 1) ย้ายออเดอร์ไปให้ไรเดอร์อีกคนที่ยังรับได้
      if (rest.length > 0 || flexible) {
        for (let b = 0; b < groups.length; b++) {
          if (b === a || groups[b].length >= MAX_ORDERS_PER_RIDER) {
            continue;
          }
          const delta = value(rest) + value([...groups[b], order]) - before - value(groups[b]);
          if (delta < -EPS) {
            groups[a] = rest;
            groups[b] = [...groups[b], order];
            return true;
          }
        }
      }

      // 2) แยกออเดอร์ไปให้ไรเดอร์คนใหม่
      if (flexible && groups[a].length > 1) {
        if (value(rest) + value([order]) - before < -EPS) {
          groups[a] = rest;
          groups.push([order]);
          return true;
        }
      }

      // 3) สลับออเดอร์กับไรเดอร์อีกคน
      for (let b = a + 1; b < groups.length; b++) {
        for (let j = 0; j < groups[b].length; j++) {
          const other = groups[b][j];
          const newA = [...rest, other];
          const newB = groups[b].map((x, k) => (k === j ? order : x));
          const delta = value(newA) + value(newB) - before - value(groups[b]);
          if (delta < -EPS) {
            groups[a] = newA;
            groups[b] = newB;
            return true;
          }
        }
      }
    }
  }
  return false;
}

interface Candidate {
  seqs: OrderInfo[][]; // ไรเดอร์แต่ละคน เรียงลำดับจุดส่งแล้ว
  value: number;
  key: string;
}

function planKey(seqs: readonly (readonly OrderInfo[])[]): string {
  return seqs.map(seq => seq.map(o => o.id).join('>')).sort().join('|');
}

// ---------- ประกอบแผน ----------

function buildRoute(seq: readonly OrderInfo[], index: number, leg: LegDistance): RiderRoute {
  const m = measure(seq, leg);
  const boxes = sumBoxes(seq);
  const fees = riderFees(boxes, m.distance);
  const distanceFee = Math.round(fees.distanceFee); // จ่ายเป็นบาทเต็ม
  const finish = m.arrivals[m.arrivals.length - 1];

  return {
    jobCode: `JOB-${String(index + 1).padStart(2, '0')}`,
    riderName: `ไรเดอร์ คนที่ ${index + 1}`,
    color: ROUTE_COLORS[index % ROUTE_COLORS.length],
    totalBoxes: boxes,
    distanceKm: m.distance,
    durationMin: finish - DEPARTURE_MINUTES,
    tripFee: fees.tripFee,
    distanceFee,
    cost: fees.tripFee + distanceFee,
    onTime: m.arrivals.every(t => t <= DEADLINE_MINUTES),
    stops: seq.map((o, i) => ({
      orderId: o.id,
      name: o.customerName,
      phone: o.phone,
      boxes: o.quantity,
      lat: o.lat,
      lng: o.lng,
      legKm: m.legs[i],
      arrivalMin: m.arrivals[i],
      time: formatTime(m.arrivals[i])
    }))
  };
}

function summarize(routes: readonly RiderRoute[]): PlanSummary {
  const sum = (pick: (r: RiderRoute) => number) => routes.reduce((total, r) => total + pick(r), 0);
  const boxes = sum(r => r.totalBoxes);
  const tripFees = sum(r => r.tripFee);
  const distanceFees = sum(r => r.distanceFee);
  const revenue = boxes * BOX_PRICE;
  const foodCost = boxes * BOX_COST;
  const lastArrival = Math.max(...routes.map(r => r.stops[r.stops.length - 1].arrivalMin));
  const lateStops = routes.reduce((n, r) => n + r.stops.filter(s => s.arrivalMin > DEADLINE_MINUTES).length, 0);

  return {
    riders: routes.length,
    orders: sum(r => r.stops.length),
    boxes,
    distanceKm: sum(r => r.distanceKm),
    revenue,
    foodCost,
    tripFees,
    distanceFees,
    riderCost: tripFees + distanceFees,
    profit: revenue - foodCost - tripFees - distanceFees,
    longestMin: Math.max(...routes.map(r => r.durationMin)),
    lastArrivalTime: formatTime(lastArrival),
    lateStops,
    allOnTime: lateStops === 0
  };
}

// ตั้งเลขใบงานเรียงตามทิศทางรอบร้าน (JOB-01, 02, ... อยู่ติดกันตามแผนที่)
function sortAroundShop(seqs: OrderInfo[][]): OrderInfo[][] {
  const cosLat = Math.cos((SHOP_LOCATION.lat * Math.PI) / 180);
  const angle = (seq: readonly OrderInfo[]) => {
    const lat = seq.reduce((s, o) => s + o.lat, 0) / seq.length - SHOP_LOCATION.lat;
    const lng = (seq.reduce((s, o) => s + o.lng, 0) / seq.length - SHOP_LOCATION.lng) * cosLat;
    return Math.atan2(lat, lng);
  };
  return [...seqs].sort((a, b) => angle(a) - angle(b));
}

@Injectable({
  providedIn: 'root'
})
export class RoutePlannerService {
  // เสนอแผนจัดเส้นทางหนึ่งชุด (ครั้งละหลายแบบให้เจ้าของร้านเลือก)
  // round 1 = คำนวณครั้งแรก, round 2, 3, ... = กด "คำนวณใหม่" (เริ่มจากจุดเริ่มต้นใหม่ และเลี่ยงแผนที่เคยเสนอแล้วใน seenKeys)
  // roadLeg = ระยะทางตามถนนจริง (จาก RoadNetworkService) ถ้าไม่ส่งมา จะใช้ระยะเส้นตรง
  propose(
    orders: readonly OrderInfo[],
    round = 1,
    seenKeys: readonly string[] = [],
    roadLeg: LegDistance | null = null
  ): RoutePlan[] {
    if (orders.length === 0) {
      return [];
    }

    const seen = new Set(seenKeys);
    const plans = new Map<string, RoutePlan>();
    const leg = roadLeg ?? distanceKm;
    const distanceMode = roadLeg ? 'road' : 'straight';

    STRATEGIES.forEach((strategy, strategyIndex) => {
      const candidates = this.candidates(orders, strategy, strategyIndex, round, leg);
      const chosen = candidates.find(c => !seen.has(c.key)) ?? candidates[0];

      const existing = plans.get(chosen.key);
      if (existing) {
        existing.strategies.push(strategy); // หลายวิธีได้แผนเดียวกัน -> รวมเป็นแผนเดียว
        return;
      }
      const routes = sortAroundShop(chosen.seqs).map((seq, i) => buildRoute(seq, i, leg));
      plans.set(chosen.key, { key: chosen.key, strategies: [strategy], routes, summary: summarize(routes), distanceMode });
    });

    // แผนที่ส่งทันทุกจุดมาก่อน แล้วเรียงตามกำไรมากไปน้อย (ถ้ากำไรเท่ากันเอาแผนที่ส่งเสร็จเร็วกว่า)
    return [...plans.values()].sort(
      (a, b) =>
        Number(b.summary.allOnTime) - Number(a.summary.allOnTime) ||
        b.summary.profit - a.summary.profit ||
        a.summary.longestMin - b.summary.longestMin
    );
  }

  // สร้างแผนผู้สมัครหลายแบบจากจุดเริ่มต้นต่างกัน เรียงจากดีที่สุดไปแย่สุด
  private candidates(
    orders: readonly OrderInfo[],
    strategy: RouteStrategy,
    strategyIndex: number,
    round: number,
    leg: LegDistance
  ): Candidate[] {
    // จำนวนไรเดอร์ขั้นต่ำที่ต้องใช้ (คนละไม่เกิน 3 ออเดอร์)
    const riders = Math.ceil(orders.length / MAX_ORDERS_PER_RIDER);
    const solve = createSolver(strategy, leg);
    const value = (group: readonly OrderInfo[]) => solve(group).value;
    const flexible = strategy === 'cheapest';

    const starts =
      round <= 1
        ? [
            sweepStart(orders, riders),
            clusterStart(orders, riders, leg),
            ...[1, 2, 3, 4].map(t => randomStart(orders, riders, createRandom(strategyIndex * 100 + t)))
          ]
        : Array.from({ length: 8 }, (_, t) =>
            randomStart(orders, riders, createRandom(round * 1000 + strategyIndex * 100 + t))
          );

    return starts
      .map(start => {
        const groups = start.map(g => [...g]);
        while (applyImprovement(groups, value, flexible)) {
          // วนปรับจนไม่มีอะไรทำให้ดีขึ้นอีก
        }
        const solutions = groups.filter(g => g.length > 0).map(solve);
        const seqs = solutions.map(s => s.seq);
        return {
          seqs,
          value: solutions.reduce((sum, s) => sum + s.value, 0),
          key: planKey(seqs)
        };
      })
      .sort((a, b) => a.value - b.value);
  }
}
