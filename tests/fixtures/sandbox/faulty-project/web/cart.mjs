export function total(lines) {
  return lines.reduce((sum, line) => sum + line.priceCents, 0);
}
