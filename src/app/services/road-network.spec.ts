import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ROUTING_SERVERS, RoadNetworkService } from './road-network';
import { distanceKm } from '../utils/geo';
import { settle } from '../testing/api-mock';

describe('RoadNetworkService', () => {
  let service: RoadNetworkService;
  let http: HttpTestingController;

  const shop = { lat: 16.2452, lng: 103.2501 };
  const a = { lat: 16.25, lng: 103.26 };
  const b = { lat: 16.24, lng: 103.24 };

  // คำขอไปยังเซิร์ฟเวอร์ลำดับที่ i
  const toServer = (i: number, service: 'table' | 'route') => (r: { url: string }) =>
    r.url.startsWith(`${ROUTING_SERVERS[i]}/${service}/v1/driving/`);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(RoadNetworkService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('ขอตารางระยะทางครั้งเดียว ส่งพิกัดเป็น ลองจิจูด,ละติจูด และแปลงเมตรเป็นกิโลเมตร', async () => {
    const done = service.roadDistances([shop, a, b]);
    const req = http.expectOne(toServer(0, 'table'));
    expect(req.request.url).toContain('/103.250100,16.245200;103.260000,16.250000;103.240000,16.240000?annotations=distance');
    req.flush({ code: 'Ok', distances: [[0, 1500, 2600], [1450, 0, 3900], [2550, 3950, 0]] });

    const leg = (await done)!;
    expect(leg(shop, a)).toBeCloseTo(1.5, 6);
    expect(leg(a, b)).toBeCloseTo(3.9, 6);
    expect(leg(b, shop)).toBeCloseTo(2.55, 6);
  });

  it('คู่ที่หาเส้นทางไม่ได้ (null) ใช้ระยะเส้นตรงแทน', async () => {
    const done = service.roadDistances([shop, a]);
    http.expectOne(toServer(0, 'table')).flush({ code: 'Ok', distances: [[0, null], [1200, 0]] });

    const leg = (await done)!;
    expect(leg(shop, a)).toBeCloseTo(distanceKm(shop, a), 6);
    expect(leg(a, shop)).toBeCloseTo(1.2, 6);
  });

  it('เซิร์ฟเวอร์แรกใช้ไม่ได้ -> ลองเซิร์ฟเวอร์สำรอง', async () => {
    const done = service.roadDistances([shop, a]);
    http.expectOne(toServer(0, 'table')).error(new ProgressEvent('error'));
    await settle();
    http.expectOne(toServer(1, 'table')).flush({ code: 'Ok', distances: [[0, 900], [900, 0]] });

    expect((await done)!(shop, a)).toBeCloseTo(0.9, 6);
  });

  it('ใช้ไม่ได้ทุกเซิร์ฟเวอร์ -> คืน null (หน้าเว็บจะใช้ระยะเส้นตรง)', async () => {
    const done = service.roadDistances([shop, a]);
    http.expectOne(toServer(0, 'table')).flush({ code: 'TooBig' });
    await settle();
    http.expectOne(toServer(1, 'table')).flush('busy', { status: 429, statusText: 'Too Many Requests' });

    expect(await done).toBeNull();
  });

  it('ขอตารางด้วยจุดชุดเดิมซ้ำ ไม่ต้องขอใหม่', async () => {
    const first = service.roadDistances([shop, a]);
    http.expectOne(toServer(0, 'table')).flush({ code: 'Ok', distances: [[0, 900], [900, 0]] });
    await first;

    const again = await service.roadDistances([a, shop]); // ลำดับต่างกันก็ใช้ของเดิม
    expect(again!(shop, a)).toBeCloseTo(0.9, 6);
    http.expectNone(toServer(0, 'table'));
  });

  it('เส้นทางตามถนน: สลับพิกัด GeoJSON [ลองจิจูด, ละติจูด] เป็น [ละติจูด, ลองจิจูด] และจำไว้ใช้ซ้ำ', async () => {
    const done = service.roadPath([shop, a]);
    const req = http.expectOne(toServer(0, 'route'));
    expect(req.request.url).toContain('?overview=full&geometries=geojson');
    req.flush({
      code: 'Ok',
      routes: [{ geometry: { type: 'LineString', coordinates: [[103.2501, 16.2452], [103.255, 16.247], [103.26, 16.25]] } }]
    });

    expect(await done).toEqual([[16.2452, 103.2501], [16.247, 103.255], [16.25, 103.26]]);
    expect(service.hasPath([shop, a])).toBe(true);
    expect(await service.roadPath([shop, a])).toHaveLength(3);
    http.expectNone(toServer(0, 'route'));
  });
});
