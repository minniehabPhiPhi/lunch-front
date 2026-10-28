export interface CustomerInfo {
  id: number;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  // รายละเอียดที่อยู่ (backend บังคับกรอก)
  address: string;
}

// ข้อมูลที่ได้จากฟอร์ม (ยังไม่มี id)
export type CustomerForm = Omit<CustomerInfo, 'id'>;
