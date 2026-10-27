import { Component, computed, inject, signal } from '@angular/core';
import { firstName, val } from '../../core/api';
import { ok } from '../../core/map';
import { Job, Store } from '../../core/store';

const norm = (s: string) => { const m = s.trim().toUpperCase().match(/^(?:JOB)?[-\s]?(\d+)$/); return m ? `JOB-${m[1].padStart(2, '0')}` : s.trim().toUpperCase(); };

@Component({
  selector: 'app-rider',
  standalone: true,
  templateUrl: './rider.html',
  styleUrl: './rider.css',
})
export class Rider {
  store = inject(Store);
  v = val; first = firstName;
  code = signal(this.store.jobs()[0]?.code ?? '');
  key = computed(() => norm(this.code()));
  job = computed(() => this.store.jobs().find(j => j.code === this.key()) ?? null);

  /** กดเลขจุด -> เปิด Google Maps นำทางจากตำแหน่งปัจจุบันของไรเดอร์ไปบ้านลูกค้าจุดนั้น */
  stopUrl(s: Job['stops'][number]) {
    return ok(s.lat, s.lng)
      ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=two-wheeler`
      : null;
  }

  url(j: Job) {
    const s = this.store.shop(), pt = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`, last = j.stops[j.stops.length - 1];
    const via = j.stops.slice(0, -1).map(pt).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${pt(s)}&destination=${pt(last)}${via ? `&waypoints=${encodeURIComponent(via)}` : ''}&travelmode=two-wheeler`;
  }
}
