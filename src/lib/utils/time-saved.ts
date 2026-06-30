export function calculateTimeSaved(rejectedCount: number): string {
  const minutes = rejectedCount * 12
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`
  }
  return `${minutes} min`
}
