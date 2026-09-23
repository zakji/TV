// Encrypts a value for a GitHub Actions secret (libsodium sealed box), in the browser.
import sealedBox from 'tweetnacl-sealedbox-js';

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

export function sealSecret(publicKeyB64, value) {
  const sealed = sealedBox.seal(new TextEncoder().encode(value), b64ToBytes(publicKeyB64));
  return bytesToB64(sealed);
}
