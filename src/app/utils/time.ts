// นาทีนับจากเที่ยงคืน -> "11:15 น."
export function formatTime(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm} น.`;
}
