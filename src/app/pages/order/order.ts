import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryService } from '../../services/delivery';
import { BOX_COST, BOX_PRICE, MAX_BOXES_PER_ORDER, OrderInfo } from '../../models/order.model';

@Component({
  selector: 'app-order',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './order.html',
  styleUrl: './order.css'
})
export class Order {
  private readonly deliveryService = inject(DeliveryService);

  readonly boxPrice = BOX_PRICE;
  readonly boxCost = BOX_COST;
  readonly maxBoxes = MAX_BOXES_PER_ORDER;
  readonly boxOptions = Array.from({ length: MAX_BOXES_PER_ORDER }, (_, i) => i + 1);

  // ข้อมูลมาจาก Service (ใช้ร่วมกับหน้าลูกค้าและหน้าจัดเส้นทาง)
  readonly orders = this.deliveryService.orders;

  // สถานะการคุยกับ backend (แสดงในหน้าจอ)
  readonly apiError = this.deliveryService.error;
  readonly loading = this.deliveryService.loading;

  // ฟอร์มเพิ่มออเดอร์เอง
  readonly selectedCustomerId = signal<number | null>(null);
  readonly newQuantity = signal(1);

  // ลูกค้าที่ยังไม่มีออเดอร์ (ลูกค้า 1 คน = 1 ออเดอร์)
  readonly availableCustomers = computed(() => {
    const ordered = new Set(this.orders().map(o => o.customerId));
    return this.deliveryService.customers().filter(c => !ordered.has(c.id));
  });

  // สรุปยอด (คำนวณใหม่อัตโนมัติเมื่อออเดอร์เปลี่ยน)
  readonly totalBoxes = computed(() => this.orders().reduce((sum, o) => sum + o.quantity, 0));
  readonly totalRevenue = computed(() => this.totalBoxes() * BOX_PRICE);
  readonly totalCost = computed(() => this.totalBoxes() * BOX_COST);
  readonly totalProfit = computed(() => this.totalRevenue() - this.totalCost());

  constructor() {
    // เปิดหน้าแล้วดึงลูกค้า/ออเดอร์ล่าสุดจากฐานข้อมูล
    void this.deliveryService.refresh();
  }

  async generateOrders() {
    if (this.orders().length > 0 && !confirm('ออเดอร์เดิมทั้งหมดจะถูกแทนที่ด้วยออเดอร์สุ่มชุดใหม่ ดำเนินการต่อหรือไม่?')) {
      return;
    }
    if (await this.deliveryService.simulateOrders()) {
      this.selectedCustomerId.set(null);
    }
  }

  async clearOrders() {
    if (!confirm('ลบออเดอร์ทั้งหมดในฐานข้อมูลใช่หรือไม่?')) {
      return;
    }
    if (await this.deliveryService.clearOrders()) {
      this.selectedCustomerId.set(null);
    }
  }

  async addOrder() {
    const customerId = this.selectedCustomerId();
    if (customerId === null) {
      return;
    }
    if (await this.deliveryService.addOrder(customerId, this.newQuantity())) {
      this.selectedCustomerId.set(null);
      this.newQuantity.set(1);
    }
  }

  changeQuantity(order: OrderInfo, delta: number) {
    return this.deliveryService.updateOrderQuantity(order.id, order.quantity + delta);
  }

  removeOrder(order: OrderInfo) {
    return this.deliveryService.removeOrder(order.id);
  }
}
