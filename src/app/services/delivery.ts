import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DeliveryService {
  // เก็บรายการออเดอร์ที่สุ่มได้
  orders: any[] = [];
  
  // เก็บใบงานที่จัดเส้นทางสำเร็จแล้ว
  jobs: any = {};

  // บันทึกออเดอร์
  setOrders(ordersData: any[]) {
    this.orders = ordersData;
  }

  // ดึงออเดอร์
  getOrders() {
    return this.orders;
  }

  // บันทึกใบงานจัดเส้นทาง
  setJobs(jobsData: any) {
    this.jobs = jobsData;
  }

  // ดึงใบงาน
  getJobs() {
    return this.jobs;
  }
}