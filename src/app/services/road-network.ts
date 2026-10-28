import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { LatLng, distanceKm } from '../utils/geo';

// บริการหาเส้นทางขับรถตามถนนจริง (OSRM ใช้ข้อมูลถนนจาก OpenStreetMap)
// ลองเซิร์ฟเวอร์ตามลำดับ ถ้าตัวแรกใช้ไม่ได้จะลองตัวถัดไป ถ้าใช้ไม่ได้ทั้งหมด หน้าเว็บจะกลับไปใช้ระยะเส้นตรง
export const ROUTING_SERVERS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car'
];

// รอคำตอบได้นานสุดกี่มิลลิวินาที (เกินนี้ถือว่าเซิร์ฟเวอร์ใช้ไม่ได้)
const REQUEST_TIMEOUT_MS = 10_000;

// ฟังก์ชันระยะทาง (กม.) ระหว่าง 2 จุด ที่ตัวคำนวณเส้นทางใช้
export type LegDistance = (from: LatLng, to: LatLng) => number;

// พิกัดในรูปแบบที่ OSRM ต้องการ: "ลองจิจูด,ละติจูด" คั่นด้วย ;
function toOsrmCoords(points: readonly LatLng[]): string {
  return points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
}

// คีย์ของจุด (ใช้จับคู่พิกัดกับแถว/คอลัมน์ในตารางระยะทาง)
function pointKey(p: LatLng): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

interface OsrmTableResponse {
  code: string;
  distances?: (number | null)[][]; // เมตร, null = หาเส้นทางไม่ได้
}

interface OsrmRouteResponse {
  code: string;
  routes?: { geometry: { type: string; coordinates: [number, number][] } }[]; // [ลองจิจูด, ละติจูด]
}

@Injectable({
  providedIn: 'root'
})
export class RoadNetworkService {
  private readonly http = inject(HttpClient);

  // จำผลไว้: เปิดหน้าซ้ำ / กดคำนวณใหม่ด้วยจุดเดิม จะไม่ต้องขอซ้ำ
  private readonly tableCache = new Map<string, LegDistance>();
  private readonly pathCache = new Map<string, [number, number][]>();

  // ส่งคำขอไปเซิร์ฟเวอร์ทีละตัวจนกว่าจะได้คำตอบที่ใช้ได้
  private async request<T extends { code: string }>(path: string): Promise<T | null> {
    for (const server of ROUTING_SERVERS) {
      try {
        const res = await firstValueFrom(this.http.get<T>(`${server}${path}`).pipe(timeout(REQUEST_TIMEOUT_MS)));
        if (res?.code === 'Ok') {
          return res;
        }
      } catch {
        // เซิร์ฟเวอร์นี้ใช้ไม่ได้ (ล่ม / ช้า / ถูกจำกัด) -> ลองตัวถัดไป
      }
    }
    return null;
  }

  // ระยะทางขับรถระหว่างทุกคู่จุด (ขอครั้งเดียวด้วย Table API)
  // คืนฟังก์ชันระยะทางตามถนน หรือ null ถ้าเรียกบริการไม่ได้
  async roadDistances(points: readonly LatLng[]): Promise<LegDistance | null> {
    const unique = [...new Map(points.map(p => [pointKey(p), p])).values()];
    if (unique.length < 2) {
      return null;
    }
    const cacheKey = unique.map(pointKey).sort().join(';');
    const cached = this.tableCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const res = await this.request<OsrmTableResponse>(
      `/table/v1/driving/${toOsrmCoords(unique)}?annotations=distance`
    );
    const matrix = res?.distances;
    if (!matrix || matrix.length !== unique.length) {
      return null;
    }

    const index = new Map(unique.map((p, i) => [pointKey(p), i]));
    const leg: LegDistance = (from, to) => {
      const i = index.get(pointKey(from));
      const j = index.get(pointKey(to));
      const meters = i === undefined || j === undefined ? null : matrix[i]?.[j];
      // คู่ที่หาเส้นทางไม่ได้ (เช่น จุดไม่ติดถนน) -> ใช้ระยะเส้นตรงแทน
      return typeof meters === 'number' ? meters / 1000 : distanceKm(from, to);
    };
    this.tableCache.set(cacheKey, leg);
    return leg;
  }

  // เส้นทางตามถนนที่ผ่านจุดตามลำดับ สำหรับวาดบนแผนที่ คืนพิกัด [ละติจูด, ลองจิจูด] หรือ null
  async roadPath(points: readonly LatLng[]): Promise<[number, number][] | null> {
    if (points.length < 2) {
      return null;
    }
    const coords = toOsrmCoords(points);
    const cached = this.pathCache.get(coords);
    if (cached) {
      return cached;
    }

    const res = await this.request<OsrmRouteResponse>(
      `/route/v1/driving/${coords}?overview=full&geometries=geojson`
    );
    const line = res?.routes?.[0]?.geometry?.coordinates;
    if (!line || line.length < 2) {
      return null;
    }
    const path = line.map(([lng, lat]) => [lat, lng] as [number, number]);
    this.pathCache.set(coords, path);
    return path;
  }

  // มีเส้นทางนี้ในความจำแล้วหรือยัง (ถ้ามี วาดได้ทันทีไม่ต้องรอ)
  hasPath(points: readonly LatLng[]): boolean {
    return this.pathCache.has(toOsrmCoords(points));
  }
}
