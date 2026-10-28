import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryService } from '../../services/delivery';
import { DEADLINE_MINUTES, DEPARTURE_MINUTES } from '../../models/route.model';
import { LatLng, SHOP_LOCATION } from '../../utils/geo';
import { formatTime } from '../../utils/time';

// พิมพ์ "1", "01", "job-1", "JOB 01" -> "JOB-01" (ไรเดอร์พิมพ์บนมือถือจะได้ไม่ต้องเป๊ะ)
function normalizeJobCode(input: string): string {
  const text = input.trim().toUpperCase();
  const match = text.match(/^(?:JOB[-\s]?)?(\d{1,3})$/);
  return match ? `JOB-${String(Number(match[1])).padStart(2, '0')}` : text;
}

@Component({
  selector: 'app-rider',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './rider.html',
  styleUrl: './rider.css'
})
export class Rider {
  private readonly deliveryService = inject(DeliveryService);

  readonly departureTime = formatTime(DEPARTURE_MINUTES);
  readonly deadlineTime = formatTime(DEADLINE_MINUTES);

  // รหัสใบงานที่ไรเดอร์กรอก / กดเลือก
  readonly selectedJobId = signal('');

  // ใบงานทั้งหมดที่เจ้าของร้านส่งมา (ดึงจากฐานข้อมูล ไรเดอร์เปิดจากมือถือของตัวเองได้)
  readonly jobs = this.deliveryService.jobs;
  readonly availableJobCodes = computed(() => Object.keys(this.jobs()));

  // สถานะการคุยกับ backend
  readonly apiError = this.deliveryService.error;
  readonly loading = this.deliveryService.loading;

  // เวลาที่เจ้าของร้านส่งใบงานชุดนี้ เช่น "11:31 น." ('' = ไม่ทราบ)
  readonly publishedTime = computed(() => {
    const at = Object.values(this.jobs())[0]?.publishedAt;
    const date = at ? new Date(at) : null;
    return date && !Number.isNaN(date.getTime()) ? formatTime(date.getHours() * 60 + date.getMinutes()) : '';
  });

  readonly currentCode = computed(() => normalizeJobCode(this.selectedJobId()));
  readonly currentJob = computed(() => this.jobs()[this.currentCode()] ?? null);

  // สรุปลำดับส่งแบบบรรทัดเดียว: ร้าน -> บ้านคุณ A -> บ้านคุณ B
  readonly routeLine = computed(() => {
    const job = this.currentJob();
    return job ? ['ร้าน', ...job.stops.map(s => s.name)].join(' → ') : '';
  });

  // ลิงก์เปิด Google Maps นำทางตามใบงาน: ร้าน -> จุดที่ 1 -> ... -> จุดสุดท้าย
  readonly mapUrl = computed(() => {
    const job = this.currentJob();
    if (!job || job.stops.length === 0) {
      return '';
    }
    const point = (p: LatLng) => `${p.lat},${p.lng}`;
    const params = new URLSearchParams({
      api: '1',
      origin: point(SHOP_LOCATION),
      destination: point(job.stops[job.stops.length - 1]),
      travelmode: 'driving'
    });
    const via = job.stops.slice(0, -1);
    if (via.length > 0) {
      params.set('waypoints', via.map(point).join('|'));
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  });

  constructor() {
    // เปิดหน้าแล้วดึงใบงานล่าสุดจากฐานข้อมูล
    void this.deliveryService.loadJobs();
  }

  selectJob(jobCode: string) {
    this.selectedJobId.set(jobCode);
  }

  // เจ้าของร้านเพิ่งคำนวณเส้นทางใหม่ -> ไรเดอร์กดโหลดใบงานล่าสุด
  reload() {
    void this.deliveryService.loadJobs();
  }
}
