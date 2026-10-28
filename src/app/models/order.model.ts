// กติกาธุรกิจตามโจทย์
export const BOX_PRICE = 65; // ราคาขาย บาท/กล่อง
export const BOX_COST = 40; // ต้นทุนอาหาร บาท/กล่อง
export const MAX_BOXES_PER_ORDER = 3; // ออเดอร์ละไม่เกิน 3 กล่อง
export const ORDER_STATUS_WAITING = 'รอจัดเส้นทาง';

// ออเดอร์ที่เก็บจริงใน Service (อ้างอิงลูกค้าด้วย customerId)
export interface OrderRecord {
  id: string;
  customerId: number;
  quantity: number;
  status: string;
  time: string;
}

// ออเดอร์ที่พร้อมใช้แสดงผล / จัดเส้นทาง (ประกอบข้อมูลลูกค้าเข้ามาแล้ว)
export interface OrderInfo extends OrderRecord {
  customerName: string;
  phone: string;
  lat: number;
  lng: number;
}
