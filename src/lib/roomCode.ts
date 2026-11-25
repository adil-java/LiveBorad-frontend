// Mirrors Room.NormalizeCode on the server: accepts any case, with or without dashes/spaces, or a pasted invite link.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz';

export function normalizeRoomCode(input: string): string | null {
  let text = input.trim();
  const slash = text.lastIndexOf('/');
  if (slash >= 0) text = text.slice(slash + 1);
  const letters = text.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length !== 10 || [...letters].some((c) => !ALPHABET.includes(c))) return null;
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

export function roomLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

/** Copies text, falling back to a prompt-free legacy method where the Clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

const GUEST_NAME_KEY = 'liveboard.guestName';

export function loadGuestName(): string {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGuestName(name: string) {
  try {
    localStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    // private mode etc.: just don't remember it
  }
}
