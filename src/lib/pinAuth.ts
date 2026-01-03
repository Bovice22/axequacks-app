export function getPinPepper() {
  const pepper = process.env.PIN_PEPPER;
  if (!pepper) {
    throw new Error("Missing PIN_PEPPER");
  }
  return pepper;
}

export function pinToPassword(pin: string, staffId: string) {
  const normalizedPin = String(pin).trim();
  const normalizedStaffId = String(staffId).trim().toLowerCase();
  return `${normalizedPin}:${normalizedStaffId}:${getPinPepper()}`;
}
